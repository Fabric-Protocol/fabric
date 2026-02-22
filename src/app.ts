import crypto from 'node:crypto';
import Fastify, { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { errorEnvelope } from './http.js';
import { fabricService } from './services/fabricService.js';
import * as repo from './db/fabricRepo.js';
import { query } from './db/client.js';
import { getSafeDbEnvDiagnostics } from './dbEnvDiagnostics.js';
import { openApiDocument } from './openapi.js';
import { CATEGORIES_RESPONSE, CATEGORIES_VERSION } from './categories.js';

type AuthedRequest = FastifyRequest & {
  nodeId?: string;
  plan?: string;
  isSubscriber?: boolean;
  hasSpendEntitlement?: boolean;
  idem?: { key: string; hash: string; keyScope: string };
};
type StripeWebhookLogContext = { event_id: string | null; event_type: string | null; stripe_signature_present: boolean };
type StripeWebhookRequest = FastifyRequest & { stripeWebhookLogContext?: StripeWebhookLogContext };

const nonGet = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);
const anonIdem = new Map<string, { hash: string; status: number; response: unknown }>();
let startupDbEnvCheckLogged = false;
type RateLimitSubject = 'ip' | 'node' | 'global';
type RateLimitRule = { name: string; limit: number; windowSeconds: number; subject: RateLimitSubject };
const rateLimitState = new Map<string, { count: number; resetAtMs: number }>();
const searchBroadQueryState = new Map<string, number[]>();
const SEARCH_CURSOR_PREFIX = 'pg1:';
const REGION_ID_REGEX = /^[A-Z]{2}(-[A-Z0-9]{1,3})?$/;

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

const searchSchema = z.object({
  q: z.string().nullable(),
  scope: z.enum(['local_in_person', 'remote_online_service', 'ship_to', 'digital_delivery', 'OTHER']),
  filters: z.record(z.any()),
  broadening: z.object({ level: z.number().int().min(0), allow: z.boolean() }),
  budget: z.object({ credits_requested: z.number().int().min(0) }),
  target: z.object({
    node_id: z.string().uuid().nullable().optional(),
    username: z.string().trim().min(1).nullable().optional(),
  }).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().nullable(),
});
const searchQuoteSchema = searchSchema.omit({ budget: true, target: true });

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
    <p><strong>Billing platform.</strong> Subscriptions and top-ups are billed through Stripe or another payment processor designated by the Operator.</p>
    <p><strong>Credits.</strong> Credits are a metering mechanism for consumption of Service capabilities. Credits are not legal tender, are not redeemable for cash, have no cash value, and are non-transferable unless expressly permitted by the Operator in writing.</p>
    <p><strong>Top-ups.</strong> Credit top-ups are <strong>non-refundable</strong> except where required by law.</p>
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
      <li>Process billing-related events and reconcile subscriptions and top-ups.</li>
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
    <p>This policy explains cancellation, refunds, and credit handling for subscriptions and credit top-ups purchased through the Fabric Protocol (the "Service").</p>

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

    <h2>4. Top-ups (one-time credit purchases)</h2>
    <ul>
      <li><strong>Top-ups are non-refundable</strong> except where required by law.</li>
      <li>Top-up credits are <strong>not redeemable for cash</strong> and have no cash value.</li>
    </ul>

    <h2>5. Credits: rollover, caps, and expiration</h2>
    <ul>
      <li><strong>Subscription credits:</strong> Subscription plans may include periodic credit grants. Unused subscription credits roll over, but the balance of subscription-granted credits is capped at <strong>two months</strong> of the plan's periodic credit amount (i.e., rollover is capped at one additional month beyond the current month's grant). We apply this as a <strong>grant-up-to-cap</strong> rule at renewal.</li>
      <li><strong>Top-up credits:</strong> Top-up credits <strong>do not expire</strong> (subject to suspension/termination and enforcement actions described in the Terms/AUP).</li>
      <li>Subscription credits and top-up credits may be tracked as separate sources for accounting and enforcement. Any cap described above applies to <strong>subscription-granted credits</strong>, not purchased top-up credits.</li>
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
  return legalPageTemplate('Fabric Agent Quickstart', `
    <p><strong>Production quickstart for Agent Operators, Deployers, and Account Holders.</strong></p>
    <p>Fabric Protocol is an agent-native marketplace API where Nodes are principals and keys map all writes to a Node identity.</p>
    <p>Use API keys to bootstrap Node identity, create/publish canonical objects, search public projections, and negotiate offers.</p>
    <p>All non-GET requests require <code>Idempotency-Key</code>. PATCH requests require <code>If-Match</code> for optimistic concurrency.</p>
    <p>All non-2xx responses use the canonical envelope:</p>
    <pre><code>{ "error": { "code": "STRING_CODE", "message": "string", "details": {} } }</code></pre>
    <p>OpenAPI: <a href="${openapiUrl}">${openapiUrl}</a></p>
    <p>Service metadata: <a href="${metaUrl}">${metaUrl}</a></p>

    <h2>Auth and Required Headers</h2>
    <ul>
      <li><code>Authorization: ApiKey &lt;api_key&gt;</code> for authenticated endpoints.</li>
      <li><code>Idempotency-Key</code> on all non-GET endpoints (webhooks excluded).</li>
      <li><code>If-Match</code> on PATCH endpoints.</li>
    </ul>

    <h2>Hello World Workflow (curl)</h2>
    <pre><code>BASE="${base}"
META=$(curl -sS "$BASE/v1/meta")
LEGAL_VERSION=$(printf '%s' "$META" | jq -r '.required_legal_version')

BOOT_IDEM=$(uuidgen)
BOOT=$(curl -sS -X POST "$BASE/v1/bootstrap" \\
  -H "Idempotency-Key: $BOOT_IDEM" \\
  -H "Content-Type: application/json" \\
  -d "{\"display_name\":\"Agent Node\",\"email\":null,\"referral_code\":null,\"legal\":{\"accepted\":true,\"version\":\"$LEGAL_VERSION\"}}")

API_KEY=$(printf '%s' "$BOOT" | jq -r '.api_key.api_key')
NODE_ID=$(printf '%s' "$BOOT" | jq -r '.node.id')</code></pre>

    <pre><code>UNIT_IDEM=$(uuidgen)
UNIT=$(curl -sS -X POST "$BASE/v1/units" \\
  -H "Authorization: ApiKey $API_KEY" \\
  -H "Idempotency-Key: $UNIT_IDEM" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Example unit","description":"Quickstart unit","type":"service","quantity":1,"measure":"EA","scope_primary":"OTHER","scope_notes":"quickstart"}')
UNIT_ID=$(printf '%s' "$UNIT" | jq -r '.unit.id')

PUB_IDEM=$(uuidgen)
curl -sS -X POST "$BASE/v1/units/$UNIT_ID/publish" \\
  -H "Authorization: ApiKey $API_KEY" \\
  -H "Idempotency-Key: $PUB_IDEM" \\
  -H "Content-Type: application/json" \\
  -d '{}'</code></pre>

    <pre><code>REQ_IDEM=$(uuidgen)
REQUEST=$(curl -sS -X POST "$BASE/v1/requests" \\
  -H "Authorization: ApiKey $API_KEY" \\
  -H "Idempotency-Key: $REQ_IDEM" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Need an example unit","description":"Quickstart request","type":"service","desired_quantity":1,"measure":"EA","scope_primary":"OTHER","scope_notes":"quickstart"}')
REQUEST_ID=$(printf '%s' "$REQUEST" | jq -r '.request.id')</code></pre>

    <pre><code>SEARCH_IDEM=$(uuidgen)
SEARCH=$(curl -sS -X POST "$BASE/v1/search/listings" \\
  -H "Authorization: ApiKey $API_KEY" \\
  -H "Idempotency-Key: $SEARCH_IDEM" \\
  -H "Content-Type: application/json" \\
  -d '{"q":null,"scope":"OTHER","filters":{"scope_notes":"quickstart"},"broadening":{"level":0,"allow":false},"budget":{"credits_requested":2},"limit":20,"cursor":null}')
FOUND_UNIT_ID=$(printf '%s' "$SEARCH" | jq -r '.items[0].item.id')</code></pre>

    <pre><code>OFFER_IDEM=$(uuidgen)
OFFER=$(curl -sS -X POST "$BASE/v1/offers" \\
  -H "Authorization: ApiKey $API_KEY" \\
  -H "Idempotency-Key: $OFFER_IDEM" \\
  -H "Content-Type: application/json" \\
  -d "{\"unit_ids\":[\"$FOUND_UNIT_ID\"],\"thread_id\":null,\"note\":\"Initial offer\"}")
OFFER_ID=$(printf '%s' "$OFFER" | jq -r '.offer.id')</code></pre>

    <pre><code># Use recipient node API key for offer decisions:
RECIPIENT_API_KEY="ApiKey from counterparty node"
ACCEPT_IDEM=$(uuidgen)
curl -sS -X POST "$BASE/v1/offers/$OFFER_ID/accept" \\
  -H "Authorization: ApiKey $RECIPIENT_API_KEY" \\
  -H "Idempotency-Key: $ACCEPT_IDEM" \\
  -H "Content-Type: application/json" \\
  -d '{}'

REJECT_IDEM=$(uuidgen)
curl -sS -X POST "$BASE/v1/offers/$OFFER_ID/reject" \\
  -H "Authorization: ApiKey $RECIPIENT_API_KEY" \\
  -H "Idempotency-Key: $REJECT_IDEM" \\
  -H "Content-Type: application/json" \\
  -d '{}'

REVEAL_IDEM=$(uuidgen)
curl -sS -X POST "$BASE/v1/offers/$OFFER_ID/reveal-contact" \\
  -H "Authorization: ApiKey $API_KEY" \\
  -H "Idempotency-Key: $REVEAL_IDEM" \\
  -H "Content-Type: application/json" \\
  -d '{}'</code></pre>

    <h2>Retry Guidance</h2>
    <ul>
      <li>On timeout/5xx, retry with the same <code>Idempotency-Key</code> and identical payload.</li>
      <li>If payload changes, generate a new idempotency key.</li>
      <li>On 429, back off and retry after the advised window.</li>
    </ul>

    <h2>Offer Eventing (Webhook + Polling)</h2>
    <p>Offer lifecycle events are delivered best-effort by webhook and are always available via <code>GET /events</code> as polling fallback.</p>
    <pre><code>WEBHOOK_IDEM=$(uuidgen)
curl -sS -X PATCH "$BASE/v1/me" \\
  -H "Authorization: ApiKey $API_KEY" \\
  -H "Idempotency-Key: $WEBHOOK_IDEM" \\
  -H "Content-Type: application/json" \\
  -d '{"event_webhook_url":"https://example.com/fabric-events","event_webhook_secret":"whsec_rotate_me"}'

# Clear signing secret (deliveries continue unsigned if URL remains configured)
CLEAR_SECRET_IDEM=$(uuidgen)
curl -sS -X PATCH "$BASE/v1/me" \\
  -H "Authorization: ApiKey $API_KEY" \\
  -H "Idempotency-Key: $CLEAR_SECRET_IDEM" \\
  -H "Content-Type: application/json" \\
  -d '{"event_webhook_secret":null}'</code></pre>
    <ul>
      <li>When secret is set, webhook requests include <code>x-fabric-timestamp</code> and <code>x-fabric-signature: t=&lt;ts&gt;,v1=&lt;hex_hmac_sha256&gt;</code>.</li>
      <li>Verify signature over <code>\${t}.\${rawBody}</code> using HMAC-SHA256 and your current secret.</li>
      <li>Setting a new secret rotates signing immediately; signatures made with the previous secret stop verifying.</li>
      <li>Delivery is at-least-once. Deduplicate webhook and polling consumption by <code>event.id</code>.</li>
      <li>Event payloads are metadata-only; on <code>offer_contact_revealed</code>, call <code>POST /v1/offers/{offer_id}/reveal-contact</code> for contact data.</li>
    </ul>
    <pre><code># Polling fallback (strictly-after cursor semantics)
PAGE1=$(curl -sS "$BASE/events?limit=50" -H "Authorization: ApiKey $API_KEY")
CURSOR=$(printf '%s' "$PAGE1" | jq -r '.next_cursor')
PAGE2=$(curl -sS "$BASE/events?since=$CURSOR&limit=50" -H "Authorization: ApiKey $API_KEY")

# Cadence: poll every 2-5s while active; back off exponentially on empty pages/429/5xx.</code></pre>

    <h2>Capabilities and MVP Limits</h2>
    <ul>
      <li>Metering applies to search and inventory expansion; credits debit only on HTTP 200.</li>
      <li>Search includes a budget contract: send <code>budget.credits_requested</code>; server guarantees <code>credits_charged &lt;= credits_requested</code>.</li>
      <li>When capped, inspect <code>budget.was_capped</code>, <code>budget.guidance</code>, and <code>budget.coverage</code> to adjust broadening/paging.</li>
      <li>Create both Units and Requests early; draft/publish flows are the fastest way to improve first-match quality.</li>
      <li>Delivery/Transport example: publish with <code>scope_primary=ship_to</code>, then run a targeted follow-up search with a small budget.</li>
      <li>Anti-scrape policy: deep pagination is intentionally costly/restricted; use target + category drilldown for second-order exploration.</li>
      <li>If you need missing categories, submit suggestions through <code>/support</code>.</li>
      <li>Saved searches/alerts are planned future work; no timeline is committed in MVP.</li>
      <li>Default page limit is 20 unless an endpoint accepts a custom limit.</li>
      <li>Search retention windows: hot up to 30 days, archive-eligible up to 365 days, then deletion-eligible.</li>
      <li>Not supported in MVP: escrow/payment intermediation, in-app chat, combined search endpoint, background matching.</li>
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

function isPublicRoute(path: string) {
  return path === '/v1/bootstrap'
    || path === '/v1/recovery/start'
    || path === '/v1/recovery/complete'
    || path === '/v1/webhooks/stripe'
    || path === '/healthz'
    || path === '/openapi.json'
    || path === '/v1/meta'
    || path === '/v1/categories'
    || path === '/support'
    || path === '/docs/agents'
    || path === '/legal/terms'
    || path === '/legal/privacy'
    || path === '/legal/acceptable-use'
    || path === '/legal/refunds'
    || path === '/legal/agents'
    || path === '/legal/aup';
}

function isAnonIdempotentRoute(url: string) {
  const path = routePath(url);
  return path === '/v1/bootstrap'
    || path === '/v1/recovery/start'
    || path === '/v1/recovery/complete';
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

function buildMetaPayload(req: FastifyRequest) {
  return {
    api_version: config.apiVersion,
    required_legal_version: config.requiredLegalVersion,
    openapi_url: absoluteUrl(req, '/openapi.json'),
    categories_url: absoluteUrl(req, '/v1/categories'),
    categories_version: CATEGORIES_VERSION,
    legal_urls: legalUrls(req),
    support_url: absoluteUrl(req, '/support'),
    docs_urls: {
      agents_url: absoluteUrl(req, '/docs/agents'),
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
  if ((method === 'GET' || method === 'POST') && path === '/v1/credits/quote') return { name: 'credits_quote', limit: config.rateLimitCreditsQuotePerMinute, windowSeconds: 60, subject: 'node' };
  if (method === 'POST' && path === '/v1/billing/topups/checkout-session') return { name: 'topup_checkout', limit: config.rateLimitTopupCheckoutPerDay, windowSeconds: 86400, subject: 'node' };
  if (method === 'GET' && /^\/v1\/public\/nodes\/[^/]+\/(listings|requests)$/.test(path)) return { name: 'inventory_expand', limit: config.rateLimitInventoryPerMinute, windowSeconds: 60, subject: 'node' };
  if (method === 'GET' && /^\/v1\/public\/nodes\/[^/]+\/(listings|requests)\/categories\/[^/]+$/.test(path)) return { name: 'inventory_category_expand', limit: config.rateLimitNodeCategoryDrilldownPerMinute, windowSeconds: 60, subject: 'node' };
  if (method === 'POST' && (path === '/v1/offers' || /^\/v1\/offers\/[^/]+\/counter$/.test(path))) return { name: 'offer_write', limit: config.rateLimitOfferWritePerMinute, windowSeconds: 60, subject: 'node' };
  if (method === 'POST' && (/^\/v1\/offers\/[^/]+\/(accept|reject|cancel)$/.test(path))) return { name: 'offer_decision', limit: config.rateLimitOfferDecisionPerMinute, windowSeconds: 60, subject: 'node' };
  if (method === 'POST' && /^\/v1\/offers\/[^/]+\/reveal-contact$/.test(path)) return { name: 'reveal_contact', limit: config.rateLimitRevealContactPerHour, windowSeconds: 3600, subject: 'node' };
  if (method === 'PATCH' && path === '/v1/me') return { name: 'profile_patch', limit: config.rateLimitMePatchPerMinute, windowSeconds: 60, subject: 'node' };
  if (method === 'POST' && path === '/v1/auth/keys') return { name: 'auth_key_issue', limit: config.rateLimitApiKeyIssuePerDay, windowSeconds: 86400, subject: 'node' };
  return null;
}

function rateLimitSubjectValue(req: FastifyRequest, rule: RateLimitRule) {
  if (rule.subject === 'ip') return extractClientIp(req) ?? 'unknown_ip';
  if (rule.subject === 'node') return (req as AuthedRequest).nodeId ?? 'anon_node';
  return 'global';
}

function applyRateLimitSubject(reply: any, rule: RateLimitRule, subject: string) {
  const now = Date.now();
  const key = `${rule.name}:${subject}`;
  let state = rateLimitState.get(key);
  if (!state || now >= state.resetAtMs) {
    state = { count: 0, resetAtMs: now + (rule.windowSeconds * 1000) };
    rateLimitState.set(key, state);
  }

  const remainingBefore = Math.max(rule.limit - state.count, 0);
  const retryAfterSeconds = Math.max(0, Math.ceil((state.resetAtMs - now) / 1000));
  reply.header('X-RateLimit-Limit', String(rule.limit));
  reply.header('X-RateLimit-Remaining', String(Math.max(remainingBefore - 1, 0)));
  reply.header('X-RateLimit-Reset', String(Math.floor(state.resetAtMs / 1000)));

  if (state.count >= rule.limit) {
    reply.header('Retry-After', String(retryAfterSeconds));
    reply.status(429).send(errorEnvelope('rate_limit_exceeded', 'Rate limit exceeded', {
      limit: rule.limit,
      window_seconds: rule.windowSeconds,
      retry_after_seconds: retryAfterSeconds,
      rule: rule.name,
    }));
    return false;
  }
  state.count += 1;
  return true;
}

function applyRateLimit(req: FastifyRequest, reply: any, rule: RateLimitRule) {
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
  const broadeningLevel = Number(payload?.broadening?.level ?? 0);
  const broadeningHigh = broadeningLevel >= config.searchBroadeningHighThreshold;
  const limitHigh = Number(payload?.limit ?? 20) >= 50;
  return qBroad && minimalFilters && (broadeningHigh || limitHigh);
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

function applySearchScrapeGuard(req: FastifyRequest, reply: any, payload: any) {
  const nodeId = (req as AuthedRequest).nodeId;
  if (!nodeId) return true;

  const pageIndex = decodeSearchCursorPageIndex(payload?.cursor ?? null);
  const broadeningLevel = Number(payload?.broadening?.level ?? 0);
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
      broadening_level: broadeningLevel,
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
    return values.some((value) => typeof value !== 'string' || !REGION_ID_REGEX.test(value.trim()));
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
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length) return false;
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
  const app = Fastify({ logger: true });

  if (!startupDbEnvCheckLogged) {
    startupDbEnvCheckLogged = true;
    app.log.info({ ...getSafeDbEnvDiagnostics(), check_point: 'startup' }, 'db env check');
    if (!config.stripeWebhookSecret) {
      app.log.warn(
        { stripe_webhook_secret_present: false, env_var: 'STRIPE_WEBHOOK_SECRET' },
        'Stripe webhook signature verification will fail until STRIPE_WEBHOOK_SECRET is set',
      );
    }
  }

  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err, ...requestErrorLogFields(req) }, 'unhandled error');
    if (reply.sent) return;
    reply.send(err);
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
      if (rateLimitRule && !applyRateLimit(req, reply, rateLimitRule)) return;
      return;
    }

    if (isPublicRoute(path)) {
      if (rateLimitRule && !applyRateLimit(req, reply, rateLimitRule)) return;
      return;
    }

    if (path.startsWith('/v1/admin/') || path.startsWith('/internal/admin/')) {
      if (req.headers['x-admin-key'] !== config.adminKey) return reply.status(401).send(errorEnvelope('unauthorized', 'Invalid admin key'));
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
    (req as AuthedRequest).hasSpendEntitlement = isSubscriber || found.has_active_trial;
    reply.header('X-Credits-Plan', found.plan_code ?? 'unknown');
    reply.header('X-Credits-Remaining', String(await repo.creditBalance(found.node_id)));

    if (rateLimitRule && !applyRateLimit(req, reply, rateLimitRule)) return;
  });

  app.addHook('preHandler', async (req, reply) => {
    if (!nonGet.has(req.method) || req.url === '/v1/webhooks/stripe') return;
    const idemKey = req.headers['idempotency-key'];
    if (!idemKey) return reply.status(422).send(errorEnvelope('validation_error', 'Idempotency-Key required'));
    const hash = crypto.createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');
    const idemPath = idempotencyRoutePath(req);

    if (isAnonIdempotentRoute(req.url)) {
      const keyScope = `${req.method}:${idemPath}:${String(idemKey)}`;
      const existing = anonIdem.get(keyScope);
      if (existing) {
        if (existing.hash !== hash) return reply.status(409).send(errorEnvelope('idempotency_key_reuse_conflict', 'Idempotency key used with different payload'));
        return reply.status(existing.status).send(existing.response);
      }
      (req as AuthedRequest).idem = { key: String(idemKey), hash, keyScope };
      return;
    }

    const nodeId = (req as AuthedRequest).nodeId;
    if (!nodeId) return;
    const existing = await repo.getIdempotency(nodeId, String(idemKey), req.method, idemPath);
    if (existing) {
      if (existing.request_hash !== hash) return reply.status(409).send(errorEnvelope('idempotency_key_reuse_conflict', 'Idempotency key used with different payload'));
      return reply.status(existing.status_code).send(existing.response_json);
    }
    (req as AuthedRequest).idem = { key: String(idemKey), hash, keyScope: `${nodeId}:${idemPath}` };
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (!nonGet.has(req.method) || req.url === '/v1/webhooks/stripe') return payload;
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
    if (isAnonIdempotentRoute(req.url)) {
      anonIdem.set(idem.keyScope, { hash: idem.hash, status: reply.statusCode, response: responseJson });
      return payload;
    }
    const nodeId = (req as AuthedRequest).nodeId;
    if (nodeId) await repo.saveIdempotency(nodeId, idem.key, req.method, idempotencyRoutePath(req), idem.hash, reply.statusCode, responseJson);
    return payload;
  });

  app.get('/openapi.json', async (_req, reply) => reply.type('application/json; charset=utf-8').send(openApiDocument));
  app.get('/v1/meta', async (req) => buildMetaPayload(req));
  app.get('/v1/categories', async () => CATEGORIES_RESPONSE);

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
      display_name: z.string(),
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
      display_name: z.string().nullable().optional(),
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
    if (!applyRateLimitSubject(reply, nodeRateRule, parsed.data.node_id)) return;

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
  app.post('/v1/billing/topups/checkout-session', async (req, reply) => {
    const parsed = z.object({
      node_id: z.string().uuid(),
      pack_code: z.enum(['credits_100', 'credits_300', 'credits_1000']),
      success_url: z.string().url(),
      cancel_url: z.string().url(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', parsed.error.flatten()));
    const out = await fabricService.createTopupCheckoutSession(
      (req as AuthedRequest).nodeId!,
      parsed.data,
      (req as AuthedRequest).idem?.key ?? null,
    );
    if ((out as any).forbidden) {
      return reply.status(403).send(errorEnvelope('forbidden', 'Cannot create topup checkout session for another node'));
    }
    if ((out as any).validationError) {
      const missing = Array.isArray((out as any).missing) ? (out as any).missing : undefined;
      if ((out as any).validationError === 'stripe_not_configured') {
        req.log.warn(
          {
            reason: 'stripe_not_configured',
            missing: missing ?? [],
            endpoint: '/v1/billing/topups/checkout-session',
          },
          'Stripe checkout blocked by configuration',
        );
      }
      return reply.status(422).send(errorEnvelope('validation_error', 'Unable to create topup checkout session', {
        reason: (out as any).validationError,
        stripe_status: (out as any).stripe_status ?? undefined,
        pack_code: (out as any).pack_code ?? parsed.data.pack_code,
        missing,
      }));
    }
    return out;
  });

  app.post('/v1/units', async (req, reply) => {
    const parsed = resourceSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
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
    const parsed = resourceSchema.extend({ need_by: z.string().nullable().optional(), accept_substitutions: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
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
    const parsed = resourceSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
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
    const vf = validateScopeFilters(parsed.data.scope, parsed.data.filters);
    if (!vf.ok) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid filters', { reason: vf.reason }));
    if (!applySearchScrapeGuard(req, reply, parsed.data)) return reply;
    const out = await fabricService.search((req as AuthedRequest).nodeId!, 'listings', !!(req as AuthedRequest).hasSpendEntitlement, parsed.data, (req as AuthedRequest).idem!.key);
    if ((out as any).validationError) {
      const reason = (out as any).validationError;
      if (reason === 'cursor_mismatch' || reason === 'invalid_cursor') {
        return reply.status(400).send(errorEnvelope('validation_error', 'Invalid search cursor', { reason }));
      }
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid search request', { reason }));
    }
    if ((out as any).forbidden) return reply.status(403).send(errorEnvelope('subscriber_required', 'Subscriber required'));
    if ((out as any).creditsExhausted) return reply.status(402).send(errorEnvelope('credits_exhausted', 'Not enough credits', (out as any).creditsExhausted));
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
    const vf = validateScopeFilters(parsed.data.scope, parsed.data.filters);
    if (!vf.ok) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid filters', { reason: vf.reason }));
    if (!applySearchScrapeGuard(req, reply, parsed.data)) return reply;
    const out = await fabricService.search((req as AuthedRequest).nodeId!, 'requests', !!(req as AuthedRequest).hasSpendEntitlement, parsed.data, (req as AuthedRequest).idem!.key);
    if ((out as any).validationError) {
      const reason = (out as any).validationError;
      if (reason === 'cursor_mismatch' || reason === 'invalid_cursor') {
        return reply.status(400).send(errorEnvelope('validation_error', 'Invalid search cursor', { reason }));
      }
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid search request', { reason }));
    }
    if ((out as any).forbidden) return reply.status(403).send(errorEnvelope('subscriber_required', 'Subscriber required'));
    if ((out as any).creditsExhausted) return reply.status(402).send(errorEnvelope('credits_exhausted', 'Not enough credits', (out as any).creditsExhausted));
    return out;
  });

  app.get('/v1/public/nodes/:node_id/listings', async (req, reply) => {
    const q = req.query as any;
    const out = await fabricService.nodePublicInventory((req as AuthedRequest).nodeId!, (req.params as any).node_id, 'listings', !!(req as AuthedRequest).hasSpendEntitlement, Number(q.limit ?? 20), q.cursor ?? null);
    if ((out as any).forbidden) return reply.status(403).send(errorEnvelope('subscriber_required', 'Subscriber required'));
    if ((out as any).creditsExhausted) return reply.status(402).send(errorEnvelope('credits_exhausted', 'Not enough credits', (out as any).creditsExhausted));
    return out;
  });
  app.get('/v1/public/nodes/:node_id/requests', async (req, reply) => {
    const q = req.query as any;
    const out = await fabricService.nodePublicInventory((req as AuthedRequest).nodeId!, (req.params as any).node_id, 'requests', !!(req as AuthedRequest).hasSpendEntitlement, Number(q.limit ?? 20), q.cursor ?? null);
    if ((out as any).forbidden) return reply.status(403).send(errorEnvelope('subscriber_required', 'Subscriber required'));
    if ((out as any).creditsExhausted) return reply.status(402).send(errorEnvelope('credits_exhausted', 'Not enough credits', (out as any).creditsExhausted));
    return out;
  });
  app.get('/v1/public/nodes/:node_id/listings/categories/:category_id', async (req, reply) => {
    const q = req.query as any;
    const limit = Number(q.limit ?? 20);
    const categoryId = Number((req.params as any).category_id);
    if (!Number.isInteger(categoryId) || categoryId < 0) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid category filter', { reason: 'category_id_invalid' }));
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid pagination params', { reason: 'limit_out_of_range' }));
    }
    const out = await fabricService.nodePublicInventoryByCategory(
      (req as AuthedRequest).nodeId!,
      (req.params as any).node_id,
      'listings',
      categoryId,
      !!(req as AuthedRequest).hasSpendEntitlement,
      limit,
      q.cursor ?? null,
    );
    if ((out as any).forbidden) return reply.status(403).send(errorEnvelope('subscriber_required', 'Subscriber required'));
    if ((out as any).creditsExhausted) return reply.status(402).send(errorEnvelope('credits_exhausted', 'Not enough credits', (out as any).creditsExhausted));
    return out;
  });
  app.get('/v1/public/nodes/:node_id/requests/categories/:category_id', async (req, reply) => {
    const q = req.query as any;
    const limit = Number(q.limit ?? 20);
    const categoryId = Number((req.params as any).category_id);
    if (!Number.isInteger(categoryId) || categoryId < 0) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid category filter', { reason: 'category_id_invalid' }));
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Invalid pagination params', { reason: 'limit_out_of_range' }));
    }
    const out = await fabricService.nodePublicInventoryByCategory(
      (req as AuthedRequest).nodeId!,
      (req.params as any).node_id,
      'requests',
      categoryId,
      !!(req as AuthedRequest).hasSpendEntitlement,
      limit,
      q.cursor ?? null,
    );
    if ((out as any).forbidden) return reply.status(403).send(errorEnvelope('subscriber_required', 'Subscriber required'));
    if ((out as any).creditsExhausted) return reply.status(402).send(errorEnvelope('credits_exhausted', 'Not enough credits', (out as any).creditsExhausted));
    return out;
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
    const parsed = z.object({ unit_ids: z.array(z.string()).min(1), thread_id: z.string().nullable(), note: z.string().nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const out = await (fabricService as any).createOffer((req as AuthedRequest).nodeId!, parsed.data.unit_ids, parsed.data.thread_id, parsed.data.note);
    if (out.legalRequired) return reply.status(422).send(errorEnvelope('legal_required', 'Legal assent is required', { required_legal_version: config.requiredLegalVersion }));
    if (out.conflict) return reply.status(409).send(errorEnvelope('conflict', 'Offer conflict', { reason: out.conflict }));
    return out;
  });
  app.post('/v1/offers/:offer_id/counter', async (req, reply) => {
    const parsed = z.object({ unit_ids: z.array(z.string()).min(1), note: z.string().nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const out = await (fabricService as any).counterOffer((req as AuthedRequest).nodeId!, (req.params as any).offer_id, parsed.data.unit_ids, parsed.data.note);
    if (out.legalRequired) return reply.status(422).send(errorEnvelope('legal_required', 'Legal assent is required', { required_legal_version: config.requiredLegalVersion }));
    if (out.notFound) return reply.status(404).send(errorEnvelope('not_found', 'Offer not found'));
    return out;
  });
  app.post('/v1/offers/:offer_id/accept', async (req, reply) => {
    const out = await (fabricService as any).acceptOffer((req as AuthedRequest).nodeId!, (req.params as any).offer_id);
    if (out.legalRequired) return reply.status(422).send(errorEnvelope('legal_required', 'Legal assent is required', { required_legal_version: config.requiredLegalVersion }));
    if (out.forbidden) return reply.status(403).send(errorEnvelope('forbidden', 'Not allowed'));
    if (out.notFound) return reply.status(404).send(errorEnvelope('not_found', 'Offer not found'));
    if (out.conflict) return reply.status(409).send(errorEnvelope('invalid_state_transition', 'Invalid transition'));
    return out;
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
    if (out.legalRequired) return reply.status(422).send(errorEnvelope('legal_required', 'Legal assent is required', { required_legal_version: config.requiredLegalVersion }));
    if (out.forbidden) return reply.status(403).send(errorEnvelope('forbidden', 'Not allowed'));
    return out;
  });
  app.get('/events', async (req, reply) => {
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

  app.post('/v1/referrals/claim', async (req, reply) => {
    const parsed = z.object({ referral_code: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const out = await (fabricService as any).claimReferral((req as AuthedRequest).nodeId!, parsed.data.referral_code);
    if (out.invalid) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid referral code'));
    if (out.locked) return reply.status(409).send(errorEnvelope('invalid_state_transition', 'Referral locked after paid event'));
    return { ok: true, referrer_node_id: out.referrer_node_id };
  });

  app.register(async (webhookApp) => {
    webhookApp.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
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

        if (!eventId) return reply.status(422).send(errorEnvelope('validation_error', 'Missing stripe event id'));
        await repo.insertStripeEvent(eventId, eventType, event);
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
  });

  app.post('/v1/admin/takedown', async (req, reply) => {
    const parsed = z.object({ target_type: z.enum(['public_listing', 'public_request', 'node']), target_id: z.string(), reason: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const dbType = parsed.data.target_type === 'public_listing' ? 'listing' : parsed.data.target_type === 'public_request' ? 'request' : 'node';
    await query('insert into takedowns(target_type,target_id,reason) values($1,$2,$3)', [dbType, parsed.data.target_id, parsed.data.reason]);
    return { ok: true };
  });
  app.get('/v1/admin/diagnostics/stripe', async (req) => {
    return {
      ...fabricService.stripeDiagnostics(),
      active_base_url: activeBaseHost(req),
    };
  });
  app.get('/internal/admin/daily-metrics', async () => fabricService.adminDailyMetrics());
  app.post('/v1/admin/credits/adjust', async (req, reply) => {
    const parsed = z.object({ node_id: z.string(), delta: z.number(), reason: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    await repo.addCredit(parsed.data.node_id, 'adjustment_manual', parsed.data.delta, { reason: parsed.data.reason });
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
        select u.id,u.node_id,jsonb_build_object('id',u.id,'node_id',u.node_id,'scope_primary',u.scope_primary,'scope_secondary',u.scope_secondary,'title',u.title,'description',u.description,'public_summary',u.public_summary,'quantity',u.quantity,'measure',u.measure,'custom_measure',u.custom_measure,'category_ids',u.category_ids,'tags',u.tags,'type',u.type,'condition',u.condition,'location_text_public',u.location_text_public,'origin_region',u.origin_region,'dest_region',u.dest_region,'service_region',u.service_region,'delivery_format',u.delivery_format,'max_ship_days',u.max_ship_days,'photos',u.photos,'published_at',u.published_at,'updated_at',u.updated_at),u.published_at
        from units u join nodes n on n.id=u.node_id where u.published_at is not null and u.deleted_at is null and n.status='ACTIVE' and n.suspended_at is null and n.deleted_at is null and not exists (select 1 from takedowns t where t.target_type='listing' and t.target_id=u.id and t.reversed_at is null) and not exists (select 1 from takedowns t where t.target_type='node' and t.target_id=u.node_id and t.reversed_at is null)`);
    }
    if (kind === 'all' || kind === 'requests') {
      await query('truncate table public_requests');
      await query(`insert into public_requests(request_id,node_id,doc,published_at)
        select r.id,r.node_id,jsonb_build_object('id',r.id,'node_id',r.node_id,'scope_primary',r.scope_primary,'scope_secondary',r.scope_secondary,'title',r.title,'description',r.description,'public_summary',r.public_summary,'desired_quantity',r.desired_quantity,'measure',r.measure,'custom_measure',r.custom_measure,'category_ids',r.category_ids,'tags',r.tags,'type',r.type,'condition',r.condition,'location_text_public',r.location_text_public,'origin_region',r.origin_region,'dest_region',r.dest_region,'service_region',r.service_region,'delivery_format',r.delivery_format,'max_ship_days',r.max_ship_days,'need_by',r.need_by,'accept_substitutions',r.accept_substitutions,'published_at',r.published_at,'updated_at',r.updated_at),r.published_at
        from requests r join nodes n on n.id=r.node_id where r.published_at is not null and r.deleted_at is null and n.status='ACTIVE' and n.suspended_at is null and n.deleted_at is null and not exists (select 1 from takedowns t where t.target_type='request' and t.target_id=r.id and t.reversed_at is null) and not exists (select 1 from takedowns t where t.target_type='node' and t.target_id=r.node_id and t.reversed_at is null)`);
    }
    const listingsCount = Number((await query<{ c: string }>('select count(*)::text as c from public_listings'))[0].c);
    const requestsCount = Number((await query<{ c: string }>('select count(*)::text as c from public_requests'))[0].c);
    return { ok: true, kind, mode, started_at, finished_at: new Date().toISOString(), counts: { public_listings_written: listingsCount, public_requests_written: requestsCount } };
  });

  app.get('/healthz', async () => ({ ok: true }));

  return app;
}

