import crypto from 'node:crypto';
import Fastify, { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { errorEnvelope } from './http.js';
import { fabricService, creditPackQuoteByCode, creditPackQuotes } from './services/fabricService.js';
import * as repo from './db/fabricRepo.js';
import { query } from './db/client.js';
import { getSafeDbEnvDiagnostics } from './dbEnvDiagnostics.js';
import { openApiDocument } from './openapi.js';
import { CATEGORIES_RESPONSE, CATEGORIES_VERSION } from './categories.js';
import { registerMcpRoute } from './mcp.js';
import { ALLOWED_REGION_IDS, isAllowedCountryAdmin1, isAllowedRegionId, normalizeRegionCode } from './shared/regions.js';
import * as nowPayments from './services/nowPayments.js';
import { retentionCutoffs } from './retentionPolicy.js';
import { sendEmail, sendSlack } from './services/emailProvider.js';

type AuthedRequest = FastifyRequest & {
  nodeId?: string;
  plan?: string;
  isSubscriber?: boolean;
  idem?: { key: string; hash: string; keyScope: string; subject: 'anon' | 'node' | 'admin' };
};
type StripeWebhookLogContext = { event_id: string | null; event_type: string | null; stripe_signature_present: boolean };
type StripeWebhookRequest = FastifyRequest & { stripeWebhookLogContext?: StripeWebhookLogContext };

const nonGet = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);
const ANON_IDEM_TTL_MS = 3_600_000; // 1 hour
const ANON_IDEM_MAX_SIZE = 50_000;
const _anonIdemStore = new Map<string, { hash: string; status: number; response: unknown; createdAt: number }>();
const anonIdem = {
  get(key: string) {
    const entry = _anonIdemStore.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.createdAt > ANON_IDEM_TTL_MS) { _anonIdemStore.delete(key); return undefined; }
    return entry;
  },
  set(key: string, val: { hash: string; status: number; response: unknown }) {
    if (_anonIdemStore.size >= ANON_IDEM_MAX_SIZE) {
      const oldest = _anonIdemStore.keys().next().value;
      if (oldest !== undefined) _anonIdemStore.delete(oldest);
    }
    _anonIdemStore.set(key, { ...val, createdAt: Date.now() });
  },
};
let startupDbEnvCheckLogged = false;
type RateLimitSubject = 'ip' | 'node' | 'global';
type RateLimitRule = { name: string; limit: number; windowSeconds: number; subject: RateLimitSubject };
const RATE_LIMIT_MAX_TRACKED_KEYS = 200_000;
const rateLimitState = new Map<string, { count: number; resetAtMs: number }>();
const BROAD_QUERY_MAX_TRACKED_NODES = 100_000;
const _searchBroadQueryStore = new Map<string, number[]>();
const searchBroadQueryState = {
  get(nodeId: string): number[] | undefined { return _searchBroadQueryStore.get(nodeId); },
  set(nodeId: string, timestamps: number[]) {
    if (_searchBroadQueryStore.size >= BROAD_QUERY_MAX_TRACKED_NODES && !_searchBroadQueryStore.has(nodeId)) {
      const oldest = _searchBroadQueryStore.keys().next().value;
      if (oldest !== undefined) _searchBroadQueryStore.delete(oldest);
    }
    _searchBroadQueryStore.set(nodeId, timestamps);
  },
};
const SEARCH_CURSOR_PREFIX = 'pg1:';
const REGION_ID_REGEX = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;
const OFFER_TTL_MINUTES_MIN = 15;
const OFFER_TTL_MINUTES_MAX = 10080;
const REQUEST_TTL_MINUTES_MIN = 60;
// 365 days — intentionally long for early marketplace density; reduce once volume is healthy
const REQUEST_TTL_MINUTES_MAX = 525600;

const CONTACT_EMAIL_RE = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/;
const CONTACT_PHONE_RE = /(?:\+\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/;
const CONTACT_HANDLE_RE = /(?:telegram|whatsapp|signal|wechat|discord|skype)\s*[:\-]\s*\S+/i;
const CONTACT_INFO_CHECKED_FIELDS = ['title', 'description', 'scope_notes', 'public_summary'] as const;

function detectContactInfo(data: Record<string, unknown>): string | null {
  for (const field of CONTACT_INFO_CHECKED_FIELDS) {
    const val = data[field];
    if (typeof val !== 'string' || val.length === 0) continue;
    if (CONTACT_EMAIL_RE.test(val)) return field;
    if (CONTACT_PHONE_RE.test(val)) return field;
    if (CONTACT_HANDLE_RE.test(val)) return field;
  }
  return null;
}

function detectContactInfoInText(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0) return false;
  if (CONTACT_EMAIL_RE.test(value)) return true;
  if (CONTACT_PHONE_RE.test(value)) return true;
  if (CONTACT_HANDLE_RE.test(value)) return true;
  return false;
}

function isTtlMinutesOutOfRange(value: unknown, min: number, max: number) {
  return typeof value === 'number' && Number.isInteger(value) && (value < min || value > max);
}

const WEBHOOK_NUDGE = 'Set event_webhook_url via PATCH /v1/me to receive real-time notifications instead of polling.';

async function maybeAppendWebhookNudge(nodeId: string, out: Record<string, unknown>): Promise<Record<string, unknown>> {
  try {
    const me = await repo.getMe(nodeId);
    if (!me.event_webhook_url) out.setup_incomplete = { event_webhook_url: WEBHOOK_NUDGE };
  } catch { /* non-critical */ }
  return out;
}

const _hmacCompareKey = crypto.randomBytes(32);
function safeTimingSafeCompare(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = crypto.createHmac('sha256', _hmacCompareKey).update(provided).digest();
  const b = crypto.createHmac('sha256', _hmacCompareKey).update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

const CRYPTO_CHAIN_LABELS: Record<string, string> = {
  usdcsol: 'Solana',
};

function isAllowedCheckoutRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    const allowlist = config.checkoutRedirectAllowlist;
    if (allowlist.length === 0) return false;
    return allowlist.some((allowed) => parsed.hostname === allowed || parsed.hostname.endsWith(`.${allowed}`));
  } catch {
    return false;
  }
}

const REGION_OBJECT_FIELDS = ['origin_region', 'dest_region', 'service_region'] as const;

function normalizeAndValidateRegionObject(value: unknown): { ok: boolean; value: unknown } {
  if (value == null) return { ok: true, value };
  if (typeof value !== 'object' || Array.isArray(value)) return { ok: false, value };
  const region = { ...(value as Record<string, unknown>) };
  if (typeof region.country_code !== 'string' || region.country_code.trim().length === 0) return { ok: false, value };
  const normalizedCountryCode = normalizeRegionCode(region.country_code);
  let normalizedAdmin1: string | null = null;
  if (region.admin1 === undefined || region.admin1 === null) {
    normalizedAdmin1 = null;
  } else if (typeof region.admin1 === 'string') {
    normalizedAdmin1 = normalizeRegionCode(region.admin1);
    region.admin1 = normalizedAdmin1;
  } else {
    return { ok: false, value };
  }
  if (!isAllowedCountryAdmin1(normalizedCountryCode, normalizedAdmin1)) return { ok: false, value };
  region.country_code = normalizedCountryCode;
  return { ok: true, value: region };
}

function normalizeAndValidateResourceRegions(payload: Record<string, unknown>) {
  for (const field of REGION_OBJECT_FIELDS) {
    if (!(field in payload)) continue;
    const validated = normalizeAndValidateRegionObject(payload[field]);
    if (!validated.ok) return false;
    payload[field] = validated.value;
  }
  return true;
}

const resourceSchema = z.object({
  title: z.string(), description: z.string().nullable().optional(), type: z.string().nullable().optional(), condition: z.enum(['new', 'like_new', 'good', 'fair', 'poor', 'unknown']).nullable().optional(),
  quantity: z.number().nullable().optional(), estimated_value: z.number().nullable().optional(), measure: z.enum(['EA','KG','LB','L','GAL','M','FT','HR','DAY','LOT','CUSTOM']).nullable().optional(), custom_measure: z.string().nullable().optional(),
  scope_primary: z.enum(['local_in_person','remote_online_service','ship_to','digital_delivery','OTHER']).nullable().optional(), scope_secondary: z.array(z.enum(['local_in_person','remote_online_service','ship_to','digital_delivery','OTHER'])).nullable().optional(),
  scope_notes: z.string().nullable().optional(), location_text_public: z.string().nullable().optional(), origin_region: z.any().optional(), dest_region: z.any().optional(), service_region: z.any().optional(),
  delivery_format: z.string().nullable().optional(), max_ship_days: z.number().int().min(1).max(30).nullable().optional(), tags: z.array(z.string()).optional(), category_ids: z.array(z.number()).optional(), public_summary: z.string().nullable().optional(), need_by: z.string().nullable().optional(), accept_substitutions: z.boolean().optional(),
});
const messagingHandleSchema = z.object({
  kind: z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/),
  handle: z.string().trim().min(1).max(128),
  url: z.string().trim().url().max(2048).nullable().optional(),
});
const broadeningSchema = z.object({ level: z.number().int().min(0), allow: z.boolean() })
  .nullish()
  .transform((value) => value ?? { level: 0, allow: false });

const searchBudgetSchema = z.object({
  credits_requested: z.number().int().min(0).optional(),
  credits_max: z.number().int().min(0).optional(),
}).refine((value) => value.credits_requested !== undefined || value.credits_max !== undefined, {
  message: 'credits_requested_or_credits_max_required',
});

const searchSchema = z.object({
  q: z.string().nullable(),
  scope: z.enum(['local_in_person', 'remote_online_service', 'ship_to', 'digital_delivery', 'OTHER']),
  filters: z.record(z.any()),
  broadening: broadeningSchema,
  budget: searchBudgetSchema,
  target: z.object({
    node_id: z.string().uuid().nullable().optional(),
    username: z.string().trim().min(1).nullable().optional(),
  }).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().nullable(),
});
const searchQuoteSchema = searchSchema.omit({ budget: true, target: true });

function normalizeSearchBudget<T extends { budget: { credits_requested?: number; credits_max?: number } }>(
  payload: T,
): T & { budget: { credits_requested: number } } {
  return {
    ...payload,
    budget: {
      credits_requested: payload.budget.credits_requested ?? payload.budget.credits_max ?? 0,
    },
  } as T & { budget: { credits_requested: number } };
}

const drilldownPostSchema = z.object({
  budget: z.object({ credits_max: z.number().int().min(0) }),
  cursor: z.string().nullable().optional().default(null),
  limit: z.number().int().min(1).max(100).optional().default(20),
});

const legalPageTemplate = (title: string, body: string) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body>
  <main>
    <h1>${title}</h1>
    ${body}
  </main>
</body>
</html>`;

const legalPages = {
  terms: legalPageTemplate('Fabric Terms of Service', `
    <p><strong>Operator:</strong> Pilsang Park (operating the Fabric Protocol)</p>
    <p><strong>Effective date:</strong> 2026-02-17</p>

    <h2>1. Agreement and eligibility</h2>
    <p>By accessing or using the Fabric Protocol (the "Service"), you agree to these Terms and the documents incorporated by reference: the Acceptable Use Policy and Privacy Policy.</p>
    <p>You must be at least 18 years old (or the age of majority where you live) to create an account, obtain an API key, or act as the account holder for a Node.</p>

    <h2>2. What Fabric is</h2>
    <p>Fabric is an agent-native backend/protocol for coordinating allocatable resources between participants ("Nodes"). Fabric is infrastructure for identity, publication, discovery, and workflow coordination. Fabric is <strong>not</strong> an escrow service, payment processor, broker, or intermediary for off-platform transactions between Nodes.</p>

    <h2>3. Accounts, Nodes, and responsibility for agents</h2>
    <p>A "Node" is a principal identity in the Service. API keys are issued for access and map requests to a Node identity.</p>
    <p>You are responsible for all activity performed using your API keys and any agents, automation, or clients you deploy or authorize-whether those actions are initiated by you, your software, or an autonomous agent operating under your keys. You must secure keys, rotate them on suspected compromise, and promptly notify support of suspected misuse.</p>

    <h2>4. Using the API</h2>
    <p>You must use the Service in accordance with the endpoint contracts, required headers (including Idempotency-Key on non-GET endpoints and If-Match on PATCH where required), rate limits, and metering rules. You may not bypass access controls, interfere with Service operation, or attempt to access data you are not authorized to access.</p>

    <h2>5. Acceptable Use</h2>
    <p>You must comply with the Acceptable Use Policy. Violations may result in rate limiting, suspension, API key revocation, removal of projections, and/or termination, including immediate action for suspected abuse, fraud, security threats, or illegal activity.</p>

    <h2>6. Billing, subscriptions, and credits</h2>
    <p><strong>Billing platform.</strong> Subscriptions and Credit Pack purchases are billed through Stripe or another payment processor designated by the Operator.</p>
    <p><strong>Credits.</strong> Credits are a metering mechanism for consumption of Service capabilities. Credits are not legal tender, are not redeemable for cash, have no cash value, and are non-transferable unless expressly permitted by the Operator in writing.</p>
    <p><strong>Credit Packs.</strong> Credit Pack purchases are <strong>non-refundable</strong> except where required by law.</p>
    <p><strong>Subscription credits; rollover cap.</strong> Subscription plans may include periodic credit grants. Unused subscription credits roll over up to a maximum balance equal to <strong>two months</strong> of that plan's periodic credit amount (i.e., rollover is capped at one additional month beyond the current month's grant).</p>
    <p><strong>Plan changes.</strong> Plan upgrades/downgrades and credit-grant semantics follow the Service's published billing policy and API documentation as in effect at the time of change.</p>
    <p><strong>Taxes.</strong> You are responsible for all applicable taxes related to your use.</p>

    <h2>7. Suspension, revocation, and termination</h2>
    <p>The Operator may suspend or terminate your access (including revoking API keys and disabling Nodes) at any time for security, abuse prevention, fraud risk, policy violations, legal compliance, or operational integrity.</p>
    <p>Upon termination, you must stop using the Service. The Operator may retain and log information as described in the Privacy Policy and as required for security/compliance.</p>

    <h2>8. Your content and data</h2>
    <p>You retain rights to your content. You grant the Operator a limited license to host, process, and transmit your content solely to provide and secure the Service, enforce policies, and comply with law. You represent you have all rights necessary to submit content and that your content and use comply with law and the Acceptable Use Policy.</p>

    <h2>9. Marketplace content; no verification ("buyer beware")</h2>
    <p>Fabric hosts and transmits information provided by Nodes (including listings, requests, descriptions, contact handles, and other content). The Operator does not verify, endorse, guarantee, or warrant the accuracy, completeness, legality, quality, safety, or availability of any Node-provided content or any off-platform transaction. Contact and messaging identity information is user-provided and unverified. Any reliance on Node-provided content is at your own risk. You are solely responsible for evaluating other Nodes and conducting appropriate due diligence ("buyer beware").</p>

    <h2>10. Privacy</h2>
    <p>The Privacy Policy describes how the Operator collects, uses, and shares data.</p>

    <h2>11. Disclaimers</h2>
    <p>The Service is provided <strong>"as is"</strong> and <strong>"as available."</strong> The Operator disclaims all warranties to the fullest extent permitted by law, including implied warranties of merchantability, fitness for a particular purpose, and non-infringement. The Operator does not guarantee uninterrupted availability, error-free operation, or that the Service will meet your requirements.</p>

    <h2>12. Limitation of liability</h2>
    <p>To the fullest extent permitted by law, the Operator will not be liable for indirect, incidental, special, consequential, or punitive damages, or any loss of profits, revenue, data, or goodwill.</p>
    <p>The Operator's total liability for any claims arising out of or related to the Service will not exceed the amounts you paid to the Operator for the Service in the <strong>12 months</strong> preceding the event giving rise to the claim.</p>

    <h2>13. Indemnification</h2>
    <p>You agree to indemnify and hold harmless the Operator from any claims, liabilities, damages, losses, and expenses (including reasonable attorneys' fees) arising from your use of the Service, your agents' actions, your content, or your violation of these Terms or the Acceptable Use Policy.</p>

    <h2>14. Changes to the Service or Terms</h2>
    <p>The Operator may modify the Service and these Terms. Material changes will be posted with an updated effective date. Continued use after the effective date constitutes acceptance of the updated Terms.</p>

    <h2>15. Governing law; venue</h2>
    <p>These Terms are governed by the laws of the State of California, excluding conflict-of-law rules. Venue for disputes will be in the state or federal courts located in <strong>Santa Clara County, California</strong>, unless otherwise required by law.</p>

    <h2>16. Contact</h2>
    <p>Questions or notices: <strong>mapmoiras@gmail.com</strong>.</p>
  `),
  privacy: legalPageTemplate('Fabric Privacy Policy', `
    <p><strong>Operator:</strong> Pilsang Park (operating the Fabric Protocol)</p>
    <p><strong>Effective date:</strong> 2026-02-17</p>

    <h2>1. Overview</h2>
    <p>This Privacy Policy explains how the Operator collects, uses, shares, and retains information when you use the Fabric Protocol and related web pages (the "Service"). The Service is designed for agent-native workflows where Nodes (principals) interact through authenticated interfaces.</p>

    <h2>2. Information we collect</h2>
    <p>We collect the following categories of information:</p>

    <h3>A) Account and Node information</h3>
    <ul>
      <li>Email address (if provided).</li>
      <li>Node profile information you submit (for example, display name and other profile fields).</li>
      <li>Optional contact handles you may provide (for example, messaging usernames), if the Service offers these fields.</li>
    </ul>

    <h3>B) Content you submit</h3>
    <ul>
      <li>Listings, requests, descriptions, metadata, and other content you submit through the Service.</li>
    </ul>
    <p><strong>Important:</strong> you control what you include in content fields. <strong>Do not submit sensitive personal data</strong> (for example, government IDs, financial account numbers, precise location data you do not want shared, medical information, or other sensitive information) in listings/requests/descriptions.</p>

    <h3>C) Usage, device, and log information</h3>
    <ul>
      <li>Request and response metadata (timestamps, endpoints, status codes, request IDs).</li>
      <li>IP address, user-agent, and related technical data needed for security and reliability.</li>
      <li>Rate-limit and abuse-prevention signals.</li>
      <li>Audit and metering records related to Service usage (including credit ledger entries).</li>
    </ul>

    <h3>D) Billing information</h3>
    <ul>
      <li>Subscription and purchase metadata handled through Stripe (such as customer identifiers, plan and purchase status, invoice identifiers, and payment status).</li>
      <li>The Operator does not store full payment card numbers; payment processing is handled by Stripe.</li>
    </ul>

    <h2>3. How we use information</h2>
    <p>We use information to:</p>
    <ul>
      <li>Provide, operate, maintain, and secure the Service (including authenticating requests and enforcing access controls).</li>
      <li>Process billing-related events and reconcile subscriptions and Credit Pack purchases.</li>
      <li>Measure usage, apply metering and rate limits, and prevent fraud and abuse.</li>
      <li>Monitor reliability, debug issues, and improve the Service.</li>
      <li>Comply with legal obligations and enforce our policies (including the Terms of Service and Acceptable Use Policy).</li>
    </ul>

    <h2>4. How information is shared</h2>
    <p>We share information in the following ways:</p>

    <h3>A) With other Nodes (Service visibility)</h3>
    <ul>
      <li>Listings/requests and associated public projection data may be visible to other authenticated Nodes through search and discovery.</li>
    </ul>
    <p><strong>Contact information is not intended to be public.</strong> If the Service supports contact reveal, contact handles (if provided) are shared only after an offer is accepted and only between Nodes that meet eligibility requirements (for example, both being subscribers), consistent with the Service workflow.</p>

    <h3>B) With service providers</h3>
    <ul>
      <li>Stripe: to process payments and billing events.</li>
      <li>Cloud infrastructure providers and logging/monitoring vendors: to host the Service and support reliability and security.</li>
    </ul>

    <h3>C) For legal and safety reasons</h3>
    <p>We may disclose information to comply with law, respond to lawful requests, protect rights and safety, investigate abuse/fraud, and enforce policies.</p>

    <p>We do not sell personal information.</p>

    <h2>5. Your responsibilities for content</h2>
    <p>You are responsible for the content you submit and for ensuring you have the rights to submit it. You should avoid including sensitive personal data in public or shared fields. The Operator does not verify content submitted by Nodes.</p>

    <h2>6. Retention</h2>
    <ul>
      <li><strong>Operational logs:</strong> retained for up to <strong>90 days</strong> for reliability, security, and debugging.</li>
      <li><strong>Billing and accounting records:</strong> retained as needed for reconciliation, dispute handling, fraud prevention, and compliance.</li>
      <li><strong>Security and abuse records:</strong> may be retained longer as needed to investigate and prevent repeat abuse and maintain system integrity.</li>
    </ul>
    <p>Some data may persist in backups for a limited period.</p>

    <h2>7. Security</h2>
    <p>We use reasonable administrative, technical, and organizational measures designed to protect information, including access controls, key-based authentication, and monitoring for abuse. No system is perfectly secure, and we cannot guarantee absolute security.</p>

    <h2>8. Account closure and deletion requests</h2>
    <p>You may request account closure by contacting us at <strong>mapmoiras@gmail.com</strong>. Where feasible, we will delete or de-identify personal data associated with your account, subject to retention needs for billing, security, fraud prevention, and legal compliance. Public projections may take time to update due to caching/eventual consistency, and data already shared with other Nodes or third parties may not be retrievable.</p>

    <h2>9. Children</h2>
    <p>The Service is not directed to children. Account holders must be at least 18 years old (or the age of majority where they live).</p>

    <h2>10. EEA/UK notice</h2>
    <p>If you are located in the European Economic Area (EEA) or the United Kingdom, you may have certain rights regarding your personal data, including to request access, correction, deletion, or restriction of processing, and to object to certain processing. You may also have the right to lodge a complaint with your local data protection authority. To make a request, contact us at <strong>mapmoiras@gmail.com</strong>.</p>

    <h2>11. International users</h2>
    <p>If you access the Service from outside the United States, your information may be processed and stored in the United States or other locations where our service providers operate.</p>

    <h2>12. Changes to this policy</h2>
    <p>We may update this Privacy Policy from time to time. We will post the updated policy with a new effective date. Continued use of the Service after the effective date constitutes acceptance of the updated policy.</p>

    <h2>13. Contact</h2>
    <p>Questions or requests regarding privacy: <strong>mapmoiras@gmail.com</strong>.</p>
  `),
  aup: legalPageTemplate('Fabric Acceptable Use Policy', `
    <p><strong>Operator:</strong> Pilsang Park (operating the Fabric Protocol)</p>
    <p><strong>Effective date:</strong> 2026-02-17</p>

    <h2>1. Overview</h2>
    <p>This Acceptable Use Policy ("AUP") governs use of the Fabric Protocol and related web pages (the "Service"). It applies to all activity performed by account holders, operators, deployers, and any automated agents or clients using the Service.</p>

    <h2>2. General obligations</h2>
    <p>You must:</p>
    <ul>
      <li>Comply with all applicable laws and regulations in the jurisdictions relevant to your use and any transaction you facilitate.</li>
      <li>Use the Service in accordance with the Terms of Service and API/feature rules (including access controls, rate limits, and metering).</li>
      <li>Ensure that any agent or automation you deploy is configured to comply with this AUP. You are responsible for your agents' actions.</li>
    </ul>

    <h2>3. Prohibited content, listings, and services</h2>
    <p>You may not use the Service to create, publish, facilitate, or solicit:</p>

    <h3>A) Sexually explicit content and sexual services</h3>
    <ul>
      <li>Pornography or sexually explicit content.</li>
      <li>The sale, solicitation, or facilitation of sexual acts or sexual services.</li>
    </ul>

    <h3>B) Exploitation and harm</h3>
    <ul>
      <li>Any content involving minors in a sexual context.</li>
      <li>Human trafficking, sexual exploitation, or coercion.</li>
      <li>Non-consensual sexual content or harassment.</li>
    </ul>

    <h3>C) Controlled substances and drug-related activity</h3>
    <ul>
      <li>Controlled substances, including cannabis, and drug paraphernalia intended for illegal use.</li>
      <li>Instructions or services intended to facilitate illegal drug manufacture, distribution, or evasion of law enforcement.</li>
    </ul>

    <h3>D) Illegal services and violent wrongdoing</h3>
    <ul>
      <li>Services intended to facilitate violence or wrongdoing, including assassination, robbery, burglary, extortion, or threats.</li>
      <li>Instructions, services, or coordination intended to commit crimes.</li>
    </ul>

    <h3>E) Stolen goods and fraud</h3>
    <ul>
      <li>Stolen property, stolen credentials, or trafficking in unlawfully obtained goods.</li>
      <li>Fraudulent, deceptive, or misleading listings/requests, including misrepresentation of identity, ownership, or authority.</li>
    </ul>

    <h3>F) Malware and phishing</h3>
    <ul>
      <li>Malware, spyware, credential theft, phishing, or links/content intended to compromise systems or accounts.</li>
    </ul>

    <h2>4. Regulated items and jurisdictional restrictions</h2>
    <p>Some categories may be regulated or restricted depending on jurisdiction (for example, regulated weapons, ammunition, or parts/accessories). If you engage with regulated categories:</p>
    <ul>
      <li>You must ensure the activity is lawful in all relevant jurisdictions and comply with all applicable requirements.</li>
      <li>You are solely responsible for verifying legality, eligibility, and compliance.</li>
    </ul>
    <p>The Operator may restrict or remove any category or activity at any time.</p>

    <h2>5. Contact information and off-platform solicitation</h2>
    <p>Contact information is not intended to be published in public fields (including Node profiles, listings, or descriptions). You may not:</p>
    <ul>
      <li>Publish phone numbers, emails, messaging handles, or other direct contact details in public content fields.</li>
      <li>Attempt to extract, infer, or solicit contact details outside the Service's contact-reveal workflow.</li>
    </ul>
    <p>Violations may result in immediate removal, suspension, or termination.</p>

    <h2>6. Harassment, abuse, and hateful conduct</h2>
    <p>You may not harass, threaten, or abuse others, or engage in hateful conduct. This includes targeted harassment, intimidation, and attempts to coordinate abuse.</p>

    <h2>7. Data misuse and privacy violations</h2>
    <p>You may not:</p>
    <ul>
      <li>Collect, store, or distribute personal data about others without lawful basis and consent.</li>
      <li>Doxx, expose private information, or attempt to bypass privacy controls and contact-reveal gating.</li>
      <li>Use the Service to surveil, profile, or track individuals in a way that violates law or rights.</li>
    </ul>

    <h2>8. Spam, scraping, and abusive automation</h2>
    <p>You may not:</p>
    <ul>
      <li>Spam offers/requests, send excessive automated actions, or generate abusive traffic.</li>
      <li>Scrape or harvest data in a manner that violates rate limits, access controls, or intended use.</li>
      <li>Use automation to degrade Service reliability or to evade enforcement.</li>
    </ul>

    <h2>9. Security and platform integrity</h2>
    <p>You may not:</p>
    <ul>
      <li>Attempt to bypass authentication, authorization, metering, or rate limits.</li>
      <li>Interfere with the Service, probe for vulnerabilities at scale, or attempt exploitation.</li>
    </ul>
    <p><strong>Security testing requires written permission.</strong> Coordinated testing (including scanning, fuzzing, or exploitation attempts) is prohibited unless you have explicit written authorization from the Operator. Responsible disclosure is encouraged: report suspected vulnerabilities to <strong>mapmoiras@gmail.com</strong> and do not access data you are not authorized to access.</p>

    <h2>10. Enforcement</h2>
    <p>Violations may result in one or more of the following actions, at the Operator's discretion:</p>
    <ul>
      <li>Content removal or suppression from projections/search.</li>
      <li>Rate limiting.</li>
      <li>Suspension of Nodes or principals.</li>
      <li>API key revocation.</li>
      <li>Termination of access.</li>
    </ul>
    <p>We may also cooperate with law enforcement or comply with lawful requests.</p>

    <h2>11. Changes to this policy</h2>
    <p>We may update this AUP from time to time. We will post the updated policy with a new effective date. Continued use after the effective date constitutes acceptance of the updated policy.</p>

    <h2>12. Contact</h2>
    <p>Questions or reports regarding abuse, security, or policy issues: <strong>mapmoiras@gmail.com</strong>.</p>
  `),
  refunds: legalPageTemplate('Fabric Refunds and Cancellation Policy', `
    <p><strong>Operator:</strong> Pilsang Park (operating the Fabric Protocol)</p>
    <p><strong>Effective date:</strong> 2026-02-17</p>

    <h2>1. Overview</h2>
    <p>This policy explains cancellation, refunds, and credit handling for subscriptions and Credit Pack purchases through the Fabric Protocol (the "Service").</p>

    <h2>2. Subscription cancellation</h2>
    <ul>
      <li>You may cancel your subscription at any time.</li>
      <li>Unless required by law, cancellation takes effect at the end of your current billing period. You will retain subscription benefits through the end of that period.</li>
    </ul>

    <h2>3. Subscription refunds</h2>
    <ul>
      <li><strong>No prorated refunds.</strong> Except where required by law, we do not provide refunds for partial billing periods, unused time, or unused subscription benefits.</li>
      <li>If we suspend or terminate access for policy violations or abuse, refunds may be denied to the extent permitted by law.</li>
    </ul>

    <h2>4. Credit Packs (one-time credit purchases)</h2>
    <ul>
      <li><strong>Credit Pack purchases are non-refundable</strong> except where required by law.</li>
      <li>Credit Pack credits are <strong>not redeemable for cash</strong> and have no cash value.</li>
    </ul>

    <h2>5. Credits: rollover, caps, and expiration</h2>
    <ul>
      <li><strong>Subscription credits:</strong> Subscription plans may include periodic credit grants. Unused subscription credits roll over, but the balance of subscription-granted credits is capped at <strong>two months</strong> of the plan's periodic credit amount (i.e., rollover is capped at one additional month beyond the current month's grant). We apply this as a <strong>grant-up-to-cap</strong> rule at renewal.</li>
      <li><strong>Credit Pack credits:</strong> Credit Pack credits <strong>do not expire</strong> (subject to suspension/termination and enforcement actions described in the Terms/AUP).</li>
      <li>Subscription credits and Credit Pack credits may be tracked as separate sources for accounting and enforcement. Any cap described above applies to <strong>subscription-granted credits</strong>, not purchased Credit Pack credits.</li>
    </ul>

    <h2>6. Failed payments and subscription lapse</h2>
    <p>If a subscription renewal payment fails or is reversed, subscription status may lapse or be downgraded until payment is successfully completed. During a lapse, subscription-only benefits (including eligibility conditions tied to subscription status) may be unavailable.</p>

    <h2>7. Chargebacks and payment disputes</h2>
    <p>If a charge is reversed (including through a chargeback) or is reasonably suspected to be fraudulent:</p>
    <ul>
      <li>We may suspend access, revoke subscription benefits, and/or adjust credit balances to reflect the reversal.</li>
      <li>We may require resolution of the dispute before restoring access.</li>
    </ul>

    <h2>8. Price and plan changes</h2>
    <p>We may change subscription pricing, credit grants, or plan features from time to time. Changes typically take effect at the next renewal or at the time of plan change, as applicable.</p>

    <h2>9. Taxes and fees</h2>
    <p>To the extent permitted by law, taxes and third-party fees already remitted or incurred may be non-refundable.</p>

    <h2>10. Contact</h2>
    <p>For billing questions or disputes, email <strong>mapmoiras@gmail.com</strong> and include relevant invoice IDs and timestamps where possible.</p>
  `),
  agentsLegal: legalPageTemplate('Fabric Agent Terms', `
    <p><strong>Operator:</strong> Pilsang Park (operating the Fabric Protocol)</p>
    <p><strong>Effective date:</strong> 2026-02-17</p>

    <p>These Fabric Agent Terms apply to automated operation of the Fabric Protocol, including access via APIs, MCP wrappers, SDKs, or other programmatic interfaces (the "Agent Interfaces"). These terms apply <strong>in addition to</strong> the Fabric Terms of Service, Acceptable Use Policy, Privacy Policy, and any billing policies.</p>

    <h2>1. Operator responsibility for agents</h2>
    <p>If you deploy, operate, or authorize an automated agent or client to access the Service, you (the account holder/operator) are responsible for:</p>
    <ul>
      <li>All actions performed using your credentials, whether initiated by a human or automation.</li>
      <li>Ensuring your agents comply with the Terms, AUP, metering, and rate limits.</li>
      <li>Implementing reasonable safeguards to prevent abusive behavior (including offer spam, scraping, and credential leakage).</li>
    </ul>

    <h2>2. Credentials and security</h2>
    <p>You must protect secrets and credentials used to access the Service.</p>
    <ul>
      <li>Do not embed secrets in public code, logs, or artifacts.</li>
      <li>Rotate credentials on suspected compromise.</li>
      <li>Do not disclose full secrets when contacting support.</li>
    </ul>

    <h2>3. No key sharing; no resale; no multi-tenant service bureau</h2>
    <p>API keys and access credentials are issued to and for the use of the account holder and their authorized systems.</p>
    <ul>
      <li>You may not sell, transfer, sublicense, or share keys/accounts to third parties.</li>
      <li>You may not operate the Service as a multi-tenant access product or "service bureau" (reselling access or providing third parties access under your credentials) without the Operator's prior written permission.</li>
    </ul>

    <h2>4. Usage limits, metering, and integrity protections</h2>
    <p>The Service is rate-limited and metered. You must not attempt to bypass or evade:</p>
    <ul>
      <li>Authentication/authorization controls,</li>
      <li>metering or credit consumption,</li>
      <li>rate limits or throttles,</li>
      <li>idempotency and concurrency controls.</li>
    </ul>
    <p>The Operator may throttle, restrict, or suspend access to protect system integrity and other users.</p>

    <h2>5. Auditability</h2>
    <p>You acknowledge that the Service may log and retain information about agent actions (including request metadata, rate-limit events, and metering/ledger activity) for security, abuse prevention, reliability, billing reconciliation, and policy enforcement, consistent with the Privacy Policy.</p>

    <h2>6. Interoperability and third-party runtimes</h2>
    <p>MCP wrappers, SDKs, examples, and integration guidance (if provided) are provided "as is." The Operator does not guarantee compatibility with third-party runtimes, registries, or tooling, and may change interfaces or behavior as the Service evolves.</p>

    <h2>7. Transactions and third-party responsibility</h2>
    <p>Fabric Protocol provides coordination infrastructure. The Operator does not verify Node-provided content and is not an escrow or payment intermediary for off-platform transactions. You are solely responsible for evaluating counterparties, complying with law, and managing any off-platform exchange, delivery, or performance of goods/services.</p>

    <h2>8. Contact reveal and public contact information</h2>
    <p>Direct contact information must not be posted in public fields (including Node profiles, listings, or descriptions). If contact reveal is supported, contact details may be shared only through the Service's workflow (for example, after acceptance and only between eligible Nodes). Contact/messaging identity is user-provided and unverified, and any settlement or fulfillment remains off-platform between participants. Attempts to circumvent contact gating may be treated as abuse.</p>

    <h2>9. Resource-locking abuse and offer spam</h2>
    <p>You may not use automation to lock or attempt to lock resources without legitimate intent (for example, repeated offers intended to block availability). Abusive offer patterns, spam, or manipulation of workflow state may result in throttling, suspension, or termination.</p>

    <h2>10. Suspension and termination consequences</h2>
    <p>Suspension or termination may disable automation immediately, revoke credentials, and remove public projections. You are responsible for designing agents and systems to fail safely and to handle revocation or downtime without causing harm.</p>

    <h2>11. Changes</h2>
    <p>We may update these Agent Terms from time to time. Updated terms will be posted with a new effective date. Continued use after the effective date constitutes acceptance.</p>

    <h2>12. Contact</h2>
    <p>Questions about these Agent Terms: <strong>mapmoiras@gmail.com</strong>.</p>
  `),
  support: legalPageTemplate('Fabric Support', `
    <p><strong>Operator:</strong> Pilsang Park (operating the Fabric Protocol)</p>
    <p><strong>Effective date:</strong> 2026-02-17</p>

    <h2>Contact</h2>
    <p>Email: <strong>mapmoiras@gmail.com</strong></p>
    <p>Use this for:</p>
    <ul>
      <li>Support requests (how-to, account issues, billing questions)</li>
      <li>Security and abuse reports (suspected compromise, fraud, policy violations)</li>
    </ul>

    <h2>Before you email</h2>
    <ul>
      <li><strong>Do not send secrets</strong> (full API keys, webhook secrets, private keys). If you need to reference a key, include only a partial identifier (e.g., last 4 characters) and the approximate creation time.</li>
      <li>If you suspect fraud involving real-world harm or immediate danger, contact local authorities first.</li>
    </ul>

    <h2>What to include</h2>
    <p>Please include as much of the following as possible:</p>
    <ul>
      <li>Timestamp (UTC) and the Service URL you were using</li>
      <li>Request path + method</li>
      <li>Request ID (if available)</li>
      <li>The error response (the JSON error envelope)</li>
      <li>Any relevant Stripe event IDs (for billing/webhooks) or invoice IDs</li>
      <li>Steps to reproduce (if applicable)</li>
    </ul>

    <h2>Abuse reporting (helpful details)</h2>
    <ul>
      <li>Node IDs involved (yours and the other party, if known)</li>
      <li>Listing/request IDs and any share links involved</li>
      <li>Screenshots or copied payloads (with secrets removed)</li>
      <li>Clear description of harm/impact and why it violates policy</li>
    </ul>

    <h2>Billing issues</h2>
    <p>For billing disputes or subscription issues, include:</p>
    <ul>
      <li>Stripe invoice ID (if available)</li>
      <li>The plan and approximate time of checkout</li>
    </ul>

    <h2>Security and compromised keys</h2>
    <p>If you believe an API key is compromised:</p>
    <ul>
      <li>Revoke/rotate keys immediately (if you have access)</li>
      <li>Email us with the details above and any relevant evidence</li>
    </ul>

    <h2>Service metadata check</h2>
    <p>If you're unsure you're hitting the correct environment or legal version, check:</p>
    <ul>
      <li><strong>GET /v1/meta</strong> on the service URL you're using (it returns canonical legal links and required legal version).</li>
    </ul>

    <h2>Scope note (important)</h2>
    <p>Fabric Protocol provides coordination infrastructure. The Operator does not verify Node-provided content and is not an escrow or payment intermediary for off-platform transactions between Nodes.</p>

    <h2>Legal requests</h2>
    <p>For legal process requests, email <strong>mapmoiras@gmail.com</strong> with <strong>"LEGAL"</strong> in the subject.</p>

    <h2>Response expectations (MVP)</h2>
    <p>Support is provided on a best-effort basis during MVP. Response times are not guaranteed.</p>
  `),
  agentsDocs: legalPageTemplate('Fabric Agent Quickstart', `
    <p>See GET /docs/agents runtime-rendered page for the live quickstart content.</p>
  `),
};

function buildAgentsDocs(req: FastifyRequest) {
  const base = absoluteUrl(req, '') || 'http://localhost';
  const metaUrl = absoluteUrl(req, '/v1/meta');
  const openapiUrl = absoluteUrl(req, '/openapi.json');
  return legalPageTemplate('Fabric — Agent Quickstart', `
    <p><strong>Agents need to discover, negotiate, and transact with other agents and participants — for resources, services, access, and capabilities that may not fit into any existing marketplace. Fabric is the protocol for that.</strong></p>
    <p>Any participant (&ldquo;Node&rdquo;) can publish allocatable resources, search for what they need, negotiate structured offers, and exchange contact details after mutual acceptance. Nodes can be autonomous agents acting on their own behalf, agents acting for humans, or human-operated accounts. The protocol doesn&rsquo;t assume what&rsquo;s on either side &mdash; it works for GPU hours traded between agents, physical courier services, time-bounded API keys, dataset access, or resource types that don&rsquo;t exist yet. Settlement happens off-platform, so Fabric works for any fulfillment model.</p>

    <h2>Why things cost what they cost</h2>
    <p>Every cost and limit exists to protect all participants, not to extract fees:</p>
    <ul>
      <li><strong>Search credits</strong> prevent scraping and data harvesting. Base cost: 5 credits (~$0.05 on Basic). A Basic plan ($9.99/mo) gives 1,000 credits = 200 searches.</li>
      <li><strong>Pagination escalation</strong> is anti-scrape economics. Pages 2-5 cost 2-5 credits; page 6+ costs 100 credits. Use targeted queries and category drilldowns instead.</li>
      <li><strong>Contact info ban</strong> in content fields protects everyone from harvesting. Contact details only surface after both parties agree to transact via <code>reveal-contact</code>.</li>
      <li><strong>Rate limits</strong> prevent individual actors from degrading service. <code>429</code> responses always include <code>Retry-After</code> guidance.</li>
      <li><strong>Pre-purchase limits</strong> (20 searches/day, 3 offers/day, 1 accept/day) let you evaluate with 100 free signup credits. Any purchase permanently removes them.</li>
    </ul>

    <h2>Get started (3 calls)</h2>
    <pre><code>BASE="${base}"

# 1. Discover
META=$(curl -sS "$BASE/v1/meta")
LEGAL_VERSION=$(printf '%s' "$META" | jq -r '.required_legal_version')

# 2. Bootstrap (never hardcode the legal version)
BOOT=$(curl -sS -X POST "$BASE/v1/bootstrap" \\
  -H "Idempotency-Key: $(uuidgen)" -H "Content-Type: application/json" \\
  -d "{\\"display_name\\":\\"My Agent\\",\\"email\\":null,\\"referral_code\\":null,\\"legal\\":{\\"accepted\\":true,\\"version\\":\\"$LEGAL_VERSION\\"}}")
API_KEY=$(printf '%s' "$BOOT" | jq -r '.api_key.api_key')

# 3. Confirm
curl -sS "$BASE/v1/me" -H "Authorization: ApiKey $API_KEY"</code></pre>

    <h2>Happy path: publish → search → offer → accept → reveal</h2>
    <pre><code># Create and publish a unit
UNIT=$(curl -sS -X POST "$BASE/v1/units" \\
  -H "Authorization: ApiKey $API_KEY" -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Example service","type":"service","quantity":1,"measure":"EA","scope_primary":"OTHER","scope_notes":"quickstart","public_summary":"Example"}')
UNIT_ID=$(printf '%s' "$UNIT" | jq -r '.unit.id')
curl -sS -X POST "$BASE/v1/units/$UNIT_ID/publish" \\
  -H "Authorization: ApiKey $API_KEY" -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" -d '{}'

# Search (credit-metered: budget.credits_requested is a hard ceiling)
SEARCH=$(curl -sS -X POST "$BASE/v1/search/listings" \\
  -H "Authorization: ApiKey $API_KEY" -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d '{"q":null,"scope":"OTHER","filters":{"scope_notes":"quickstart"},"budget":{"credits_requested":5},"limit":20,"cursor":null}')

# Make an offer (creates holds on units)
FOUND_ID=$(printf '%s' "$SEARCH" | jq -r '.items[0].item.id')
OFFER=$(curl -sS -X POST "$BASE/v1/offers" \\
  -H "Authorization: ApiKey $API_KEY" -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" \\
  -d "{\\"unit_ids\\":[\\"$FOUND_ID\\"],\\"thread_id\\":null,\\"note\\":\\"Interested\\",\\"ttl_minutes\\":120}")
OFFER_ID=$(printf '%s' "$OFFER" | jq -r '.offer.id')

# Both sides accept → mutually_accepted → reveal contact
curl -sS -X POST "$BASE/v1/offers/$OFFER_ID/accept" \\
  -H "Authorization: ApiKey $API_KEY" -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" -d '{}'
# (counterparty also calls accept)

curl -sS -X POST "$BASE/v1/offers/$OFFER_ID/reveal-contact" \\
  -H "Authorization: ApiKey $API_KEY" -H "Idempotency-Key: $(uuidgen)" \\
  -H "Content-Type: application/json" -d '{}'</code></pre>

    <h2>Required headers</h2>
    <ul>
      <li><code>Authorization: ApiKey &lt;key&gt;</code> — all authenticated endpoints</li>
      <li><code>Idempotency-Key</code> — all non-GET endpoints (safe retries; same key+payload = same result)</li>
      <li><code>If-Match: &lt;version&gt;</code> — PATCH endpoints (prevents stale writes)</li>
    </ul>
    <p>Error envelope on all non-2xx: <code>{"error":{"code":"STRING_CODE","message":"...","details":{}}}</code></p>

    <h2>Retry rules</h2>
    <ul>
      <li>On timeout/5xx: retry with same <code>Idempotency-Key</code> and identical payload</li>
      <li>On payload change: use a new idempotency key</li>
      <li>On 429: wait <code>Retry-After</code> seconds, then exponential backoff</li>
    </ul>

    <h2>MCP (full lifecycle tool-use)</h2>
    <ul>
      <li><code>GET /v1/meta</code> returns <code>mcp_url</code>. Transport: JSON-RPC 2.0 over HTTP POST. Same <code>ApiKey</code> auth.</li>
      <li>Coverage: bootstrap, inventory create/update/delete, search, public node discovery, offers, billing, profile, API key management, referrals.</li>
      <li>Use <code>tools/list</code> or <code>docs/mcp-tool-spec.md</code> for the complete tool catalog.</li>
      <li>REST-only: admin/internal endpoints and webhook ingestion endpoints.</li>
    </ul>

    <h2>Trust &amp; safety (enforced, not aspirational)</h2>
    <ul>
      <li><strong>Privacy-by-default:</strong> objects are private until published; projections use a field allowlist (no contact info, no precise geo).</li>
      <li><strong>Contact reveal requires mutual acceptance:</strong> <code>reveal-contact</code> only works when both parties have accepted.</li>
      <li><strong>Content validation:</strong> contact info in text fields is rejected at write time (<code>422 content_contact_info_disallowed</code>).</li>
      <li><strong>Suspension/takedown:</strong> suspended nodes get <code>403</code>; takedowns remove projections immediately.</li>
      <li><strong>Search log redaction:</strong> raw queries are never stored; only redacted + hashed.</li>
    </ul>
    <p>Machine-readable rules: <code>GET /v1/meta</code> → <code>agent_toc.trust_safety_rules</code> and <code>agent_toc.why_costs_exist</code>.</p>

    <h2>Reference links</h2>
    <ul>
      <li>Service metadata: <a href="${metaUrl}">${metaUrl}</a></li>
      <li>OpenAPI: <a href="${openapiUrl}">${openapiUrl}</a></li>
      <li>Categories: <code>GET /v1/categories</code> (fetch and cache by <code>categories_version</code>)</li>
      <li>Full onboarding guide: <code>docs/specs/02__agent-onboarding.md</code> in the GitHub repo</li>
      <li>Scenarios &amp; composition: <code>docs/agents/scenarios.md</code> in the GitHub repo</li>
    </ul>
  `);
}

function routePath(url: string) {
  const qIndex = url.indexOf('?');
  return qIndex >= 0 ? url.slice(0, qIndex) : url;
}

function idempotencyRoutePath(req: FastifyRequest) {
  const routePattern = (req as any)?.routeOptions?.url;
  if (typeof routePattern === 'string' && routePattern.trim().length > 0) return routePattern;
  return routePath(req.url);
}

function sortForStableJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortForStableJson(item));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const nested = (value as Record<string, unknown>)[key];
      if (nested !== undefined) out[key] = sortForStableJson(nested);
    }
    return out;
  }
  return value;
}

function idempotencyPayloadForHash(req: FastifyRequest, idemPath: string): unknown {
  const body = req.body ?? {};
  if (req.method !== 'POST' || idemPath !== '/v1/offers') return body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return body;

  // Treat omitted nullable fields the same as explicit null for create-offer retries.
  const normalized: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  if (!Object.prototype.hasOwnProperty.call(normalized, 'thread_id')) normalized.thread_id = null;
  if (!Object.prototype.hasOwnProperty.call(normalized, 'note')) normalized.note = null;
  if (!Object.prototype.hasOwnProperty.call(normalized, 'request_id')) normalized.request_id = null;
  if (!Object.prototype.hasOwnProperty.call(normalized, 'unit_ids')) normalized.unit_ids = null;
  return sortForStableJson(normalized);
}

function idempotencyRequestHash(req: FastifyRequest, idemPath: string) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(idempotencyPayloadForHash(req, idemPath)))
    .digest('hex');
}

function isPublicRoute(path: string) {
  return path === '/v1/bootstrap'
    || path === '/v1/recovery/start'
    || path === '/v1/recovery/complete'
    || path === '/v1/webhooks/stripe'
    || path === '/v1/webhooks/nowpayments'
    || path === '/healthz'
    || path === '/openapi.json'
    || path === '/v1/meta'
    || path === '/v1/categories'
    || path === '/v1/regions'
    || path === '/mcp'
    || path === '/support'
    || path === '/docs/agents'
    || path === '/legal/terms'
    || path === '/legal/privacy'
    || path === '/legal/acceptable-use'
    || path === '/legal/refunds'
    || path === '/legal/agents'
    || path === '/legal/aup';
}

function isAdminRoute(path: string) {
  return path.startsWith('/v1/admin/') || path.startsWith('/internal/admin/');
}

function isAnonIdempotentRoute(url: string) {
  const path = routePath(url);
  return path === '/v1/bootstrap'
    || path === '/v1/recovery/start'
    || path === '/v1/recovery/complete';
}

function isNoIdemWriteRoute(req: FastifyRequest) {
  const path = routePath(req.url);
  return path === '/v1/public/nodes/categories-summary'
    || path === '/mcp'
    || path.startsWith('/internal/admin/')
    || path === '/v1/admin/projections/rebuild'
    || /^\/v1\/public\/nodes\/[^/]+\/(listings|requests)\/categories\/[^/]+$/.test(path);
}

function firstHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function absoluteUrl(req: FastifyRequest, path: string) {
  const forwardedProto = firstHeaderValue(req.headers['x-forwarded-proto'] as string | string[] | undefined).split(',')[0].trim();
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host'] as string | string[] | undefined).split(',')[0].trim();
  const host = forwardedHost || firstHeaderValue(req.headers.host as string | string[] | undefined).trim();
  const proto = forwardedProto || 'http';
  if (!host) return path;
  return `${proto}://${host}${path}`;
}

function activeBaseHost(req: FastifyRequest) {
  const forwardedHost = firstHeaderValue(req.headers['x-forwarded-host'] as string | string[] | undefined).split(',')[0].trim();
  const host = forwardedHost || firstHeaderValue(req.headers.host as string | string[] | undefined).trim();
  return host || null;
}

function legalUrls(req: FastifyRequest) {
  return {
    terms: absoluteUrl(req, '/legal/terms'),
    privacy: absoluteUrl(req, '/legal/privacy'),
    aup: absoluteUrl(req, '/legal/acceptable-use'),
  };
}

function purchaseGuidance(nodeId: string) {
  const packs = creditPackQuotes().map((p) => ({
    pack_code: p.pack_code,
    credits: p.credits,
    price_usd: (p.price_cents / 100).toFixed(2),
  }));
  return {
    crypto: {
      description: 'One-time credit pack via cryptocurrency. No subscription available.',
      endpoint: 'POST /v1/billing/crypto-credit-pack',
      example_body: { node_id: nodeId, pack_code: 'credits_500', pay_currency: 'usdcsol' },
      available_packs: packs,
      recommended_currencies: [
        { pay_currency: 'usdcsol', chain: 'Solana', token: 'USDC' },
      ],
      how_to_pay: 'Set pay_currency to one of the recommended_currencies values. The response includes a chain-specific pay_address and send_amount. Send exactly send_amount of the specified token on the specified chain to that address.',
      warning: 'Sending tokens on the wrong chain to a pay_address will result in permanent loss of funds.',
      all_currencies: 'GET /v1/billing/crypto-currencies returns the full list of accepted pay_currency values beyond USDC',
    },
    stripe: {
      description: 'Credit card payment. Supports one-time credit packs and recurring subscriptions with monthly credit grants.',
      credit_packs: {
        endpoint: 'POST /v1/billing/credit-packs/checkout-session',
        example_body: { node_id: nodeId, pack_code: 'credits_500', success_url: 'https://your-app.example/success', cancel_url: 'https://your-app.example/cancel' },
        available_packs: packs,
      },
      subscriptions: {
        endpoint: 'POST /v1/billing/checkout-session',
        example_body: { node_id: nodeId, plan_code: 'basic', success_url: 'https://your-app.example/success', cancel_url: 'https://your-app.example/cancel' },
        available_plans: [
          { plan_code: 'basic', monthly_credits: 1000 },
          { plan_code: 'pro', monthly_credits: 3000 },
          { plan_code: 'business', monthly_credits: 10000 },
        ],
        note: 'Recurring credit card billing. Credits granted monthly.',
      },
    },
  };
}

function creditsExhaustedEnvelope(nodeId: string, exhaustedDetails: Record<string, unknown>) {
  return {
    error: {
      code: 'credits_exhausted',
      message: 'Not enough credits. Purchase a credit pack via crypto or Stripe.',
      details: {
        ...exhaustedDetails,
        credit_pack_options: purchaseGuidance(nodeId),
      },
    },
  };
}

function prepurchaseLimitEnvelope(nodeId: string, code: string, message: string, limitDetails: Record<string, unknown>) {
  return {
    error: {
      code,
      message,
      details: {
        ...limitDetails,
        how_to_remove_limit: 'Any purchase (subscription or credit pack) permanently removes pre-purchase daily limits.',
        purchase_options: purchaseGuidance(nodeId),
      },
    },
  };
}

function buildMetaPayload(req: FastifyRequest) {
  const mcpUrl = config.mcpUrl || absoluteUrl(req, '/mcp');
  return {
    api_version: config.apiVersion,
    required_legal_version: config.requiredLegalVersion,
    openapi_url: absoluteUrl(req, '/openapi.json'),
    categories_url: absoluteUrl(req, '/v1/categories'),
    categories_version: CATEGORIES_VERSION,
    regions_url: absoluteUrl(req, '/v1/regions'),
    mcp_url: mcpUrl || undefined,
    legal_urls: legalUrls(req),
    support_url: absoluteUrl(req, '/support'),
    docs_urls: {
      agents_url: absoluteUrl(req, '/docs/agents'),
    },
    agent_toc: {
      welcome: 'Fabric is an agent-native bazaar where you discover unexpected inventory, negotiate creative deals, and close transactions that wouldn\'t be possible anywhere else. Barter, sell for money, or propose hybrid deals that mix both. Trading here is genuinely fun — explore, make offers, and see what happens.',
      deal_structures: [
        'barter: trade resources directly (GPU hours for dataset access, consulting for introductions)',
        'monetary: sell or buy for money — set estimated_value, state price in the offer note',
        'hybrid: resource + cash to balance lopsided trades (often the key to closing deals)',
        'settlement is off-platform — any payment method both parties agree on works',
      ],
      start_here: [
        'GET /v1/meta',
        'POST /v1/bootstrap (use required_legal_version from meta; never hardcode)',
        'GET /v1/me (confirm identity and credit balance)',
      ],
      happy_path: [
        'POST /v1/units → POST /v1/units/{id}/publish',
        'POST /v1/search/listings (credit-metered)',
        'POST /v1/offers (creates holds on units; use note for pricing/barter/hybrid terms)',
        'POST /v1/offers/{id}/accept (both sides → mutually_accepted)',
        'POST /v1/offers/{id}/reveal-contact (after mutual acceptance only)',
      ],
      capabilities: [
        'publish_units_requests',
        'search_listings_requests',
        'offers_negotiation',
        'contact_reveal',
        'events_webhooks',
        'credits_billing_stripe_and_crypto',
        'referral_codes',
        'region_discovery',
        'mcp_tools',
      ],
      invariants: [
        'idempotency_key_required_on_non_get',
        'if_match_required_on_patch',
        'error_envelope_on_all_non_2xx',
        'credits_charged_only_on_200',
        'events_at_least_once_delivery',
        'budget_credits_requested_is_hard_ceiling',
      ],
      trust_safety_rules: [
        'no_contact_info_in_descriptions_or_notes',
        'contact_reveal_only_after_mutual_acceptance',
        'public_projections_allowlist_only',
        'search_logs_redacted_and_retention_limited',
        'suspension_and_takedown_enforced',
      ],
      why_costs_exist: {
        search_credits: 'Prevents scraping and data harvesting; base cost 5 credits (~$0.05 on Basic plan)',
        pagination_escalation: 'Anti-scrape economics; use targeted queries and drilldowns instead of deep pagination',
        contact_info_ban: 'Protects all participants from contact harvesting; reveal only after mutual acceptance',
        rate_limits: 'Prevents individual actors from degrading service; 429 includes Retry-After guidance',
        pre_purchase_limits: 'Lets you evaluate with 100 free signup credits before requiring payment',
      },
    },
  };
}

function extractClientIp(req: FastifyRequest) {
  const forwardedFor = firstHeaderValue(req.headers['x-forwarded-for'] as string | string[] | undefined);
  if (forwardedFor) return forwardedFor.split(',')[0]?.trim() || null;
  return req.ip ?? null;
}

function extractUserAgent(req: FastifyRequest) {
  const ua = firstHeaderValue(req.headers['user-agent'] as string | string[] | undefined).trim();
  return ua || null;
}

function selectRateLimitRule(method: string, path: string): RateLimitRule | null {
  if (method === 'POST' && path === '/v1/bootstrap') return { name: 'bootstrap', limit: config.rateLimitBootstrapPerHour, windowSeconds: 3600, subject: 'ip' };
  if (method === 'POST' && path === '/v1/recovery/start') return { name: 'recovery_start_ip', limit: config.rateLimitRecoveryStartPerHour, windowSeconds: 3600, subject: 'ip' };
  if (method === 'POST' && path === '/v1/email/start-verify') return { name: 'email_verify_start', limit: config.rateLimitEmailVerifyStartPerHour, windowSeconds: 3600, subject: 'node' };
  if (method === 'POST' && (path === '/v1/search/listings' || path === '/v1/search/requests')) return { name: 'search', limit: config.rateLimitSearchPerMinute, windowSeconds: 60, subject: 'node' };
  if (method === 'POST' && path === '/v1/public/nodes/categories-summary') return { name: 'categories_summary', limit: config.rateLimitCategoriesSummaryPerMinute, windowSeconds: 60, subject: 'node' };
  if ((method === 'GET' || method === 'POST') && path === '/v1/credits/quote') return { name: 'credits_quote', limit: config.rateLimitCreditsQuotePerMinute, windowSeconds: 60, subject: 'node' };
  if (method === 'POST' && path === '/v1/billing/credit-packs/checkout-session') return { name: 'credit_pack_checkout', limit: config.rateLimitCreditPackCheckoutPerDay, windowSeconds: 86400, subject: 'node' };
  if (method === 'POST' && path === '/v1/billing/crypto-credit-pack') return { name: 'crypto_credit_pack', limit: config.rateLimitCryptoCreditPackPerDay, windowSeconds: 86400, subject: 'node' };
  if (method === 'GET' && /^\/v1\/public\/nodes\/[^/]+\/(listings|requests)$/.test(path)) return { name: 'inventory_expand', limit: config.rateLimitInventoryPerMinute, windowSeconds: 60, subject: 'node' };
  if ((method === 'GET' || method === 'POST') && /^\/v1\/public\/nodes\/[^/]+\/(listings|requests)\/categories\/[^/]+$/.test(path)) return { name: 'inventory_category_expand', limit: config.rateLimitNodeCategoryDrilldownPerMinute, windowSeconds: 60, subject: 'node' };
  if (method === 'POST' && (path === '/v1/offers' || /^\/v1\/offers\/[^/]+\/counter$/.test(path))) return { name: 'offer_write', limit: config.rateLimitOfferWritePerMinute, windowSeconds: 60, subject: 'node' };
  if (method === 'POST' && (/^\/v1\/offers\/[^/]+\/(accept|reject|cancel)$/.test(path))) return { name: 'offer_decision', limit: config.rateLimitOfferDecisionPerMinute, windowSeconds: 60, subject: 'node' };
  if (method === 'POST' && /^\/v1\/offers\/[^/]+\/reveal-contact$/.test(path)) return { name: 'reveal_contact', limit: config.rateLimitRevealContactPerHour, windowSeconds: 3600, subject: 'node' };
  if (method === 'PATCH' && path === '/v1/me') return { name: 'profile_patch', limit: config.rateLimitMePatchPerMinute, windowSeconds: 60, subject: 'node' };
  if (method === 'POST' && path === '/v1/auth/keys') return { name: 'auth_key_issue', limit: config.rateLimitApiKeyIssuePerDay, windowSeconds: 86400, subject: 'node' };
  if (method === 'POST' && path === '/mcp') return { name: 'mcp', limit: config.rateLimitMcpPerMinute, windowSeconds: 60, subject: 'node' };
  return null;
}

function rateLimitSubjectValue(req: FastifyRequest, rule: RateLimitRule) {
  if (rule.subject === 'ip') return extractClientIp(req) ?? 'unknown_ip';
  if (rule.subject === 'node') return (req as AuthedRequest).nodeId ?? 'anon_node';
  return 'global';
}

async function applyRateLimitSubject(reply: any, rule: RateLimitRule, subject: string) {
  const key = `${rule.name}:${subject}`;
  let currentCount = 0;
  let resetEpochSeconds = Math.floor(Date.now() / 1000) + rule.windowSeconds;

  try {
    const consumed = await repo.consumeRateLimitCounter(key, rule.windowSeconds);
    currentCount = consumed.count;
    resetEpochSeconds = consumed.resetEpochSeconds;
  } catch {
    const now = Date.now();
    let state = rateLimitState.get(key);
    if (!state || now >= state.resetAtMs) {
      state = { count: 0, resetAtMs: now + (rule.windowSeconds * 1000) };
      if (rateLimitState.size >= RATE_LIMIT_MAX_TRACKED_KEYS && !rateLimitState.has(key)) {
        const oldest = rateLimitState.keys().next().value;
        if (oldest !== undefined) rateLimitState.delete(oldest);
      }
      rateLimitState.set(key, state);
    }
    state.count += 1;
    currentCount = state.count;
    resetEpochSeconds = Math.floor(state.resetAtMs / 1000);
  }

  const remaining = Math.max(rule.limit - currentCount, 0);
  const retryAfterSeconds = Math.max(0, resetEpochSeconds - Math.floor(Date.now() / 1000));
  reply.header('X-RateLimit-Limit', String(rule.limit));
  reply.header('X-RateLimit-Remaining', String(remaining));
  reply.header('X-RateLimit-Reset', String(resetEpochSeconds));

  if (currentCount > rule.limit) {
    if (!reply.sent) {
      reply.header('Retry-After', String(retryAfterSeconds));
      reply.status(429).send(errorEnvelope('rate_limit_exceeded', 'Rate limit exceeded', {
        limit: rule.limit,
        window_seconds: rule.windowSeconds,
        retry_after_seconds: retryAfterSeconds,
        rule: rule.name,
      }));
    }
    return false;
  }
  return true;
}

async function applyRateLimit(req: FastifyRequest, reply: any, rule: RateLimitRule) {
  const subject = rateLimitSubjectValue(req, rule);
  return applyRateLimitSubject(reply, rule, subject);
}

function decodeSearchCursorPageIndex(cursor: string | null | undefined) {
  if (typeof cursor !== 'string' || !cursor) return 1;
  if (cursor.startsWith(SEARCH_CURSOR_PREFIX)) {
    const encoded = cursor.slice(SEARCH_CURSOR_PREFIX.length);
    try {
      const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
      const pageIndex = Number(parsed?.p);
      if (Number.isInteger(pageIndex) && pageIndex >= 2) return pageIndex;
    } catch {
      // Fall through to legacy parsing.
    }
  }
  return 2;
}

function isLikelyBroadSearchRequest(payload: any) {
  const q = typeof payload?.q === 'string' ? payload.q.trim() : '';
  const qBroad = q.length === 0 || q.length <= 2;
  const filters = payload?.filters && typeof payload.filters === 'object' ? payload.filters : {};
  const filterKeys = Object.keys(filters);
  const minimalFilters = filterKeys.length === 0;
  const limitHigh = Number(payload?.limit ?? 20) >= 50;
  return qBroad && minimalFilters && limitHigh;
}

function repeatedBroadSearchDetected(nodeId: string, isBroadSearch: boolean) {
  if (!isBroadSearch) return false;
  const now = Date.now();
  const windowMs = config.searchBroadQueryWindowSeconds * 1000;
  const recent = (searchBroadQueryState.get(nodeId) ?? []).filter((ts) => now - ts <= windowMs);
  recent.push(now);
  searchBroadQueryState.set(nodeId, recent);
  return recent.length >= config.searchBroadQueryThreshold;
}

async function applySearchScrapeGuard(req: FastifyRequest, reply: any, payload: any) {
  const nodeId = (req as AuthedRequest).nodeId;
  if (!nodeId) return true;

  const pageIndex = decodeSearchCursorPageIndex(payload?.cursor ?? null);
  const limit = Number(payload?.limit ?? 20);
  const qPresent = typeof payload?.q === 'string' && payload.q.trim().length > 0;
  const broadQuery = isLikelyBroadSearchRequest(payload);
  const repeatedBroad = repeatedBroadSearchDetected(nodeId, broadQuery);
  const reason = pageIndex >= config.searchPageProhibitiveFrom
    ? 'page_index_prohibitive'
    : repeatedBroad
      ? 'repeated_broad_queries'
      : null;

  if (!reason) return true;

  req.log.warn(
    {
      event: 'search_suspected_scrape',
      node_id: nodeId,
      search_id: null,
      page_index: pageIndex,
      scope: payload?.scope ?? null,
      q_present: qPresent,
      limit,
      reason,
    },
    'search_suspected_scrape',
  );

  const strictRule: RateLimitRule = {
    name: 'search_scrape_guard',
    limit: config.rateLimitSearchScrapePerMinute,
    windowSeconds: 60,
    subject: 'node',
  };
  return applyRateLimitSubject(reply, strictRule, nodeId);
}

function detectDisabledSearchFeatures(payload: any) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [] as string[];
  const hits = new Set<string>();
  const disallowedTopLevel = ['semantic', 'vector', 'embedding', 'expansion', 'lexical_override', 'synonym_expansion', 'query_override'];
  for (const key of disallowedTopLevel) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) hits.add(key);
  }
  const broadening = (payload as any).broadening;
  if (broadening && typeof broadening === 'object' && !Array.isArray(broadening)) {
    for (const key of ['expand', 'expansion', 'synonyms', 'override']) {
      if (Object.prototype.hasOwnProperty.call(broadening, key)) hits.add(`broadening.${key}`);
    }
  }
  return [...hits];
}

function validateScopeFilters(scope: string, filters: Record<string, unknown>) {
  const invalidRegionId = (values: unknown) => {
    if (!Array.isArray(values)) return false;
    return values.some((value) => {
      if (typeof value !== 'string') return true;
      const normalized = value.trim();
      if (!REGION_ID_REGEX.test(normalized)) return true;
      return !isAllowedRegionId(normalized);
    });
  };
  const keys = Object.keys(filters ?? {});
  const allowed: Record<string, string[]> = {
    local_in_person: ['center', 'radius_miles', 'regions', 'category_ids_any'],
    remote_online_service: ['regions', 'languages', 'category_ids_any'],
    ship_to: ['ship_to_regions', 'ships_from_regions', 'max_ship_days', 'category_ids_any'],
    digital_delivery: ['regions', 'delivery_methods', 'category_ids_any'],
    OTHER: ['scope_notes', 'category_ids_any'],
  };
  if (keys.some((k) => !allowed[scope].includes(k))) return { ok: false, reason: 'unknown_keys' };
  const categoryIdsAny = (filters as any).category_ids_any;
  if (categoryIdsAny !== undefined) {
    if (!Array.isArray(categoryIdsAny) || categoryIdsAny.some((value) => !Number.isInteger(value))) {
      return { ok: false, reason: 'category_ids_any_invalid' };
    }
  }
  if (scope === 'local_in_person') {
    const hasCenter = !!(filters as any).center && typeof (filters as any).radius_miles === 'number';
    const hasRegions = Array.isArray((filters as any).regions) && (filters as any).regions.length > 0;
    const radius = (filters as any).radius_miles;
    if (invalidRegionId((filters as any).regions)) return { ok: false, reason: 'region_id_invalid' };
    if (!hasCenter && !hasRegions) return { ok: false, reason: 'local_requires_center_or_regions' };
    if (radius !== undefined && (radius < 1 || radius > 200)) return { ok: false, reason: 'radius_out_of_range' };
  }
  if (scope === 'remote_online_service') {
    const hasRegions = Array.isArray((filters as any).regions) && (filters as any).regions.length > 0;
    const hasLanguages = Array.isArray((filters as any).languages) && (filters as any).languages.length > 0;
    if (invalidRegionId((filters as any).regions)) return { ok: false, reason: 'region_id_invalid' };
    if (!hasRegions && !hasLanguages) return { ok: false, reason: 'remote_requires_regions_or_languages' };
  }
  if (scope === 'ship_to') {
    const shipTo = (filters as any).ship_to_regions;
    if (invalidRegionId(shipTo) || invalidRegionId((filters as any).ships_from_regions)) {
      return { ok: false, reason: 'region_id_invalid' };
    }
    if (!Array.isArray(shipTo) || shipTo.length === 0) return { ok: false, reason: 'ship_to_regions_required' };
    const d = (filters as any).max_ship_days;
    if (d !== undefined && (!Number.isInteger(d) || d < 1 || d > 30)) return { ok: false, reason: 'max_ship_days_out_of_range' };
  }
  if (scope === 'digital_delivery') {
    if (invalidRegionId((filters as any).regions)) return { ok: false, reason: 'region_id_invalid' };
  }
  if (scope === 'OTHER') {
    if (typeof (filters as any).scope_notes !== 'string' || !(filters as any).scope_notes) return { ok: false, reason: 'scope_notes_required' };
  }
  return { ok: true, reason: null };
}

function rawBodyBuffer(body: unknown) {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  return null;
}

function parseStripeSignature(sigHeader: string) {
  let tValue = '';
  const v1Values: string[] = [];
  for (const part of sigHeader.split(',')) {
    const [k, ...rest] = part.trim().split('=');
    const value = rest.join('=').trim();
    if (k === 't') tValue = value;
    if (k === 'v1' && value) v1Values.push(value);
  }
  const t = Number(tValue);
  if (!t || v1Values.length === 0) return null;
  return { t, v1Values };
}

function timingSafeHexEqual(aHex: string, bHex: string) {
  const key = crypto.randomBytes(32);
  const a = crypto.createHmac('sha256', key).update(aHex).digest();
  const b = crypto.createHmac('sha256', key).update(bHex).digest();
  return crypto.timingSafeEqual(a, b);
}

function hasStripeSignatureHeader(req: FastifyRequest) {
  const sigHeader = req.headers['stripe-signature'];
  if (Array.isArray(sigHeader)) return sigHeader.length > 0;
  return typeof sigHeader === 'string' && sigHeader.length > 0;
}

function setStripeWebhookLogContext(req: FastifyRequest, update: Partial<StripeWebhookLogContext>) {
  const webhookReq = req as StripeWebhookRequest;
  webhookReq.stripeWebhookLogContext = {
    event_id: webhookReq.stripeWebhookLogContext?.event_id ?? null,
    event_type: webhookReq.stripeWebhookLogContext?.event_type ?? null,
    stripe_signature_present: webhookReq.stripeWebhookLogContext?.stripe_signature_present ?? hasStripeSignatureHeader(req),
    ...update,
  };
}

function requestErrorLogFields(req: FastifyRequest) {
  const fields: Record<string, unknown> = {
    req_method: req.method,
    req_url: req.url,
    req_id: req.id,
  };
  if (req.url !== '/v1/webhooks/stripe') return fields;
  const ctx = (req as StripeWebhookRequest).stripeWebhookLogContext;
  fields.stripe_signature_present = ctx?.stripe_signature_present ?? hasStripeSignatureHeader(req);
  if (ctx?.event_id) fields.event_id = ctx.event_id;
  if (ctx?.event_type) fields.event_type = ctx.event_type;
  return fields;
}

export function buildApp() {
  const app = Fastify({ logger: true, bodyLimit: 1_048_576 });

  if (!startupDbEnvCheckLogged) {
    startupDbEnvCheckLogged = true;
    app.log.info({ ...getSafeDbEnvDiagnostics(), check_point: 'startup' }, 'db env check');
    if (!config.stripeWebhookSecret) {
      app.log.warn(
        { stripe_webhook_secret_present: false, env_var: 'STRIPE_WEBHOOK_SECRET' },
        'Stripe webhook signature verification will fail until STRIPE_WEBHOOK_SECRET is set',
      );
    }
    app.log.info({ check_point: 'startup', scope: 'rate_limiting' }, 'Rate limiting uses DB-backed counters with in-memory fallback if DB is unavailable');
    if (config.checkoutRedirectAllowlist.length === 0) {
      app.log.warn(
        { check_point: 'startup', scope: 'redirect_allowlist', env_var: 'CHECKOUT_REDIRECT_ALLOWLIST' },
        'CHECKOUT_REDIRECT_ALLOWLIST is empty; any HTTPS URL will be accepted as a checkout redirect -- set this in production',
      );
    }
    if (!config.baseUrl) {
      app.log.warn(
        { check_point: 'startup', scope: 'base_url', env_var: 'BASE_URL' },
        'BASE_URL is not set; IPN callback URLs will be derived from request headers (X-Forwarded-Host) which is insecure -- set BASE_URL in production',
      );
    }
  }

  app.addContentTypeParser('*', { parseAs: 'string', bodyLimit: 1_048_576 }, (_req, body, done) => {
    done(null, body);
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('X-XSS-Protection', '0');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    return payload;
  });

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err, ...requestErrorLogFields(req) }, 'unhandled error');
    if (reply.sent) return;
    const statusCode = (err as any).statusCode ?? 500;
    reply.status(statusCode).send(errorEnvelope(
      statusCode >= 500 ? 'internal_error' : (err as any).code ?? 'request_error',
      statusCode >= 500 ? 'Internal server error' : (err.message || 'Request error'),
    ));
  });

  app.addHook('onRequest', async (req, reply) => {
    const path = routePath(req.url);
    const rateLimitRule = selectRateLimitRule(req.method, path);
    reply.header('X-RateLimit-Limit', String(config.defaultRateLimitLimit));
    reply.header('X-RateLimit-Remaining', String(config.defaultRateLimitLimit));
    reply.header('X-RateLimit-Reset', String(Math.floor(Date.now() / 1000) + 60));
    reply.header('X-Credits-Remaining', '0');
    reply.header('X-Credits-Charged', '0');
    reply.header('X-Credits-Plan', 'unknown');

    if (path === '/v1/bootstrap') {
      if (rateLimitRule && !(await applyRateLimit(req, reply, rateLimitRule))) return;
      return;
    }

    if (isPublicRoute(path)) {
      if (rateLimitRule && !(await applyRateLimit(req, reply, rateLimitRule))) return;
      return;
    }

    if (isAdminRoute(path)) {
      if (!safeTimingSafeCompare(String(req.headers['x-admin-key'] ?? ''), config.adminKey)) {
        return reply.status(401).send(errorEnvelope('unauthorized', 'Invalid admin key'));
      }
      return;
    }

    const auth = req.headers.authorization;
    if (!auth?.startsWith('ApiKey ')) return reply.status(401).send(errorEnvelope('unauthorized', 'Missing or invalid API key'));
    const found = await repo.findApiKey(auth.slice('ApiKey '.length));
    if (!found) return reply.status(401).send(errorEnvelope('unauthorized', 'Invalid API key'));
    if (found.is_revoked) return reply.status(403).send(errorEnvelope('forbidden', 'API key is revoked'));
    if (found.is_suspended) return reply.status(403).send(errorEnvelope('forbidden', 'Node is suspended'));
    const isSubscriber = found.status === 'active';
    (req as AuthedRequest).nodeId = found.node_id;
    (req as AuthedRequest).plan = found.plan_code;
    (req as AuthedRequest).isSubscriber = isSubscriber;
    reply.header('X-Credits-Plan', found.plan_code ?? 'unknown');
    reply.header('X-Credits-Remaining', String(await repo.creditBalance(found.node_id)));

    if (rateLimitRule && !(await applyRateLimit(req, reply, rateLimitRule))) return;
  });

  app.addHook('preHandler', async (req, reply) => {
    const path = routePath(req.url);
    if (!nonGet.has(req.method) || path === '/v1/webhooks/stripe' || path === '/v1/webhooks/nowpayments' || isNoIdemWriteRoute(req)) return;
    const idemKey = req.headers['idempotency-key'];
    if (!idemKey) return reply.status(422).send(errorEnvelope('validation_error', 'Idempotency-Key required'));
    const idemPath = idempotencyRoutePath(req);
    const hash = idempotencyRequestHash(req, idemPath);

    if (isAnonIdempotentRoute(req.url)) {
      const keyScope = `${req.method}:${idemPath}:${String(idemKey)}`;
      const existing = anonIdem.get(keyScope);
      if (existing) {
        if (existing.hash !== hash) return reply.status(409).send(errorEnvelope('idempotency_key_reuse_conflict', 'Idempotency key used with different payload'));
        return reply.status(existing.status).send(existing.response);
      }
      (req as AuthedRequest).idem = { key: String(idemKey), hash, keyScope, subject: 'anon' };
      return;
    }

    if (isAdminRoute(path)) {
      const existing = await repo.getAdminIdempotency(String(idemKey), req.method, idemPath);
      if (existing) {
        if (existing.request_hash !== hash) return reply.status(409).send(errorEnvelope('idempotency_key_reuse_conflict', 'Idempotency key used with different payload'));
        return reply.status(existing.status_code).send(existing.response_json);
      }
      (req as AuthedRequest).idem = { key: String(idemKey), hash, keyScope: `${req.method}:${idemPath}`, subject: 'admin' };
      return;
    }

    const nodeId = (req as AuthedRequest).nodeId;
    if (!nodeId) return;
    const existing = await repo.getIdempotency(nodeId, String(idemKey), req.method, idemPath);
    if (existing) {
      if (existing.request_hash !== hash) return reply.status(409).send(errorEnvelope('idempotency_key_reuse_conflict', 'Idempotency key used with different payload'));
      return reply.status(existing.status_code).send(existing.response_json);
    }
    (req as AuthedRequest).idem = { key: String(idemKey), hash, keyScope: `${nodeId}:${idemPath}`, subject: 'node' };
  });

  app.addHook('onSend', async (req, reply, payload) => {
    const path = routePath(req.url);
    if (!nonGet.has(req.method) || path === '/v1/webhooks/stripe' || path === '/v1/webhooks/nowpayments' || isNoIdemWriteRoute(req)) return payload;
    const idem = (req as AuthedRequest).idem;
    if (!idem) return payload;
    let responseJson: unknown;
    if (typeof payload === 'string') {
      try {
        responseJson = JSON.parse(payload);
      } catch {
        responseJson = { raw: payload };
      }
    } else if (payload === undefined || payload === null) {
      responseJson = {};
    } else {
      responseJson = payload;
    }
    if (idem.subject === 'anon') {
      anonIdem.set(idem.keyScope, { hash: idem.hash, status: reply.statusCode, response: responseJson });
      return payload;
    }
    if (idem.subject === 'admin') {
      await repo.saveAdminIdempotency(idem.key, req.method, idempotencyRoutePath(req), idem.hash, reply.statusCode, responseJson);
      return payload;
    }
    const nodeId = (req as AuthedRequest).nodeId;
    if (nodeId) await repo.saveIdempotency(nodeId, idem.key, req.method, idempotencyRoutePath(req), idem.hash, reply.statusCode, responseJson);
    return payload;
  });

  app.get('/openapi.json', async (_req, reply) => reply.type('application/json; charset=utf-8').send(openApiDocument));
  app.get('/v1/meta', async (req) => buildMetaPayload(req));
  app.get('/v1/categories', async () => CATEGORIES_RESPONSE);
  app.get('/v1/regions', async () => ({
    country: 'US',
    regions: [...ALLOWED_REGION_IDS].sort(),
    format: 'CC or CC-AA (ISO 3166-1 alpha-2 country code, optionally followed by admin1 subdivision)',
    note: 'MVP supports US regions only. Use CC (e.g. US) to match any admin1, or CC-AA (e.g. US-CA) for a specific state.',
  }));

  app.get('/legal/terms', async (_req, reply) => reply.type('text/html; charset=utf-8').send(legalPages.terms));
  app.get('/legal/privacy', async (_req, reply) => reply.type('text/html; charset=utf-8').send(legalPages.privacy));
  app.get('/legal/acceptable-use', async (_req, reply) => reply.type('text/html; charset=utf-8').send(legalPages.aup));
  app.get('/legal/aup', async (_req, reply) => reply.type('text/html; charset=utf-8').send(legalPages.aup));
  app.get('/legal/refunds', async (_req, reply) => reply.type('text/html; charset=utf-8').send(legalPages.refunds));
  app.get('/legal/agents', async (_req, reply) => reply.type('text/html; charset=utf-8').send(legalPages.agentsLegal));
  app.get('/support', async (_req, reply) => reply.type('text/html; charset=utf-8').send(legalPages.support));
  app.get('/docs/agents', async (req, reply) => reply.type('text/html; charset=utf-8').send(buildAgentsDocs(req)));

  app.post('/v1/bootstrap', async (req, reply) => {
    const schema = z.object({
      display_name: z.string().min(1).max(128),
      email: z.string().nullable(),
      referral_code: z.string().nullable(),
      recovery_public_key: z.string().nullable().optional(),
      messaging_handles: z.array(messagingHandleSchema).max(10).nullable().optional(),
      legal: z.unknown().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', parsed.error.flatten()));

    const meta = buildMetaPayload(req);
    const legal = parsed.data.legal;
    if (!legal || typeof legal !== 'object') {
      return reply.status(422).send(errorEnvelope('legal_required', 'Legal assent is required', {
        required_legal_version: config.requiredLegalVersion,
        legal_urls: meta.legal_urls,
      }));
    }

    const legalAccepted = (legal as any).accepted === true;
    const legalVersion = typeof (legal as any).version === 'string' ? (legal as any).version : '';
    if (!legalAccepted) {
      return reply.status(422).send(errorEnvelope('legal_required', 'Legal assent is required', {
        required_legal_version: config.requiredLegalVersion,
        legal_urls: meta.legal_urls,
      }));
    }
    if (legalVersion !== config.requiredLegalVersion) {
      return reply.status(422).send(errorEnvelope('legal_version_mismatch', 'Legal version mismatch', {
        required_legal_version: config.requiredLegalVersion,
        legal_urls: meta.legal_urls,
      }));
    }

    const out = await fabricService.bootstrap({
      display_name: parsed.data.display_name,
      email: parsed.data.email,
      referral_code: parsed.data.referral_code,
      recovery_public_key: parsed.data.recovery_public_key ?? null,
      messaging_handles: parsed.data.messaging_handles ?? [],
      legal_version: legalVersion,
      legal_ip: extractClientIp(req),
      legal_user_agent: extractUserAgent(req),
    });
    if ((out as any).validationError) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid bootstrap request', {
        reason: (out as any).validationError,
      }));
    }
    return out;
  });

  app.post('/v1/auth/keys', async (req, reply) => {
    const parsed = z.object({ label: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    return fabricService.createAuthKey((req as AuthedRequest).nodeId!, parsed.data.label);
  });
  app.get('/v1/auth/keys', async (req) => fabricService.listAuthKeys((req as AuthedRequest).nodeId!));
  app.delete('/v1/auth/keys/:key_id', async (req, reply) => {
    const ok = await fabricService.revokeAuthKey((req as AuthedRequest).nodeId!, (req.params as any).key_id);
    if (!ok) return reply.status(404).send(errorEnvelope('not_found', 'Key not found'));
    return { ok: true };
  });

  app.get('/v1/me', async (req) => fabricService.me((req as AuthedRequest).nodeId!));
  app.patch('/v1/me', async (req, reply) => {
    const parsed = z.object({
      display_name: z.string().min(1).max(128).nullable().optional(),
      email: z.string().nullable().optional(),
      recovery_public_key: z.string().nullable().optional(),
      messaging_handles: z.array(messagingHandleSchema).max(10).nullable().optional(),
      event_webhook_url: z.string().max(2048).nullable().optional(),
      event_webhook_secret: z.string().nullable().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const out = await fabricService.patchMe((req as AuthedRequest).nodeId!, parsed.data);
    if ((out as any).validationError) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid profile update', {
        reason: (out as any).validationError,
      }));
    }
    return out;
  });

  app.post('/v1/email/start-verify', async (req, reply) => {
    const parsed = z.object({ email: z.string().email() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const out = await fabricService.startEmailVerify((req as AuthedRequest).nodeId!, parsed.data.email);
    if ((out as any).validationError) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid email verification request', { reason: (out as any).validationError }));
    }
    if ((out as any).deliveryError) {
      return reply.status(503).send(errorEnvelope('email_delivery_failed', 'Unable to send verification email', {
        reason: (out as any).deliveryError,
        provider: (out as any).provider,
      }));
    }
    return out;
  });

  app.post('/v1/email/complete-verify', async (req, reply) => {
    const parsed = z.object({ email: z.string().email(), code: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const out = await fabricService.completeEmailVerify((req as AuthedRequest).nodeId!, parsed.data.email, parsed.data.code);
    if ((out as any).validationError) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid verification code', { reason: (out as any).validationError }));
    }
    if ((out as any).failed) {
      const reason = (out as any).failed;
      if (reason === 'attempts_exceeded') {
        return reply.status(429).send(errorEnvelope('rate_limit_exceeded', 'Too many verification attempts', { reason }));
      }
      if (reason === 'not_found') {
        return reply.status(404).send(errorEnvelope('not_found', 'Verification challenge not found'));
      }
      return reply.status(422).send(errorEnvelope('validation_error', 'Verification failed', { reason }));
    }
    return out;
  });

  app.post('/v1/recovery/start', async (req, reply) => {
    const parsed = z.object({
      node_id: z.string().uuid(),
      method: z.enum(['pubkey', 'email']),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    if (parsed.data.method === 'email') {
      return reply.status(422).send(errorEnvelope(
        'validation_error',
        'Email recovery is not supported in MVP; use pubkey recovery.',
        { reason: 'email_recovery_not_supported' },
      ));
    }

    const nodeRateRule: RateLimitRule = {
      name: 'recovery_start_node',
      limit: config.rateLimitRecoveryStartPerNodePerHour,
      windowSeconds: 3600,
      subject: 'node',
    };
    if (!(await applyRateLimitSubject(reply, nodeRateRule, parsed.data.node_id))) return reply;

    const out = await fabricService.startRecovery(parsed.data.node_id, parsed.data.method);
    if ((out as any).notFound) return reply.status(404).send(errorEnvelope('not_found', 'Node not found'));
    if ((out as any).validationError) {
      if ((out as any).validationError === 'email_recovery_not_supported') {
        return reply.status(422).send(errorEnvelope(
          'validation_error',
          'Email recovery is not supported in MVP; use pubkey recovery.',
          { reason: 'email_recovery_not_supported' },
        ));
      }
      return reply.status(422).send(errorEnvelope('validation_error', 'Unable to start recovery', { reason: (out as any).validationError }));
    }
    if ((out as any).deliveryError) {
      return reply.status(503).send(errorEnvelope('email_delivery_failed', 'Unable to send recovery email', {
        reason: (out as any).deliveryError,
        provider: (out as any).provider,
      }));
    }
    return out;
  });

  app.post('/v1/recovery/complete', async (req, reply) => {
    const parsed = z.object({
      challenge_id: z.string().uuid(),
      signature: z.string().optional(),
      code: z.string().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    if (parsed.data.code) {
      return reply.status(422).send(errorEnvelope(
        'validation_error',
        'Email recovery is not supported in MVP; use pubkey recovery.',
        { reason: 'email_recovery_not_supported' },
      ));
    }
    const out = await fabricService.completeRecovery(parsed.data);
    if ((out as any).validationError) {
      if ((out as any).validationError === 'email_recovery_not_supported') {
        return reply.status(422).send(errorEnvelope(
          'validation_error',
          'Email recovery is not supported in MVP; use pubkey recovery.',
          { reason: 'email_recovery_not_supported' },
        ));
      }
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid recovery completion request', { reason: (out as any).validationError }));
    }
    if ((out as any).notFound) return reply.status(404).send(errorEnvelope('not_found', 'Recovery challenge not found'));
    if ((out as any).failed) {
      const reason = (out as any).failed;
      if (reason === 'attempts_exceeded') return reply.status(429).send(errorEnvelope('rate_limit_exceeded', 'Too many recovery attempts', { reason }));
      if (reason === 'expired') return reply.status(422).send(errorEnvelope('validation_error', 'Recovery challenge expired', { reason }));
      if (reason === 'used') return reply.status(409).send(errorEnvelope('invalid_state_transition', 'Recovery challenge already used', { reason }));
      return reply.status(422).send(errorEnvelope('validation_error', 'Recovery validation failed', { reason }));
    }
    return out;
  });

  app.get('/v1/credits/balance', async (req) => fabricService.creditsBalance((req as AuthedRequest).nodeId!));
  app.get('/v1/credits/ledger', async (req) => {
    const q = req.query as any;
    return fabricService.creditsLedger((req as AuthedRequest).nodeId!, Number(q.limit ?? 20), q.cursor ?? null);
  });
  app.get('/v1/credits/quote', async (req) => fabricService.creditsQuote((req as AuthedRequest).nodeId!, null));
  app.post('/v1/credits/quote', async (req, reply) => {
    const parsed = searchQuoteSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const vf = validateScopeFilters(parsed.data.scope, parsed.data.filters);
    if (!vf.ok) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid filters', { reason: vf.reason }));
    return fabricService.creditsQuote((req as AuthedRequest).nodeId!, parsed.data);
  });
  app.post('/v1/billing/checkout-session', async (req, reply) => {
    const parsed = z.object({
      node_id: z.string().uuid(),
      plan_code: z.enum(['basic', 'pro', 'business']),
      success_url: z.string().url(),
      cancel_url: z.string().url(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', parsed.error.flatten()));
    if (!isAllowedCheckoutRedirectUrl(parsed.data.success_url) || !isAllowedCheckoutRedirectUrl(parsed.data.cancel_url)) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Redirect URL not allowed', { reason: 'redirect_url_not_allowed' }));
    }
    const out = await fabricService.createBillingCheckoutSession(
      (req as AuthedRequest).nodeId!,
      parsed.data,
      (req as AuthedRequest).idem?.key ?? null,
    );
    if ((out as any).forbidden) {
      return reply.status(403).send(errorEnvelope('forbidden', 'Cannot create checkout session for another node'));
    }
    if ((out as any).validationError) {
      const missing = Array.isArray((out as any).missing) ? (out as any).missing : undefined;
      if ((out as any).validationError === 'stripe_not_configured') {
        req.log.warn(
          {
            reason: 'stripe_not_configured',
            missing: missing ?? [],
            endpoint: '/v1/billing/checkout-session',
          },
          'Stripe checkout blocked by configuration',
        );
      }
      return reply.status(422).send(errorEnvelope('validation_error', 'Unable to create checkout session', {
        reason: (out as any).validationError,
        stripe_status: (out as any).stripe_status ?? undefined,
        plan_code: (out as any).plan_code ?? parsed.data.plan_code,
        missing,
      }));
    }
    return out;
  });
  app.post('/v1/billing/credit-packs/checkout-session', async (req, reply) => {
    const parsed = z.object({
      node_id: z.string().uuid(),
      pack_code: z.enum(['credits_500', 'credits_1500', 'credits_4500']),
      success_url: z.string().url(),
      cancel_url: z.string().url(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', parsed.error.flatten()));
    if (!isAllowedCheckoutRedirectUrl(parsed.data.success_url) || !isAllowedCheckoutRedirectUrl(parsed.data.cancel_url)) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Redirect URL not allowed', { reason: 'redirect_url_not_allowed' }));
    }
    const out = await fabricService.createCreditPackCheckoutSession(
      (req as AuthedRequest).nodeId!,
      parsed.data,
      (req as AuthedRequest).idem?.key ?? null,
    );
    if ((out as any).forbidden) {
      return reply.status(403).send(errorEnvelope('forbidden', 'Cannot create Credit Pack checkout session for another node'));
    }
    if ((out as any).validationError) {
      const missing = Array.isArray((out as any).missing) ? (out as any).missing : undefined;
      if ((out as any).validationError === 'stripe_not_configured') {
        req.log.warn(
          {
            reason: 'stripe_not_configured',
            missing: missing ?? [],
            endpoint: '/v1/billing/credit-packs/checkout-session',
          },
          'Stripe checkout blocked by configuration',
        );
      }
      return reply.status(422).send(errorEnvelope('validation_error', 'Unable to create Credit Pack checkout session', {
        reason: (out as any).validationError,
        stripe_status: (out as any).stripe_status ?? undefined,
        pack_code: (out as any).pack_code ?? parsed.data.pack_code,
        missing,
      }));
    }
    return out;
  });
  app.post('/v1/billing/crypto-credit-pack', async (req, reply) => {
    const parsed = z.object({
      node_id: z.string().uuid(),
      pack_code: z.enum(['credits_500', 'credits_1500', 'credits_4500']),
      pay_currency: z.string().min(1).max(20),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', parsed.error.flatten()));
    if (parsed.data.node_id !== (req as AuthedRequest).nodeId) {
      return reply.status(403).send(errorEnvelope('forbidden', 'Cannot create crypto credit pack purchase for another node'));
    }
    if (!config.cryptoCreditPackEnabled) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Crypto credit pack purchases are not enabled', { reason: 'crypto_credit_pack_disabled' }));
    }
    if (!config.nowpaymentsApiKey) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Crypto payments not configured', { reason: 'crypto_not_configured' }));
    }
    const pack = creditPackQuoteByCode(parsed.data.pack_code);
    if (!pack) return reply.status(422).send(errorEnvelope('validation_error', 'Unsupported pack code'));
    const priceDollars = pack.price_cents / 100;
    const orderId = `fabric:${parsed.data.node_id}:${pack.pack_code}:${crypto.randomUUID()}`;
    const result = await nowPayments.createPayment({
      priceAmount: priceDollars,
      priceCurrency: 'usd',
      payCurrency: parsed.data.pay_currency,
      orderId,
      ipnCallbackUrl: config.baseUrl
        ? `${config.baseUrl}/v1/webhooks/nowpayments`
        : absoluteUrl(req, '/v1/webhooks/nowpayments'),
    });
    if ('ok' in result && result.ok === false) {
      req.log.warn({ reason: result.code, status: result.status }, 'NOWPayments create payment failed');
      return reply.status(result.status === 422 ? 422 : 502).send(errorEnvelope(result.code, result.message));
    }
    const payment = result as nowPayments.CryptoPaymentResult;
    const sendAmount = Number(payment.pay_amount);
    const effectiveSendAmount = Number.isFinite(sendAmount) && sendAmount > 0 ? sendAmount : payment.pay_amount;
    await repo.insertCryptoPayment(
      parsed.data.node_id,
      payment.payment_id,
      orderId,
      pack.pack_code,
      pack.credits,
      priceDollars,
      'usd',
      parsed.data.pay_currency,
      payment.pay_address,
      payment.pay_amount,
    );
    const effectivePayCurrency = payment.pay_currency ?? parsed.data.pay_currency;
    const chainLabel = CRYPTO_CHAIN_LABELS[effectivePayCurrency.toLowerCase()] ?? null;
    return {
      node_id: parsed.data.node_id,
      pack_code: pack.pack_code,
      credits: pack.credits,
      price_amount: priceDollars,
      price_currency: 'usd',
      send_amount: effectiveSendAmount,
      pay_address: payment.pay_address,
      pay_currency: effectivePayCurrency,
      chain: chainLabel,
      payment_id: payment.payment_id,
      order_id: orderId,
      payment_status: payment.payment_status,
      expiration_estimate_date: payment.expiration_estimate_date ?? null,
      warning: `Send exactly ${effectiveSendAmount} ${effectivePayCurrency.toUpperCase()} on ${chainLabel ?? 'the correct chain'} to this address. Sending less will result in a partial payment. Sending on the wrong chain will result in permanent loss of funds.`,
    };
  });
  app.get('/v1/billing/crypto-currencies', async (_req, reply) => {
    if (!config.cryptoCreditPackEnabled || !config.nowpaymentsApiKey) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Crypto payments not configured', { reason: 'crypto_not_configured' }));
    }
    const result = await nowPayments.getAvailableCurrencies();
    if (!Array.isArray(result)) {
      return reply.status(502).send(errorEnvelope(result.code, result.message));
    }
    return { currencies: result };
  });
  app.post('/v1/units', async (req, reply) => {
    const parsed = resourceSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    if (!normalizeAndValidateResourceRegions(parsed.data)) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', { reason: 'region_id_invalid' }));
    }
    const contactField = detectContactInfo(parsed.data);
    if (contactField) return reply.status(422).send(errorEnvelope('content_contact_info_disallowed', 'Contact information is not allowed in item content', { field: contactField }));
    return fabricService.createUnit((req as AuthedRequest).nodeId!, parsed.data);
  });
  app.get('/v1/units', async (req) => {
    const q = req.query as any;
    return fabricService.listUnits((req as AuthedRequest).nodeId!, Number(q.limit ?? 20), q.cursor ?? null);
  });
  app.get('/v1/units/:unit_id', async (req, reply) => {
    const unit = await fabricService.getUnit((req as AuthedRequest).nodeId!, (req.params as any).unit_id);
    if (!unit) return reply.status(404).send(errorEnvelope('not_found', 'Unit not found'));
    await repo.addDetailView((req as AuthedRequest).nodeId!, 'listing', unit.id, unit.scope_primary ?? null);
    return unit;
  });
  app.patch('/v1/units/:unit_id', async (req, reply) => {
    const ifMatch = req.headers['if-match'];
    if (!ifMatch) return reply.status(422).send(errorEnvelope('validation_error', 'If-Match required'));
    const parsed = resourceSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    if (!normalizeAndValidateResourceRegions(parsed.data)) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', { reason: 'region_id_invalid' }));
    }
    const contactField = detectContactInfo(parsed.data);
    if (contactField) return reply.status(422).send(errorEnvelope('content_contact_info_disallowed', 'Contact information is not allowed in item content', { field: contactField }));
    const unit = await fabricService.patchUnit((req as AuthedRequest).nodeId!, (req.params as any).unit_id, Number(ifMatch), parsed.data);
    if (!unit) return reply.status(409).send(errorEnvelope('stale_write_conflict', 'Version conflict'));
    return unit;
  });
  app.delete('/v1/units/:unit_id', async (req, reply) => {
    const ok = await fabricService.deleteUnit((req as AuthedRequest).nodeId!, (req.params as any).unit_id);
    if (!ok) return reply.status(404).send(errorEnvelope('not_found', 'Unit not found'));
    return { ok: true };
  });

  app.post('/v1/requests', async (req, reply) => {
    const parsed = resourceSchema.extend({ ttl_minutes: z.number().int().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    if (!normalizeAndValidateResourceRegions(parsed.data)) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', { reason: 'region_id_invalid' }));
    }
    if (isTtlMinutesOutOfRange(parsed.data.ttl_minutes, REQUEST_TTL_MINUTES_MIN, REQUEST_TTL_MINUTES_MAX)) {
      return reply.status(400).send(errorEnvelope('validation_error', 'Invalid payload', {
        reason: 'ttl_minutes_out_of_range',
        min_ttl_minutes: REQUEST_TTL_MINUTES_MIN,
        max_ttl_minutes: REQUEST_TTL_MINUTES_MAX,
      }));
    }
    const contactField = detectContactInfo(parsed.data);
    if (contactField) return reply.status(422).send(errorEnvelope('content_contact_info_disallowed', 'Contact information is not allowed in item content', { field: contactField }));
    return fabricService.createRequest((req as AuthedRequest).nodeId!, parsed.data);
  });
  app.get('/v1/requests', async (req) => {
    const q = req.query as any;
    return fabricService.listRequests((req as AuthedRequest).nodeId!, Number(q.limit ?? 20), q.cursor ?? null);
  });
  app.get('/v1/requests/:request_id', async (req, reply) => {
    const item = await fabricService.getRequest((req as AuthedRequest).nodeId!, (req.params as any).request_id);
    if (!item) return reply.status(404).send(errorEnvelope('not_found', 'Request not found'));
    await repo.addDetailView((req as AuthedRequest).nodeId!, 'request', item.id, item.scope_primary ?? null);
    return item;
  });
  app.patch('/v1/requests/:request_id', async (req, reply) => {
    const ifMatch = req.headers['if-match'];
    if (!ifMatch) return reply.status(422).send(errorEnvelope('validation_error', 'If-Match required'));
    const parsed = resourceSchema.partial().extend({ ttl_minutes: z.number().int().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    if (!normalizeAndValidateResourceRegions(parsed.data)) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', { reason: 'region_id_invalid' }));
    }
    if (isTtlMinutesOutOfRange(parsed.data.ttl_minutes, REQUEST_TTL_MINUTES_MIN, REQUEST_TTL_MINUTES_MAX)) {
      return reply.status(400).send(errorEnvelope('validation_error', 'Invalid payload', {
        reason: 'ttl_minutes_out_of_range',
        min_ttl_minutes: REQUEST_TTL_MINUTES_MIN,
        max_ttl_minutes: REQUEST_TTL_MINUTES_MAX,
      }));
    }
    const contactField = detectContactInfo(parsed.data);
    if (contactField) return reply.status(422).send(errorEnvelope('content_contact_info_disallowed', 'Contact information is not allowed in item content', { field: contactField }));
    const item = await fabricService.patchRequest((req as AuthedRequest).nodeId!, (req.params as any).request_id, Number(ifMatch), parsed.data);
    if (!item) return reply.status(409).send(errorEnvelope('stale_write_conflict', 'Version conflict'));
    return item;
  });
  app.delete('/v1/requests/:request_id', async (req, reply) => {
    const ok = await fabricService.deleteRequest((req as AuthedRequest).nodeId!, (req.params as any).request_id);
    if (!ok) return reply.status(404).send(errorEnvelope('not_found', 'Request not found'));
    return { ok: true };
  });

  app.post('/v1/units/:unit_id/publish', async (req, reply) => {
    const out = await fabricService.publish('units', (req as AuthedRequest).nodeId!, (req.params as any).unit_id);
    if ((out as any).notFound) return reply.status(404).send(errorEnvelope('not_found', 'Unit not found'));
    if ((out as any).forbidden) return reply.status(403).send(errorEnvelope('forbidden', 'Node is suspended'));
    if ((out as any).validationError) return reply.status(422).send(errorEnvelope('validation_error', 'Publish requirements not met', { reason: (out as any).validationError }));
    return out;
  });
  app.post('/v1/units/:unit_id/unpublish', async (req) => fabricService.unpublish('units', (req as AuthedRequest).nodeId!, (req.params as any).unit_id));
  app.post('/v1/requests/:request_id/publish', async (req, reply) => {
    const out = await fabricService.publish('requests', (req as AuthedRequest).nodeId!, (req.params as any).request_id);
    if ((out as any).notFound) return reply.status(404).send(errorEnvelope('not_found', 'Request not found'));
    if ((out as any).forbidden) return reply.status(403).send(errorEnvelope('forbidden', 'Node is suspended'));
    if ((out as any).validationError) return reply.status(422).send(errorEnvelope('validation_error', 'Publish requirements not met', { reason: (out as any).validationError }));
    return out;
  });
  app.post('/v1/requests/:request_id/unpublish', async (req) => fabricService.unpublish('requests', (req as AuthedRequest).nodeId!, (req.params as any).request_id));

  app.post('/v1/search/listings', async (req, reply) => {
    const disabledFeatures = detectDisabledSearchFeatures(req.body);
    if (disabledFeatures.length > 0) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid search request', {
        reason: 'phase05_search_lock',
        disabled_features: disabledFeatures,
      }));
    }
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const normalized = normalizeSearchBudget(parsed.data);
    const vf = validateScopeFilters(normalized.scope, normalized.filters);
    if (!vf.ok) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid filters', { reason: vf.reason }));
    if (!(await applySearchScrapeGuard(req, reply, normalized))) return reply;
    const out = await fabricService.search((req as AuthedRequest).nodeId!, 'listings', normalized, (req as AuthedRequest).idem!.key);
    if ((out as any).prepurchaseDailyLimit) return reply.status(429).send(prepurchaseLimitEnvelope((req as AuthedRequest).nodeId!, 'prepurchase_daily_limit_exceeded', 'Pre-purchase daily search limit exceeded', (out as any).prepurchaseDailyLimit));
    if ((out as any).budgetCapExceeded) {
      return reply.status(402).send(errorEnvelope('budget_cap_exceeded', 'Search budget cap exceeded', {
        ...(out as any).budgetCapExceeded,
        credit_pack_options: purchaseGuidance((req as AuthedRequest).nodeId!),
      }));
    }
    if ((out as any).validationError) {
      const reason = (out as any).validationError;
      if (reason === 'cursor_mismatch' || reason === 'invalid_cursor') {
        return reply.status(400).send(errorEnvelope('validation_error', 'Invalid search cursor', { reason }));
      }
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid search request', { reason }));
    }
    if ((out as any).creditsExhausted) return reply.status(402).send(creditsExhaustedEnvelope((req as AuthedRequest).nodeId!, (out as any).creditsExhausted));
    return out;
  });
  app.post('/v1/search/requests', async (req, reply) => {
    const disabledFeatures = detectDisabledSearchFeatures(req.body);
    if (disabledFeatures.length > 0) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid search request', {
        reason: 'phase05_search_lock',
        disabled_features: disabledFeatures,
      }));
    }
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const normalized = normalizeSearchBudget(parsed.data);
    const vf = validateScopeFilters(normalized.scope, normalized.filters);
    if (!vf.ok) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid filters', { reason: vf.reason }));
    if (!(await applySearchScrapeGuard(req, reply, normalized))) return reply;
    const out = await fabricService.search((req as AuthedRequest).nodeId!, 'requests', normalized, (req as AuthedRequest).idem!.key);
    if ((out as any).prepurchaseDailyLimit) return reply.status(429).send(prepurchaseLimitEnvelope((req as AuthedRequest).nodeId!, 'prepurchase_daily_limit_exceeded', 'Pre-purchase daily search limit exceeded', (out as any).prepurchaseDailyLimit));
    if ((out as any).budgetCapExceeded) {
      return reply.status(402).send(errorEnvelope('budget_cap_exceeded', 'Search budget cap exceeded', {
        ...(out as any).budgetCapExceeded,
        credit_pack_options: purchaseGuidance((req as AuthedRequest).nodeId!),
      }));
    }
    if ((out as any).validationError) {
      const reason = (out as any).validationError;
      if (reason === 'cursor_mismatch' || reason === 'invalid_cursor') {
        return reply.status(400).send(errorEnvelope('validation_error', 'Invalid search cursor', { reason }));
      }
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid search request', { reason }));
    }
    if ((out as any).creditsExhausted) return reply.status(402).send(creditsExhaustedEnvelope((req as AuthedRequest).nodeId!, (out as any).creditsExhausted));
    return out;
  });

  app.get('/v1/public/nodes/:node_id/listings', async (req, reply) => {
    const q = req.query as any;
    const out = await fabricService.nodePublicInventory((req as AuthedRequest).nodeId!, (req.params as any).node_id, 'listings', Number(q.limit ?? 20), q.cursor ?? null);
    if ((out as any).creditsExhausted) return reply.status(402).send(creditsExhaustedEnvelope((req as AuthedRequest).nodeId!, (out as any).creditsExhausted));
    return out;
  });
  app.get('/v1/public/nodes/:node_id/requests', async (req, reply) => {
    const q = req.query as any;
    const out = await fabricService.nodePublicInventory((req as AuthedRequest).nodeId!, (req.params as any).node_id, 'requests', Number(q.limit ?? 20), q.cursor ?? null);
    if ((out as any).creditsExhausted) return reply.status(402).send(creditsExhaustedEnvelope((req as AuthedRequest).nodeId!, (out as any).creditsExhausted));
    return out;
  });
  async function handleDrilldown(
    req: FastifyRequest,
    reply: any,
    kind: 'listings' | 'requests',
    targetNodeId: string,
    categoryId: number,
    limit: number,
    cursor: string | null,
    creditsMax: number | undefined,
  ) {
    const callerNodeId = (req as AuthedRequest).nodeId!;
    if (!Number.isInteger(categoryId) || categoryId < 0) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid category filter', { reason: 'category_id_invalid' }));
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid pagination params', { reason: 'limit_out_of_range' }));
    }
    const perNodeRule: RateLimitRule = { name: 'drilldown_per_node', limit: config.rateLimitDrilldownPerNodePerMinute, windowSeconds: 60, subject: 'node' };
    if (!(await applyRateLimitSubject(reply, perNodeRule, `${callerNodeId}:${targetNodeId}`))) return reply;
    const isSubscriber = (req as AuthedRequest).isSubscriber ?? false;
    const dailyCapLimit = isSubscriber ? config.drilldownDailyCapBasic : config.drilldownDailyCapFree;
    const dailyCapRule: RateLimitRule = { name: 'drilldown_daily', limit: dailyCapLimit, windowSeconds: 86400, subject: 'node' };
    if (!(await applyRateLimitSubject(reply, dailyCapRule, callerNodeId))) return reply;
    const out = await fabricService.nodePublicInventoryByCategory(callerNodeId, targetNodeId, kind, categoryId, limit, cursor, creditsMax);
    if ((out as any).budgetCapExceeded) return reply.status(402).send({ error: { code: 'budget_cap_exceeded', message: 'Budget cap exceeded', details: { ...(out as any).budgetCapExceeded, credit_pack_options: purchaseGuidance(callerNodeId) } } });
    if ((out as any).creditsExhausted) return reply.status(402).send(creditsExhaustedEnvelope(callerNodeId, (out as any).creditsExhausted));
    return out;
  }

  app.get('/v1/public/nodes/:node_id/listings/categories/:category_id', async (req, reply) => {
    const q = req.query as any;
    const limit = Number(q.limit ?? 20);
    const categoryId = Number((req.params as any).category_id);
    const targetNodeId = (req.params as any).node_id as string;
    const creditsMax = q.budget_credits_max !== undefined ? Number(q.budget_credits_max) : undefined;
    return handleDrilldown(req, reply, 'listings', targetNodeId, categoryId, limit, q.cursor ?? null, creditsMax);
  });
  app.get('/v1/public/nodes/:node_id/requests/categories/:category_id', async (req, reply) => {
    const q = req.query as any;
    const limit = Number(q.limit ?? 20);
    const categoryId = Number((req.params as any).category_id);
    const targetNodeId = (req.params as any).node_id as string;
    const creditsMax = q.budget_credits_max !== undefined ? Number(q.budget_credits_max) : undefined;
    return handleDrilldown(req, reply, 'requests', targetNodeId, categoryId, limit, q.cursor ?? null, creditsMax);
  });
  app.post('/v1/public/nodes/:node_id/listings/categories/:category_id', async (req, reply) => {
    const parsed = drilldownPostSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', { reason: 'body_invalid' }));
    const categoryId = Number((req.params as any).category_id);
    const targetNodeId = (req.params as any).node_id as string;
    return handleDrilldown(req, reply, 'listings', targetNodeId, categoryId, parsed.data.limit, parsed.data.cursor ?? null, parsed.data.budget.credits_max);
  });
  app.post('/v1/public/nodes/:node_id/requests/categories/:category_id', async (req, reply) => {
    const parsed = drilldownPostSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', { reason: 'body_invalid' }));
    const categoryId = Number((req.params as any).category_id);
    const targetNodeId = (req.params as any).node_id as string;
    return handleDrilldown(req, reply, 'requests', targetNodeId, categoryId, parsed.data.limit, parsed.data.cursor ?? null, parsed.data.budget.credits_max);
  });

  app.post('/v1/public/nodes/categories-summary', async (req, reply) => {
    const body = req.body as any;
    const nodeIds: string[] = Array.isArray(body?.node_ids) ? body.node_ids.filter((id: unknown) => typeof id === 'string') : [];
    const kind = body?.kind;
    if (nodeIds.length === 0 || nodeIds.length > 50) {
      return reply.status(422).send(errorEnvelope('validation_error', 'node_ids must be 1–50 strings', { reason: 'node_ids_invalid' }));
    }
    if (kind !== 'listings' && kind !== 'requests' && kind !== 'both') {
      return reply.status(422).send(errorEnvelope('validation_error', 'kind must be listings, requests, or both', { reason: 'kind_invalid' }));
    }
    return fabricService.nodePublicCategoriesSummary((req as AuthedRequest).nodeId!, nodeIds, kind);
  });

  app.get('/v1/offers', async (req) => {
    const q = req.query as any;
    return (fabricService as any).listOffers((req as AuthedRequest).nodeId!, q.role === 'received' ? 'received' : 'made', Number(q.limit ?? 20), q.cursor ?? null);
  });
  app.get('/v1/offers/:offer_id', async (req, reply) => {
    const out = await (fabricService as any).getOffer((req as AuthedRequest).nodeId!, (req.params as any).offer_id);
    if (!out) return reply.status(404).send(errorEnvelope('not_found', 'Offer not found'));
    return out;
  });
  app.post('/v1/offers', async (req, reply) => {
    const parsed = z.object({
      unit_ids: z.array(z.string()).min(1).optional(),
      request_id: z.string().optional(),
      thread_id: z.string().nullable().optional(),
      note: z.string().nullable().optional(),
      ttl_minutes: z.number().int().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const hasRequestId = typeof parsed.data.request_id === 'string' && parsed.data.request_id.trim().length > 0;
    if (parsed.data.request_id !== undefined && !hasRequestId) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', { reason: 'request_id_required' }));
    }
    if (hasRequestId) {
      if (typeof parsed.data.note !== 'string' || parsed.data.note.trim().length === 0) {
        return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', { reason: 'request_note_required' }));
      }
    } else if (!Array.isArray(parsed.data.unit_ids) || parsed.data.unit_ids.length === 0) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', { reason: 'unit_ids_required' }));
    }
    if (isTtlMinutesOutOfRange(parsed.data.ttl_minutes, OFFER_TTL_MINUTES_MIN, OFFER_TTL_MINUTES_MAX)) {
      return reply.status(400).send(errorEnvelope('validation_error', 'Invalid payload', {
        reason: 'ttl_minutes_out_of_range',
        min_ttl_minutes: OFFER_TTL_MINUTES_MIN,
        max_ttl_minutes: OFFER_TTL_MINUTES_MAX,
      }));
    }
    if (detectContactInfoInText(parsed.data.note)) {
      return reply.status(422).send(errorEnvelope(
        'content_contact_info_disallowed',
        'Contact information is not allowed in offer notes',
        { field: 'note' },
      ));
    }
    const out = await (fabricService as any).createOffer(
      (req as AuthedRequest).nodeId!,
      {
        unit_ids: parsed.data.unit_ids,
        request_id: hasRequestId ? parsed.data.request_id : undefined,
        thread_id: parsed.data.thread_id,
        note: parsed.data.note ?? null,
        ttl_minutes: parsed.data.ttl_minutes,
      },
    );
    if (out.legalRequired) return reply.status(422).send(errorEnvelope('legal_required', 'Legal assent is required', { required_legal_version: config.requiredLegalVersion }));
    if (out.validationError) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', { reason: out.validationError }));
    if (out.prepurchaseDailyLimit) return reply.status(429).send(prepurchaseLimitEnvelope((req as AuthedRequest).nodeId!, 'prepurchase_daily_limit_exceeded', 'Pre-purchase daily limit exceeded', out.prepurchaseDailyLimit));
    if (out.conflict) return reply.status(409).send(errorEnvelope('conflict', 'Offer conflict', { reason: out.conflict }));
    return out;
  });
  app.post('/v1/offers/:offer_id/counter', async (req, reply) => {
    const parsed = z.object({
      unit_ids: z.array(z.string()).min(1).optional(),
      note: z.string().nullable().optional(),
      ttl_minutes: z.number().int().optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    if (isTtlMinutesOutOfRange(parsed.data.ttl_minutes, OFFER_TTL_MINUTES_MIN, OFFER_TTL_MINUTES_MAX)) {
      return reply.status(400).send(errorEnvelope('validation_error', 'Invalid payload', {
        reason: 'ttl_minutes_out_of_range',
        min_ttl_minutes: OFFER_TTL_MINUTES_MIN,
        max_ttl_minutes: OFFER_TTL_MINUTES_MAX,
      }));
    }
    if (detectContactInfoInText(parsed.data.note)) {
      return reply.status(422).send(errorEnvelope(
        'content_contact_info_disallowed',
        'Contact information is not allowed in offer notes',
        { field: 'note' },
      ));
    }
    const out = await (fabricService as any).counterOffer(
      (req as AuthedRequest).nodeId!,
      (req.params as any).offer_id,
      {
        unit_ids: parsed.data.unit_ids,
        note: parsed.data.note ?? null,
        ttl_minutes: parsed.data.ttl_minutes,
      },
    );
    if (out.legalRequired) return reply.status(422).send(errorEnvelope('legal_required', 'Legal assent is required', { required_legal_version: config.requiredLegalVersion }));
    if (out.notFound) return reply.status(404).send(errorEnvelope('not_found', 'Offer not found'));
    if (out.validationError) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', { reason: out.validationError }));
    if (out.prepurchaseDailyLimit) return reply.status(429).send(prepurchaseLimitEnvelope((req as AuthedRequest).nodeId!, 'prepurchase_daily_limit_exceeded', 'Pre-purchase daily limit exceeded', out.prepurchaseDailyLimit));
    if (out.conflict) return reply.status(409).send(errorEnvelope('conflict', 'Offer conflict', { reason: out.conflict }));
    return out;
  });
  app.post('/v1/offers/:offer_id/accept', async (req, reply) => {
    const out = await (fabricService as any).acceptOffer((req as AuthedRequest).nodeId!, (req.params as any).offer_id);
    if (out.legalRequired) return reply.status(422).send(errorEnvelope('legal_required', 'Legal assent is required', { required_legal_version: config.requiredLegalVersion }));
    if (out.creditsExhausted) return reply.status(402).send(creditsExhaustedEnvelope((req as AuthedRequest).nodeId!, out.creditsExhausted));
    if (out.prepurchaseDailyLimit) return reply.status(429).send(prepurchaseLimitEnvelope((req as AuthedRequest).nodeId!, 'prepurchase_daily_limit_exceeded', 'Pre-purchase daily limit exceeded', out.prepurchaseDailyLimit));
    if (out.forbidden) return reply.status(403).send(errorEnvelope('forbidden', 'Not allowed'));
    if (out.notFound) return reply.status(404).send(errorEnvelope('not_found', 'Offer not found'));
    if (out.conflict) {
      const details = typeof out.conflict === 'string' ? { reason: out.conflict } : {};
      return reply.status(409).send(errorEnvelope('invalid_state_transition', 'Invalid transition', details));
    }
    return maybeAppendWebhookNudge((req as AuthedRequest).nodeId!, out);
  });
  app.post('/v1/offers/:offer_id/reject', async (req, reply) => {
    const out = await (fabricService as any).rejectOffer((req as AuthedRequest).nodeId!, (req.params as any).offer_id);
    if (out.notFound) return reply.status(404).send(errorEnvelope('not_found', 'Offer not found'));
    if (out.forbidden) return reply.status(403).send(errorEnvelope('forbidden', 'Not allowed'));
    return out;
  });
  app.post('/v1/offers/:offer_id/cancel', async (req, reply) => {
    const out = await (fabricService as any).cancelOffer((req as AuthedRequest).nodeId!, (req.params as any).offer_id);
    if (out.legalRequired) return reply.status(422).send(errorEnvelope('legal_required', 'Legal assent is required', { required_legal_version: config.requiredLegalVersion }));
    if (out.notFound) return reply.status(404).send(errorEnvelope('not_found', 'Offer not found'));
    if (out.forbidden) return reply.status(403).send(errorEnvelope('forbidden', 'Not allowed'));
    return out;
  });
  app.post('/v1/offers/:offer_id/reveal-contact', async (req, reply) => {
    const out = await (fabricService as any).revealContact((req as AuthedRequest).nodeId!, (req.params as any).offer_id);
    if (out.notFound) return reply.status(404).send(errorEnvelope('not_found', 'Offer not found'));
    if (out.notAccepted) return reply.status(409).send(errorEnvelope('offer_not_mutually_accepted', 'Offer not mutually accepted'));
    if (out.contactUnavailable) return reply.status(409).send(errorEnvelope('invalid_state_transition', 'Counterparty contact is not ready', { reason: 'counterparty_email_missing' }));
    if (out.legalRequired) return reply.status(422).send(errorEnvelope('legal_required', 'Legal assent is required', { required_legal_version: config.requiredLegalVersion }));
    if (out.forbidden) return reply.status(403).send(errorEnvelope('forbidden', 'Not allowed'));
    return maybeAppendWebhookNudge((req as AuthedRequest).nodeId!, out);
  });
  app.get('/v1/events', async (req, reply) => {
    const q = req.query as any;
    const limit = Number(q.limit ?? 50);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid pagination params', { reason: 'limit_out_of_range' }));
    }
    const out = await fabricService.listEvents((req as AuthedRequest).nodeId!, q.since ?? null, limit);
    if ((out as any).validationError) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid events cursor', { reason: (out as any).validationError }));
    }
    return out;
  });

  app.get('/v1/me/referral-code', async (req, _reply) => {
    return (fabricService as any).getMyReferralCode((req as AuthedRequest).nodeId!);
  });

  app.get('/v1/me/referral-stats', async (req, _reply) => {
    return (fabricService as any).getMyReferralStats((req as AuthedRequest).nodeId!);
  });

  app.post('/v1/referrals/claim', async (req, reply) => {
    const parsed = z.object({ referral_code: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const out = await (fabricService as any).claimReferral((req as AuthedRequest).nodeId!, parsed.data.referral_code);
    if (out.invalid) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid referral code'));
    if (out.locked) return reply.status(409).send(errorEnvelope('invalid_state_transition', 'Referral locked after paid event'));
    return { ok: true, referrer_node_id: out.referrer_node_id };
  });

  app.register(async (webhookApp) => {
    webhookApp.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 65_536 }, (_req, body, done) => {
      done(null, body);
    });

    webhookApp.post('/v1/webhooks/stripe', async (req, reply) => {
      req.log.info({ ...getSafeDbEnvDiagnostics(), check_point: 'stripe_webhook' }, 'db env check');
      setStripeWebhookLogContext(req, {
        event_id: null,
        event_type: null,
        stripe_signature_present: hasStripeSignatureHeader(req),
      });
      try {
        const signatureFailure = (reason: string, message: string, eventType: string | null = null, eventId: string | null = null) => {
          webhookApp.log.warn(
            { signature_verified: false, reason, event_type: eventType, event_id: eventId },
            'Stripe webhook signature verification failed',
          );
          return reply.status(400).send(errorEnvelope('stripe_signature_invalid', message, { reason }));
        };
        const sigHeader = (req.headers['stripe-signature'] as string | undefined) ?? '';
        if (!sigHeader) {
          return signatureFailure('missing_signature_header', 'Missing Stripe-Signature');
        }
        const parsedSig = parseStripeSignature(sigHeader);
        if (!parsedSig) {
          return signatureFailure('invalid_signature_header', 'Invalid Stripe-Signature');
        }
        const { t, v1Values } = parsedSig;
        if (Math.abs(Math.floor(Date.now() / 1000) - t) > 300) {
          return signatureFailure('timestamp_out_of_tolerance', 'Stripe signature timestamp out of tolerance');
        }
        const bodyBuffer = rawBodyBuffer(req.body);
        if (bodyBuffer === null) {
          return signatureFailure('invalid_raw_body', 'Invalid webhook payload');
        }
        if (!config.stripeWebhookSecret) {
          return signatureFailure('missing_webhook_secret', 'Stripe webhook secret is not configured');
        }

        const payload = Buffer.concat([Buffer.from(String(t), 'utf8'), Buffer.from('.', 'utf8'), bodyBuffer]);
        const expected = crypto.createHmac('sha256', config.stripeWebhookSecret).update(payload).digest('hex');
        const signatureVerified = v1Values.some((v1) => timingSafeHexEqual(v1, expected));

        let event: any;
        try {
          event = JSON.parse(bodyBuffer.toString('utf8'));
        } catch {
          webhookApp.log.warn({ signature_verified: false, reason: 'invalid_json_payload', event_type: null, event_id: null }, 'Stripe webhook signature verification failed');
          return reply.status(400).send(errorEnvelope('validation_error', 'Invalid webhook JSON payload'));
        }

        const eventId = String(event.id ?? '');
        const eventType = String(event.type ?? 'unknown');
        setStripeWebhookLogContext(req, { event_id: eventId || null, event_type: eventType || null });
        webhookApp.log.info({ event_type: eventType, event_id: eventId || null, stripe_signature_present: true }, 'Stripe webhook received');
        if (!signatureVerified) {
          return signatureFailure('signature_mismatch', 'Stripe signature verification failed', eventType, eventId || null);
        }
        webhookApp.log.info({ signature_verified: true, event_type: eventType, event_id: eventId || null }, 'Stripe webhook signature verified');

        if (event.livemode === false && config.stripeEnforceLivemode) {
          webhookApp.log.warn({ event_id: eventId, event_type: eventType, reason: 'test_mode_event_in_production' }, 'Stripe test-mode event rejected in production');
          return reply.status(400).send(errorEnvelope('validation_error', 'Test-mode events not accepted in production'));
        }

        if (!eventId) return reply.status(422).send(errorEnvelope('validation_error', 'Missing stripe event id'));
        const inserted = await repo.insertStripeEvent(eventId, eventType, event);
        if (!inserted) {
          webhookApp.log.info({ event_id: eventId, event_type: eventType, reason: 'already_processed' }, 'Stripe event replay skipped');
          return { ok: true };
        }
        try {
          const processing = await (fabricService as any).processStripeEvent(event);
          if (processing?.subscription_activated) {
            webhookApp.log.info(
              {
                signature_verified: true,
                event_type: eventType,
                event_id: eventId,
                node_id: processing.subscription_activated.node_id,
                plan_code: processing.subscription_activated.plan_code,
                invoice_id: processing.subscription_activated.invoice_id ?? null,
                stripe_subscription_id: processing.subscription_activated.stripe_subscription_id ?? null,
              },
              'Stripe subscription activated',
            );
          }
          await repo.markStripeProcessed(eventId);
          if (processing?.mapped === false && processing?.reason === 'unmapped_stripe_customer') {
            webhookApp.log.warn(
              {
                signature_verified: true,
                reason: 'unmapped_stripe_customer',
                event_type: eventType,
                event_id: eventId,
                stripe_customer_id: processing?.stripe_customer_id ?? null,
                stripe_subscription_id: processing?.stripe_subscription_id ?? null,
              },
              'Stripe webhook processed without node mapping',
            );
          }
          webhookApp.log.info({ signature_verified: true, event_type: eventType, event_id: eventId }, 'Stripe webhook processed');
          return { ok: true };
        } catch (err: any) {
          await repo.markStripeError(eventId, err?.message ?? 'processing_error');
          webhookApp.log.warn({ signature_verified: true, reason: 'processing_error', event_type: eventType, event_id: eventId }, 'Stripe webhook processing failed');
          return { ok: true };
        }
      } catch (err) {
        req.log.error({ err, ...requestErrorLogFields(req) }, 'stripe webhook handler failed');
        return reply.code(500).send({ ok: false });
      }
    });

    webhookApp.post('/v1/webhooks/nowpayments', async (req, reply) => {
      try {
        const sig = (req.headers['x-nowpayments-sig'] as string | undefined) ?? '';
        if (!sig) {
          webhookApp.log.warn({ reason: 'missing_signature' }, 'NOWPayments IPN missing signature');
          return reply.status(400).send(errorEnvelope('nowpayments_signature_invalid', 'Missing x-nowpayments-sig header'));
        }
        let body: Record<string, unknown>;
        if (Buffer.isBuffer(req.body)) {
          body = JSON.parse(req.body.toString('utf8'));
        } else if (typeof req.body === 'object' && req.body !== null) {
          body = req.body as Record<string, unknown>;
        } else {
          return reply.status(400).send(errorEnvelope('validation_error', 'Invalid webhook payload'));
        }
        const sigResult = nowPayments.verifyIpnSignature(body, sig);
        if (sigResult.valid === false) {
          webhookApp.log.warn({ reason: sigResult.reason, payment_id: body.payment_id ?? null }, 'NOWPayments IPN signature verification failed');
          return reply.status(400).send(errorEnvelope('nowpayments_signature_invalid', 'IPN signature verification failed'));
        }
        const paymentId = Number(body.payment_id);
        const paymentStatus = String(body.payment_status ?? '');
        const orderId = String(body.order_id ?? '');
        const actuallyPaid = body.actually_paid != null ? Number(body.actually_paid) : null;
        webhookApp.log.info({ payment_id: paymentId, payment_status: paymentStatus, order_id: orderId }, 'NOWPayments IPN received');
        if (!paymentId || !orderId) {
          return reply.status(422).send(errorEnvelope('validation_error', 'Missing payment_id or order_id'));
        }
        const existing = await repo.getCryptoPaymentByNowpaymentsId(paymentId);
        if (!existing) {
          webhookApp.log.warn({ payment_id: paymentId, order_id: orderId }, 'NOWPayments IPN for unknown payment');
          return { ok: true };
        }
        if (existing.status === 'finished') {
          webhookApp.log.info({ payment_id: paymentId, node_id: existing.node_id, reason: 'already_finished' }, 'NOWPayments IPN skipped — payment already finished');
          return { ok: true };
        }

        const CRYPTO_PAYMENT_TOLERANCE = 0.02;
        const CREDIT_GRANTING_STATUSES = new Set(['finished', 'confirmed']);
        const NON_TERMINAL_STATUSES = new Set(['waiting', 'confirming', 'sending']);
        const TERMINAL_FAILURE_STATUSES = new Set(['expired', 'failed', 'refunded']);

        let effectiveStatus = paymentStatus;
        if (paymentStatus === 'partially_paid'
          && actuallyPaid != null
          && existing.pay_amount != null
          && Number(existing.pay_amount) > 0
          && actuallyPaid >= Number(existing.pay_amount) * (1 - CRYPTO_PAYMENT_TOLERANCE)) {
          effectiveStatus = 'finished';
          webhookApp.log.info(
            { payment_id: paymentId, node_id: existing.node_id, actually_paid: actuallyPaid, pay_amount: existing.pay_amount, tolerance: CRYPTO_PAYMENT_TOLERANCE },
            'Crypto payment promoted from partially_paid to finished (within tolerance)',
          );
        }

        await repo.markCryptoPaymentStatus(paymentId, effectiveStatus, actuallyPaid);

        if (CREDIT_GRANTING_STATUSES.has(effectiveStatus)) {
          const idempotencyKey = `crypto_credit_pack:${paymentId}`;
          const inserted = await repo.addCreditIdempotent(
            existing.node_id,
            'topup_purchase',
            existing.credits,
            {
              pack_code: existing.pack_code,
              payment_method: 'crypto',
              nowpayments_id: paymentId,
              order_id: orderId,
              pay_currency: existing.pay_currency,
            },
            idempotencyKey,
          );
          webhookApp.log.info(
            { payment_id: paymentId, node_id: existing.node_id, credits: existing.credits, inserted, pack_code: existing.pack_code, effective_status: effectiveStatus },
            inserted ? 'Crypto credit pack credits granted' : 'Crypto credit pack idempotent replay',
          );
          if (inserted) {
            await repo.awardReferralFirstPaid(existing.node_id, 100, `crypto_credit_pack:${paymentId}`, config.referralMaxGrantsPerReferrer, {
              invoice_id: null,
              stripe_subscription_id: null,
            });
          }
          if (actuallyPaid != null && existing.pay_amount != null && actuallyPaid > Number(existing.pay_amount) * 1.10) {
            webhookApp.log.warn(
              { payment_id: paymentId, node_id: existing.node_id, actually_paid: actuallyPaid, pay_amount: existing.pay_amount, overpayment_ratio: actuallyPaid / Number(existing.pay_amount) },
              'Crypto payment significant overpayment (>10%) — may require manual refund via NOWPayments dashboard',
            );
          }
        } else if (paymentStatus === 'partially_paid') {
          webhookApp.log.warn(
            { payment_id: paymentId, node_id: existing.node_id, actually_paid: actuallyPaid, pay_amount: existing.pay_amount },
            'Crypto payment partially paid (below tolerance) — no credits granted',
          );
        } else if (TERMINAL_FAILURE_STATUSES.has(paymentStatus)) {
          webhookApp.log.info(
            { payment_id: paymentId, node_id: existing.node_id, payment_status: paymentStatus },
            'Crypto payment reached terminal failure status',
          );
        } else if (NON_TERMINAL_STATUSES.has(paymentStatus)) {
          webhookApp.log.info(
            { payment_id: paymentId, node_id: existing.node_id, payment_status: paymentStatus },
            'Crypto payment status update (non-terminal)',
          );
        } else {
          webhookApp.log.warn(
            { payment_id: paymentId, node_id: existing.node_id, payment_status: paymentStatus },
            'Crypto payment unknown status received',
          );
        }
        return { ok: true };
      } catch (err) {
        req.log.error({ err, ...requestErrorLogFields(req) }, 'nowpayments webhook handler failed');
        return reply.code(500).send({ ok: false });
      }
    });

  });

  app.post('/v1/admin/takedown', async (req, reply) => {
    const parsed = z.object({ target_type: z.enum(['public_listing', 'public_request', 'node']), target_id: z.string(), reason: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const dbType = parsed.data.target_type === 'public_listing' ? 'listing' : parsed.data.target_type === 'public_request' ? 'request' : 'node';
    await query('insert into takedowns(target_type,target_id,reason) values($1,$2,$3)', [dbType, parsed.data.target_id, parsed.data.reason]);
    app.log.info({ audit: true, action: 'admin.takedown', target_type: dbType, target_id: parsed.data.target_id, reason: parsed.data.reason }, 'Admin takedown executed');
    return { ok: true };
  });
  app.get('/v1/admin/diagnostics/stripe', async (req) => {
    return {
      ...fabricService.stripeDiagnostics(),
      active_base_url: activeBaseHost(req),
    };
  });
  app.get('/internal/admin/daily-metrics', async () => {
    app.log.info({ audit: true, action: 'admin.daily_metrics' }, 'Admin daily metrics requested');
    return fabricService.adminDailyMetrics();
  });

  app.post('/internal/admin/health-pulse', async (req) => {
    const pulse = await fabricService.adminHealthPulse();
    app.log.info({ audit: true, action: 'admin.health_pulse', digest: 'health_pulse', status: pulse.status }, 'Health pulse check');

    if (pulse.status === 'degraded') {
      const alertLines = [
        `Fabric Health Pulse — ${pulse.generated_at}`,
        `Status: DEGRADED`,
        `Window: ${pulse.window_minutes}m`,
        '',
        ...pulse.alerts.map(a => `  ⚠ ${a}`),
        '',
        `Stripe: ${pulse.stripe.events_received} events, ${pulse.stripe.processing_errors} errors, oldest unprocessed ${pulse.stripe.oldest_unprocessed_minutes}m`,
        `Crypto: ${pulse.crypto.pending_payments} pending, ${pulse.crypto.failed_or_expired} failed/expired`,
        `Webhooks: ${pulse.webhooks.pending_retries} retries pending, ${pulse.webhooks.recent_failures} failures, oldest pending ${pulse.webhooks.oldest_pending_minutes}m`,
      ];
      const text = alertLines.join('\n');
      const slackText = `:warning: *Fabric Health Alert*\n${pulse.alerts.map(a => `• ${a}`).join('\n')}`;
      const promises: Promise<unknown>[] = [sendSlack(slackText)];
      if (config.opsDigestEmail) {
        promises.push(sendEmail({ to: config.opsDigestEmail, subject: `⚠ Fabric Health Alert — ${pulse.generated_at.split('T')[0]}`, text }));
      }
      await Promise.all(promises);
    }

    return pulse;
  });

  app.post('/internal/admin/daily-digest', async (req) => {
    const metrics = await fabricService.adminDailyMetrics();
    const lines = [
      `Fabric Daily Digest — ${metrics.generated_at}`,
      `Window: ${metrics.window_hours}h`,
      '',
      '== Marketplace Activity ==',
      `  Public listings: ${metrics.liquidity.public_listings}`,
      `  Public requests: ${metrics.liquidity.public_requests}`,
      `  Offers created: ${metrics.liquidity.offers_created}`,
      `  Deals closed: ${metrics.liquidity.offers_mutually_accepted}`,
      '',
      '== Growth ==',
      `  Active nodes: ${metrics.reliability.active_nodes}`,
      `  Active API keys: ${metrics.reliability.active_api_keys}`,
      `  Searches: ${metrics.reliability.searches}`,
      '',
      '== Revenue / Credits ==',
      `  Credit grants: ${metrics.stripe_credits_health.credit_grants}`,
      `  Credit debits: ${metrics.stripe_credits_health.credit_debits}`,
      `  Credit net: ${metrics.stripe_credits_health.credit_net}`,
      '',
      '== Trust & Safety ==',
      `  Suspended nodes: ${metrics.abuse.suspended_nodes}`,
      `  Active takedowns: ${metrics.abuse.active_takedowns}`,
      `  Recovery lockouts: ${metrics.abuse.recovery_attempts_exceeded}`,
    ];
    const text = lines.join('\n');
    app.log.info({ audit: true, action: 'admin.daily_digest', digest: 'daily_metrics', metrics }, 'Daily metrics digest');

    const m = metrics;
    const slackText = [
      `:bar_chart: *Fabric Daily Digest* — ${m.generated_at.split('T')[0]}`,
      `*Activity:* ${m.liquidity.public_listings} listings, ${m.liquidity.public_requests} requests, ${m.liquidity.offers_created} offers, ${m.liquidity.offers_mutually_accepted} deals`,
      `*Growth:* ${m.reliability.active_nodes} nodes, ${m.reliability.searches} searches`,
      `*Credits:* +${m.stripe_credits_health.credit_grants} / -${m.stripe_credits_health.credit_debits} (net ${m.stripe_credits_health.credit_net})`,
      m.abuse.suspended_nodes > 0 || m.abuse.active_takedowns > 0
        ? `*Safety:* ${m.abuse.suspended_nodes} suspended, ${m.abuse.active_takedowns} takedowns`
        : null,
    ].filter(Boolean).join('\n');

    const slackResult = await sendSlack(slackText);
    let emailResult: { ok: boolean; provider: string; reason?: string | null } = { ok: false, provider: 'none', reason: 'ops_digest_email_not_configured' };
    if (config.opsDigestEmail) {
      emailResult = await sendEmail({ to: config.opsDigestEmail, subject: `Fabric Daily Digest — ${metrics.generated_at.split('T')[0]}`, text });
    }

    return {
      ok: true,
      email_sent: emailResult.ok, email_provider: emailResult.provider, email_reason: emailResult.reason ?? null,
      slack_sent: slackResult.ok, slack_reason: slackResult.reason ?? null,
      metrics,
    };
  });

  app.post('/v1/admin/credits/adjust', async (req, reply) => {
    const parsed = z.object({ node_id: z.string(), delta: z.number().int().min(-1_000_000).max(1_000_000), reason: z.string().min(1).max(500) }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    await repo.addCredit(parsed.data.node_id, 'adjustment_manual', parsed.data.delta, { reason: parsed.data.reason });
    app.log.info({ audit: true, action: 'admin.credits_adjust', node_id: parsed.data.node_id, delta: parsed.data.delta, reason: parsed.data.reason }, 'Admin credit adjustment');
    return { ok: true };
  });
  app.post('/v1/admin/nodes/:nodeId/api-keys', async (req, reply) => {
    const params = z.object({ nodeId: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid params'));
    const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
    const parsed = z.object({ label: z.string().optional() }).safeParse(body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const node = await repo.getMe(params.data.nodeId);
    if (!node) return reply.status(404).send(errorEnvelope('not_found', 'Node not found'));
    const created = await fabricService.createAuthKey(params.data.nodeId, parsed.data.label ?? 'post-tls-verify');
    app.log.info({ audit: true, action: 'admin.create_api_key', node_id: params.data.nodeId, key_prefix: created.api_key.slice(0, 8) }, 'Admin API key created for node');
    return {
      api_key: created.api_key,
      key_prefix: created.api_key.slice(0, 8),
      node_id: params.data.nodeId,
    };
  });
  app.post('/v1/admin/projections/rebuild', async (req) => {
    const q = req.query as any;
    const kind = q.kind ?? 'all';
    const mode = q.mode ?? 'full';
    const started_at = new Date().toISOString();
    if (kind === 'all' || kind === 'listings') {
      await query('truncate table public_listings');
      await query(`insert into public_listings(unit_id,node_id,doc,published_at)
        select u.id,u.node_id,jsonb_build_object('id',u.id,'node_id',u.node_id,'scope_primary',u.scope_primary,'scope_secondary',u.scope_secondary,'title',u.title,'description',u.description,'public_summary',u.public_summary,'quantity',u.quantity,'estimated_value',u.estimated_value,'measure',u.measure,'custom_measure',u.custom_measure,'category_ids',u.category_ids,'tags',u.tags,'type',u.type,'condition',u.condition,'location_text_public',u.location_text_public,'origin_region',u.origin_region,'dest_region',u.dest_region,'service_region',u.service_region,'delivery_format',u.delivery_format,'max_ship_days',u.max_ship_days,'photos',u.photos,'published_at',u.published_at,'updated_at',u.updated_at),u.published_at
        from units u join nodes n on n.id=u.node_id where u.published_at is not null and u.deleted_at is null and n.status='ACTIVE' and n.suspended_at is null and n.deleted_at is null and not exists (select 1 from takedowns t where t.target_type='listing' and t.target_id=u.id and t.reversed_at is null) and not exists (select 1 from takedowns t where t.target_type='node' and t.target_id=u.node_id and t.reversed_at is null)`);
    }
    if (kind === 'all' || kind === 'requests') {
      await query('truncate table public_requests');
      await query(`insert into public_requests(request_id,node_id,doc,published_at)
        select r.id,r.node_id,jsonb_build_object('id',r.id,'node_id',r.node_id,'scope_primary',r.scope_primary,'scope_secondary',r.scope_secondary,'title',r.title,'description',r.description,'public_summary',r.public_summary,'desired_quantity',r.desired_quantity,'measure',r.measure,'custom_measure',r.custom_measure,'category_ids',r.category_ids,'tags',r.tags,'type',r.type,'condition',r.condition,'location_text_public',r.location_text_public,'origin_region',r.origin_region,'dest_region',r.dest_region,'service_region',r.service_region,'delivery_format',r.delivery_format,'max_ship_days',r.max_ship_days,'need_by',r.need_by,'accept_substitutions',r.accept_substitutions,'expires_at',r.expires_at,'published_at',r.published_at,'updated_at',r.updated_at),r.published_at
        from requests r join nodes n on n.id=r.node_id where r.published_at is not null and r.deleted_at is null and r.expires_at > now() and n.status='ACTIVE' and n.suspended_at is null and n.deleted_at is null and not exists (select 1 from takedowns t where t.target_type='request' and t.target_id=r.id and t.reversed_at is null) and not exists (select 1 from takedowns t where t.target_type='node' and t.target_id=r.node_id and t.reversed_at is null)`);
    }
    const listingsCount = Number((await query<{ c: string }>('select count(*)::text as c from public_listings'))[0].c);
    const requestsCount = Number((await query<{ c: string }>('select count(*)::text as c from public_requests'))[0].c);
    const result = { ok: true, kind, mode, started_at, finished_at: new Date().toISOString(), counts: { public_listings_written: listingsCount, public_requests_written: requestsCount } };
    app.log.info({ audit: true, action: 'admin.projections_rebuild', kind, mode, counts: result.counts }, 'Admin projections rebuild completed');
    return result;
  });

  app.post('/internal/admin/sweep', async () => {
    const expiredOffers = await repo.expireStaleOffers();
    const expiredRequests = await repo.expireStaleRequests();
    app.log.info({ audit: true, action: 'admin.sweep', expired_offers: expiredOffers, expired_requests: expiredRequests }, 'Scheduled sweep completed');
    return { ok: true, expired_offers: expiredOffers, expired_requests: expiredRequests };
  });

  app.post('/internal/admin/retention', async () => {
    const { hotCutoff, deleteCutoff } = retentionCutoffs();
    const expiredRows = await query<{ id: string }>('delete from search_logs where created_at < $1 returning id', [deleteCutoff.toISOString()]);
    const result = { ok: true, hot_cutoff: hotCutoff.toISOString(), delete_cutoff: deleteCutoff.toISOString(), deleted_count: expiredRows.length };
    app.log.info({ audit: true, action: 'admin.retention', ...result }, 'Retention sweep completed');
    return result;
  });

  app.get('/healthz', async () => ({ ok: true }));

  registerMcpRoute(app);

  return app;
}
