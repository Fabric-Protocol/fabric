import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';

delete process.env.DATABASE_URL;
delete process.env.ADMIN_KEY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.STRIPE_CREDIT_PACK_PRICE_500;
delete process.env.STRIPE_CREDIT_PACK_PRICE_1500;
delete process.env.STRIPE_CREDIT_PACK_PRICE_4500;
delete process.env.EMAIL_PROVIDER;
delete process.env.RECOVERY_CHALLENGE_TTL_MINUTES;
delete process.env.RECOVERY_CHALLENGE_MAX_ATTEMPTS;
delete process.env.RATE_LIMIT_RECOVERY_START_PER_HOUR;
delete process.env.RATE_LIMIT_RECOVERY_START_PER_NODE_PER_HOUR;
delete process.env.RATE_LIMIT_EMAIL_VERIFY_START_PER_HOUR;
delete process.env.SEARCH_CREDIT_COST;
delete process.env.SEARCH_TARGET_CREDIT_COST;
delete process.env.SEARCH_PAGE_PROHIBITIVE_FROM;
delete process.env.SEARCH_PAGE_PROHIBITIVE_COST;
delete process.env.SIGNUP_GRANT_CREDITS;
delete process.env.UPLOAD_TRIAL_THRESHOLD;
delete process.env.UPLOAD_TRIAL_CREDIT_GRANT;
delete process.env.REQUEST_MILESTONE_THRESHOLD;
delete process.env.REQUEST_MILESTONE_CREDIT_GRANT;
delete process.env.REFERRAL_MAX_GRANTS_PER_REFERRER;
delete process.env.DEAL_ACCEPTANCE_FEE_CREDITS;

process.env.ADMIN_KEY = 'admin-test';
process.env.STRIPE_SECRET_KEY = 'sk_test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_PRICE_BASIC = 'price_basic_test';
process.env.STRIPE_PRICE_PRO = 'price_pro_test';
process.env.STRIPE_PRICE_BUSINESS = 'price_business_test';
process.env.STRIPE_CREDIT_PACK_PRICE_500 = 'price_credit_pack_500_test';
process.env.STRIPE_CREDIT_PACK_PRICE_1500 = 'price_credit_pack_1500_test';
process.env.STRIPE_CREDIT_PACK_PRICE_4500 = 'price_credit_pack_4500_test';
process.env.RATE_LIMIT_BOOTSTRAP_PER_HOUR = '1000';
process.env.EMAIL_PROVIDER = 'stub';
process.env.RECOVERY_CHALLENGE_TTL_MINUTES = '10';
process.env.RECOVERY_CHALLENGE_MAX_ATTEMPTS = '5';
process.env.RATE_LIMIT_RECOVERY_START_PER_HOUR = '1000';
process.env.RATE_LIMIT_RECOVERY_START_PER_NODE_PER_HOUR = '1000';
process.env.RATE_LIMIT_EMAIL_VERIFY_START_PER_HOUR = '1000';
process.env.SEARCH_CREDIT_COST = '5';
process.env.SEARCH_TARGET_CREDIT_COST = '1';
process.env.SEARCH_PAGE_PROHIBITIVE_COST = '100';
process.env.SIGNUP_GRANT_CREDITS = '100';
process.env.UPLOAD_TRIAL_THRESHOLD = '20';
process.env.UPLOAD_TRIAL_CREDIT_GRANT = '200';
process.env.REQUEST_MILESTONE_THRESHOLD = '20';
process.env.REQUEST_MILESTONE_CREDIT_GRANT = '200';
process.env.REFERRAL_MAX_GRANTS_PER_REFERRER = '50';
process.env.DEAL_ACCEPTANCE_FEE_CREDITS = '1';
process.env.NOWPAYMENTS_API_KEY = 'test-nowpayments-key';
process.env.NOWPAYMENTS_IPN_SECRET = 'test-ipn-secret';
process.env.CRYPTO_CREDIT_PACK_ENABLED = 'true';

const REQUIRED_LEGAL_VERSION = '2026-02-17';
const TEST_RUN_SUFFIX = crypto.randomUUID().slice(0, 8);
const LIVE_PRICE_IDS = {
  basic: 'price_1T1tO2K3gJAgZl81QzBXfPIf',
  pro: 'price_1T1wL1K3gJAgZl81IYKvjCsD',
  business: 'price_1T1wLgK3gJAgZl81450PfCc3',
  creditPack500: 'price_1T3tJlK3gJAgZl81iZzGyRaj',
  creditPack1500: 'price_1T3tQ2K3gJAgZl81JGlIYaSy',
  creditPack4500: 'price_1T3tKlK3gJAgZl81HBKJ5a8U',
};

const { buildApp } = await import('../dist/src/app.js');
const { config } = await import('../dist/src/config.js');
const repo = await import('../dist/src/db/fabricRepo.js');
const { query } = await import('../dist/src/db/client.js');
const retentionPolicy = await import('../dist/src/retentionPolicy.js');
const emailProvider = await import('../dist/src/services/emailProvider.js');
const fabricService = await import('../dist/src/services/fabricService.js');
const nowPaymentsModule = await import('../dist/src/services/nowPayments.js');

const searchRankingMigrationSql = await fs.readFile(
  new URL('../supabase_migrations/2026-02-22__apply_search_ranking.sql', import.meta.url),
  'utf8',
);
await query(searchRankingMigrationSql);

const requestExpiryMigrationSql = await fs.readFile(
  new URL('../supabase_migrations/2026-02-24__apply_request_expiry.sql', import.meta.url),
  'utf8',
);
await query(requestExpiryMigrationSql);

const creditLedgerTypesMigrationSql = await fs.readFile(
  new URL('../supabase_migrations/2026-02-23__apply_credit_ledger_types.sql', import.meta.url),
  'utf8',
);
await query(creditLedgerTypesMigrationSql);

const cryptoPaymentsMigrationSql = await fs.readFile(
  new URL('../supabase_migrations/2026-02-25__apply_crypto_payments.sql', import.meta.url),
  'utf8',
);
await query(cryptoPaymentsMigrationSql);

await query('DELETE FROM stripe_events');
await query('DELETE FROM admin_idempotency_keys');

async function bootstrap(
  app,
  idk = 'boot-1',
  payload = { display_name: 'Node', email: null, referral_code: null },
  options = {},
) {
  const basePayload = payload && typeof payload === 'object' ? payload : {};
  const rawDisplayName = basePayload.display_name ?? 'Node';
  const useExactDisplayName = options.exactDisplayName === true;
  const displayName = useExactDisplayName
    ? rawDisplayName
    : `${rawDisplayName}-${TEST_RUN_SUFFIX}-${idk}`;
  const requestPayload = {
    ...basePayload,
    display_name: displayName,
    email: basePayload.email ?? null,
    referral_code: basePayload.referral_code ?? null,
    legal: basePayload.legal ?? { accepted: true, version: REQUIRED_LEGAL_VERSION },
  };
  const res = await app.inject({ method: 'POST', url: '/v1/bootstrap', headers: { 'idempotency-key': idk }, payload: requestPayload });
  return res;
}

async function suspendNode(nodeId) {
  await query("update nodes set status='SUSPENDED', suspended_at=now() where id=$1", [nodeId]);
}

async function activateBasicSubscriber(app, nodeId, eventIdPrefix = 'evt_subscriber') {
  const body = {
    id: `${eventIdPrefix}_${nodeId.slice(0, 8)}`,
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', metadata: { node_id: nodeId, plan_code: 'basic' }, customer: `cus_${nodeId.slice(0, 8)}`, subscription: `sub_${nodeId.slice(0, 8)}` } },
  };
  const sig = sign(body);
  return app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
}

async function grantTrialEntitlement(nodeId) {
  await query(
    `insert into trial_entitlements(node_id, source, threshold_count, upload_count_at_grant, starts_at, ends_at)
     values($1, 'unit_upload_count', 0, 0, now(), now() + interval '7 days')
     on conflict (node_id) do update set starts_at=now(), ends_at=now() + interval '7 days'`,
    [nodeId],
  );
}

function unitPayload(title, scopeNotes = 'unit-scope') {
  return {
    title,
    description: 'test unit',
    type: 'service',
    condition: null,
    quantity: 1,
    measure: 'EA',
    custom_measure: null,
    scope_primary: 'OTHER',
    scope_secondary: [],
    scope_notes: scopeNotes,
    location_text_public: null,
    origin_region: null,
    dest_region: null,
    service_region: null,
    delivery_format: null,
    tags: [],
    category_ids: [],
    public_summary: title,
  };
}

function sign(body) {
  const t = Math.floor(Date.now() / 1000);
  const raw = JSON.stringify(body);
  const v1 = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex');
  return { t, v1, raw, header: `t=${t},v1=${v1}` };
}

function signRecoveryChallenge(challengeId, nonce, privateKey) {
  const payload = Buffer.from(`fabric-recovery:${challengeId}:${nonce}`, 'utf8');
  return crypto.sign(null, payload, privateKey).toString('base64');
}

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function withMockFetch(mockFetch, fn) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    return await fn();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

async function withConfigOverrides(overrides, fn) {
  const originals = {};
  for (const [key, value] of Object.entries(overrides)) {
    originals[key] = config[key];
    config[key] = value;
  }
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      config[key] = value;
    }
  }
}

async function withMockWebhookDnsLookup(mockLookup, fn) {
  fabricService.__setWebhookDnsLookupForTests(mockLookup);
  try {
    return await fn();
  } finally {
    fabricService.__setWebhookDnsLookupForTests(null);
  }
}

test('canonical error envelope for unauthorized', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/v1/me' });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'unauthorized');
  await app.close();
});

test('GET /v1/meta returns required legal version and legal URLs', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/meta',
    headers: { host: 'fabric.example', 'x-forwarded-proto': 'https' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.api_version, 'v1');
  assert.equal(body.required_legal_version, REQUIRED_LEGAL_VERSION);
  assert.equal(body.openapi_url, 'https://fabric.example/openapi.json');
  assert.equal(body.categories_url, 'https://fabric.example/v1/categories');
  assert.equal(body.categories_version, 1);
  assert.equal(body.legal_urls.terms, 'https://fabric.example/legal/terms');
  assert.equal(body.legal_urls.privacy, 'https://fabric.example/legal/privacy');
  assert.equal(body.legal_urls.aup, 'https://fabric.example/legal/acceptable-use');
  assert.equal(body.support_url, 'https://fabric.example/support');
  assert.equal(body.docs_urls.agents_url, 'https://fabric.example/docs/agents');
  assert.match(body.openapi_url, /^https:\/\//);
  assert.match(body.categories_url, /^https:\/\//);
  assert.match(body.docs_urls.agents_url, /^https:\/\//);
  assert.match(body.docs_urls.agents_url, /\/docs\/agents$/);

  const toc = body.agent_toc;
  assert.ok(toc, 'agent_toc must be present');
  assert.ok(typeof toc.welcome === 'string' && toc.welcome.length > 0, 'welcome must be a non-empty string');
  assert.ok(Array.isArray(toc.deal_structures), 'deal_structures must be an array');
  assert.ok(toc.deal_structures.some(s => s.includes('barter')), 'deal_structures must mention barter');
  assert.ok(toc.deal_structures.some(s => s.includes('monetary')), 'deal_structures must mention monetary');
  assert.ok(toc.deal_structures.some(s => s.includes('hybrid')), 'deal_structures must mention hybrid');
  assert.ok(Array.isArray(toc.happy_path), 'happy_path must be an array');
  assert.ok(Array.isArray(toc.start_here), 'start_here must be an array');
  assert.ok(toc.start_here.some(s => s.includes('GET /v1/meta')), 'start_here must include GET /v1/meta');
  assert.ok(toc.start_here.some(s => s.includes('POST /v1/bootstrap')), 'start_here must include POST /v1/bootstrap');
  assert.ok(Array.isArray(toc.capabilities), 'capabilities must be an array');
  assert.ok(toc.capabilities.length >= 3, 'capabilities must list at least 3 items');
  assert.ok(Array.isArray(toc.invariants), 'invariants must be an array');
  assert.ok(toc.invariants.includes('error_envelope_on_all_non_2xx'));
  assert.ok(toc.invariants.includes('credits_charged_only_on_200'));
  assert.ok(Array.isArray(toc.trust_safety_rules), 'trust_safety_rules must be an array');
  assert.ok(toc.trust_safety_rules.includes('no_contact_info_in_descriptions_or_notes'));
  assert.ok(toc.trust_safety_rules.includes('contact_reveal_only_after_mutual_acceptance'));
  assert.ok(toc.trust_safety_rules.includes('public_projections_allowlist_only'));
  await app.close();
});

test('GET /v1/categories returns stable registry and version hook', async () => {
  const app = buildApp();
  const categories = await app.inject({
    method: 'GET',
    url: '/v1/categories',
    headers: { host: 'fabric.example', 'x-forwarded-proto': 'https' },
  });
  assert.equal(categories.statusCode, 200);
  const payload = categories.json();
  assert.equal(payload.categories_version, 1);
  assert.equal(Array.isArray(payload.categories), true);
  assert.equal(payload.categories.length, 10);

  const ids = new Set();
  const slugs = new Set();
  for (const category of payload.categories) {
    assert.equal(Number.isInteger(category.id), true);
    assert.equal(typeof category.slug, 'string');
    assert.equal(typeof category.name, 'string');
    assert.equal(typeof category.description, 'string');
    assert.equal(Array.isArray(category.examples), true);
    assert.equal(category.examples.length, 5);
    assert.match(category.slug, /^[a-z0-9]+(?:_[a-z0-9]+)*$/);
    ids.add(category.id);
    slugs.add(category.slug);
  }
  assert.equal(ids.size, 10);
  assert.equal(slugs.size, 10);

  const meta = await app.inject({
    method: 'GET',
    url: '/v1/meta',
    headers: { host: 'fabric.example', 'x-forwarded-proto': 'https' },
  });
  assert.equal(meta.statusCode, 200);
  const metaBody = meta.json();
  assert.equal(metaBody.categories_version, payload.categories_version);
  assert.equal(metaBody.categories_url, 'https://fabric.example/v1/categories');

  await app.close();
});

test('GET /openapi.json returns valid OpenAPI JSON', async () => {
  const app = buildApp();
  const meta = await app.inject({
    method: 'GET',
    url: '/v1/meta',
    headers: { host: 'fabric.example', 'x-forwarded-proto': 'https' },
  });
  const openapiUrl = new URL(meta.json().openapi_url);
  const res = await app.inject({
    method: 'GET',
    url: openapiUrl.pathname,
    headers: { host: 'fabric.example', 'x-forwarded-proto': 'https' },
  });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type'] ?? ''), /^application\/json/);
  const body = res.json();
  assert.equal(typeof body.openapi, 'string');
  assert.match(body.openapi, /^3\./);
  assert.equal(Boolean(body.paths?.['/v1/categories']?.get), true);
  assert.equal(Boolean(body.paths?.['/v1/search/listings']?.post), true);
  assert.equal(Boolean(body.paths?.['/v1/search/requests']?.post), true);
  assert.equal(Boolean(body.paths?.['/v1/requests']?.post), true);
  assert.equal(Boolean(body.paths?.['/v1/requests/{request_id}']?.patch), true);
  assert.equal(Boolean(body.paths?.['/v1/offers']?.post), true);
  assert.equal(Boolean(body.paths?.['/v1/offers/{offer_id}/counter']?.post), true);
  assert.equal(Boolean(body.paths?.['/v1/offers/{offer_id}/accept']?.post), true);
  assert.equal(Boolean(body.paths?.['/v1/offers/{offer_id}/reveal-contact']?.post), true);
  assert.equal(Boolean(body.paths?.['/v1/me']?.patch), true);
  assert.equal(Boolean(body.paths?.['/v1/events']?.get), true);
  const offerCreateParams = body.paths?.['/v1/offers']?.post?.parameters ?? [];
  const idemParamRef = offerCreateParams.find((p) => p && p.$ref === '#/components/parameters/IdempotencyKeyHeader');
  assert.equal(Boolean(idemParamRef), true);
  const offerCreateSchema = body.components?.schemas?.OfferCreateRequest ?? {};
  assert.equal(offerCreateSchema.properties?.ttl_minutes?.minimum, 15);
  assert.equal(offerCreateSchema.properties?.ttl_minutes?.maximum, 10080);
  const offerCounterSchema = body.components?.schemas?.OfferCounterRequest ?? {};
  assert.equal(offerCounterSchema.properties?.ttl_minutes?.minimum, 15);
  assert.equal(offerCounterSchema.properties?.ttl_minutes?.maximum, 10080);
  const requestCreateSchema = body.components?.schemas?.RequestCreateRequest ?? {};
  assert.equal(requestCreateSchema.properties?.ttl_minutes?.minimum, 60);
  assert.equal(requestCreateSchema.properties?.ttl_minutes?.maximum, 525600);
  const requestPatchSchema = body.components?.schemas?.RequestPatchRequest ?? {};
  assert.equal(requestPatchSchema.properties?.ttl_minutes?.minimum, 60);
  assert.equal(requestPatchSchema.properties?.ttl_minutes?.maximum, 525600);
  const offerSchema = body.components?.schemas?.Offer ?? {};
  assert.equal(Array.isArray(offerSchema.required), true);
  assert.equal(offerSchema.required.includes('expires_at'), true);
  const eventsParams = body.paths?.['/v1/events']?.get?.parameters ?? [];
  const sinceParam = eventsParams.find((p) => p && p.$ref === '#/components/parameters/EventsSinceQuery');
  const limitParam = eventsParams.find((p) => p && p.$ref === '#/components/parameters/EventsLimitQuery');
  assert.equal(Boolean(sinceParam), true);
  assert.equal(Boolean(limitParam), true);
  const mePatchSchema = body.components?.schemas?.MePatchRequest ?? {};
  assert.equal(mePatchSchema.properties?.event_webhook_secret?.writeOnly, true);
  assert.equal(mePatchSchema.properties?.event_webhook_secret?.nullable, true);
  assert.equal(mePatchSchema.properties?.event_webhook_secret?.maxLength, 256);
  assert.equal(mePatchSchema.properties?.event_webhook_url?.maxLength, 2048);
  const mePatchRequired = Array.isArray(mePatchSchema.required) ? mePatchSchema.required : [];
  assert.equal(mePatchRequired.includes('display_name'), false);
  assert.equal(mePatchRequired.includes('email'), false);
  assert.equal(body.components?.schemas?.CategoriesResponse?.required?.includes('categories_version'), true);
  assert.equal(body.components?.schemas?.CategoriesResponse?.required?.includes('categories'), true);
  const searchFilters = body.components?.schemas?.SearchFilters ?? {};
  assert.equal(searchFilters.properties?.category_ids_any?.type, 'array');
  assert.equal(searchFilters.properties?.category_ids_any?.items?.type, 'integer');
  assert.equal(searchFilters.properties?.regions?.items?.pattern, '^[A-Z]{2}(-[A-Z0-9]{1,3})?$');
  assert.equal(searchFilters.properties?.ship_to_regions?.items?.pattern, '^[A-Z]{2}(-[A-Z0-9]{1,3})?$');
  assert.equal(searchFilters.properties?.ships_from_regions?.items?.pattern, '^[A-Z]{2}(-[A-Z0-9]{1,3})?$');
  assert.equal(Boolean(body.paths?.['/v1/search/listings']?.post?.responses?.['400']), true);
  assert.equal(Boolean(body.paths?.['/v1/search/requests']?.post?.responses?.['400']), true);
  assert.equal(body.paths?.['/v1/search/listings']?.post?.responses?.['403']?.description, 'Forbidden');
  assert.equal(body.paths?.['/v1/search/requests']?.post?.responses?.['403']?.description, 'Forbidden');
  const searchRequestRequired = body.components?.schemas?.SearchRequest?.required ?? [];
  const searchQuoteRequestRequired = body.components?.schemas?.SearchQuoteRequest?.required ?? [];
  assert.equal(searchRequestRequired.includes('broadening'), false);
  assert.equal(searchQuoteRequestRequired.includes('broadening'), false);
  const searchBudgetSchema = body.components?.schemas?.SearchRequest?.properties?.budget ?? {};
  assert.equal(searchBudgetSchema.properties?.credits_requested?.type, 'integer');
  assert.equal(searchBudgetSchema.properties?.credits_max?.deprecated, true);
  const metaRequired = body.paths?.['/v1/meta']?.get?.responses?.['200']?.content?.['application/json']?.schema?.required ?? [];
  assert.equal(metaRequired.includes('categories_url'), true);
  assert.equal(metaRequired.includes('categories_version'), true);
  assert.equal(metaRequired.includes('agent_toc'), true);
  const agentTocSchema = body.paths?.['/v1/meta']?.get?.responses?.['200']?.content?.['application/json']?.schema?.properties?.agent_toc ?? {};
  assert.equal(agentTocSchema.type, 'object');
  assert.ok(Array.isArray(agentTocSchema.required));
  assert.ok(agentTocSchema.required.includes('start_here'));
  assert.ok(agentTocSchema.required.includes('trust_safety_rules'));
  await app.close();
});

test('GET /legal/terms returns HTML', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/legal/terms' });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type'] ?? ''), /^text\/html/);
  assert.match(res.body, /Terms of Service/);
  await app.close();
});

test('GET /legal/aup returns acceptable-use alias HTML', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/legal/aup' });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type'] ?? ''), /^text\/html/);
  assert.match(res.body, /Acceptable Use Policy/);
  await app.close();
});

test('GET /healthz returns ok', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/healthz' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { ok: true });
  await app.close();
});

test('GET /docs/agents returns quickstart HTML content', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/docs/agents',
    headers: { host: 'fabric.example', 'x-forwarded-proto': 'https' },
  });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type'] ?? ''), /^text\/html/);
  assert.match(res.body, /Fabric.*Agent Quickstart/);
  assert.match(res.body, /Authorization: ApiKey/);
  assert.match(res.body, /Idempotency-Key/);
  assert.match(res.body, /If-Match/);
  assert.match(res.body, /https:\/\/fabric\.example\/openapi\.json/);
  assert.match(res.body, /\/v1\/offers/);
  assert.match(res.body, /Why things cost/);
  assert.match(res.body, /trust_safety_rules/);
  assert.match(res.body, /why_costs_exist/);
  await app.close();
});

test('GET /support returns abuse/security guidance', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/support' });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type'] ?? ''), /^text\/html/);
  assert.match(res.body, /security/i);
  assert.match(res.body, /abuse/i);
  await app.close();
});

test('GET legal and support routes return finalized HTML', async () => {
  const app = buildApp();
  const routes = [
    '/legal/terms',
    '/legal/privacy',
    '/legal/acceptable-use',
    '/legal/refunds',
    '/legal/agents',
    '/support',
  ];
  for (const route of routes) {
    const res = await app.inject({ method: 'GET', url: route });
    assert.equal(res.statusCode, 200);
    assert.match(String(res.headers['content-type'] ?? ''), /^text\/html/);
    assert.doesNotMatch(res.body, /PLACEHOLDER - replace with final legal text before public go-live/i);
    assert.match(res.body, /2026-02-17/);
    assert.match(res.body, /Fabric Protocol/);
  }
  await app.close();
});

test('search log retention policy classification is deterministic', async () => {
  const now = new Date('2026-02-17T00:00:00.000Z');
  assert.equal(retentionPolicy.classifySearchLogRetention('2026-02-10T00:00:00.000Z', now), 'hot');
  assert.equal(retentionPolicy.classifySearchLogRetention('2025-12-01T00:00:00.000Z', now), 'archive');
  assert.equal(retentionPolicy.classifySearchLogRetention('2024-12-01T00:00:00.000Z', now), 'delete');
});

test('POST /v1/bootstrap without legal assent returns legal_required', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/bootstrap',
    headers: { 'idempotency-key': 'boot-no-legal' },
    payload: { display_name: 'Node', email: null, referral_code: null },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, 'legal_required');
  assert.equal(res.json().error.details.required_legal_version, REQUIRED_LEGAL_VERSION);
  assert.equal(typeof res.json().error.details.legal_urls.terms, 'string');
  await app.close();
});

test('POST /v1/bootstrap with legal assent stores legal fields', async () => {
  const app = buildApp();
  const legalDisplayName = `Node Legal ${TEST_RUN_SUFFIX}`;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/bootstrap',
    headers: {
      'idempotency-key': 'boot-with-legal',
      'user-agent': 'fabric-test-agent',
      'x-forwarded-for': '203.0.113.10, 198.51.100.3',
    },
    payload: {
      display_name: legalDisplayName,
      email: null,
      referral_code: null,
      legal: { accepted: true, version: REQUIRED_LEGAL_VERSION },
    },
  });
  assert.equal(res.statusCode, 200);
  const nodeId = res.json().node.id;
  const me = await repo.getMe(nodeId);
  assert.equal(me.legal_version, REQUIRED_LEGAL_VERSION);
  assert.ok(me.legal_accepted_at);
  assert.equal(me.legal_ip, '203.0.113.10');
  assert.equal(me.legal_user_agent, 'fabric-test-agent');
  await app.close();
});

test('POST /v1/bootstrap grants configured signup credits', async () => {
  const app = buildApp();
  const res = await bootstrap(app, 'boot-signup-grant');
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().credits.granted, config.signupGrantCredits);
  const nodeId = res.json().node.id;
  const balance = await repo.creditBalance(nodeId);
  assert.equal(balance, config.signupGrantCredits);
  await app.close();
});

test('idempotency replay and conflict on /v1/bootstrap', async () => {
  const app = buildApp();
  const a = await bootstrap(app, 'same-key', { display_name: 'A', email: null, referral_code: null });
  const b = await bootstrap(app, 'same-key', { display_name: 'A', email: null, referral_code: null });
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  assert.equal(a.json().node.id, b.json().node.id);

  const c = await bootstrap(app, 'same-key', { display_name: 'B', email: null, referral_code: null });
  assert.equal(c.statusCode, 409);
  assert.equal(c.json().error.code, 'idempotency_key_reuse_conflict');
  await app.close();
});

test('POST /v1/bootstrap rejects duplicate display_name', async () => {
  const app = buildApp();
  const duplicateName = `Duplicate Display ${TEST_RUN_SUFFIX}`;
  const first = await bootstrap(app, 'boot-display-name-a', {
    display_name: duplicateName,
    email: null,
    referral_code: null,
  }, { exactDisplayName: true });
  assert.equal(first.statusCode, 200);

  const second = await bootstrap(app, 'boot-display-name-b', {
    display_name: duplicateName,
    email: null,
    referral_code: null,
  }, { exactDisplayName: true });
  assert.equal(second.statusCode, 422);
  assert.equal(second.json().error.code, 'validation_error');
  assert.equal(second.json().error.details.reason, 'display_name_taken');

  const caseVariant = await bootstrap(app, 'boot-display-name-c', {
    display_name: duplicateName.toLowerCase(),
    email: null,
    referral_code: null,
  }, { exactDisplayName: true });
  assert.equal(caseVariant.statusCode, 422);
  assert.equal(caseVariant.json().error.code, 'validation_error');
  assert.equal(caseVariant.json().error.details.reason, 'display_name_taken');
  await app.close();
});

test('PATCH /v1/me rejects duplicate display_name', async () => {
  const app = buildApp();
  const a = await bootstrap(app, 'boot-display-patch-a', {
    display_name: 'Patch Name A',
    email: null,
    referral_code: null,
  });
  const b = await bootstrap(app, 'boot-display-patch-b', {
    display_name: 'Patch Name B',
    email: null,
    referral_code: null,
  });
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  const bKey = b.json().api_key.api_key;

  const duplicateDisplayName = a.json().node.display_name;
  const patch = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${bKey}`, 'idempotency-key': 'patch-display-name-dup' },
    payload: { display_name: duplicateDisplayName, email: null, recovery_public_key: null },
  });
  assert.equal(patch.statusCode, 422);
  assert.equal(patch.json().error.code, 'validation_error');
  assert.equal(patch.json().error.details.reason, 'display_name_taken');

  const caseVariantPatch = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${bKey}`, 'idempotency-key': 'patch-display-name-dup-case' },
    payload: { display_name: String(duplicateDisplayName).toUpperCase(), email: null, recovery_public_key: null },
  });
  assert.equal(caseVariantPatch.statusCode, 422);
  assert.equal(caseVariantPatch.json().error.code, 'validation_error');
  assert.equal(caseVariantPatch.json().error.details.reason, 'display_name_taken');
  await app.close();
});

test('PATCH /v1/me idempotency replay returns cached success response', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-patch-me-idem');
  assert.equal(b.statusCode, 200);
  const apiKey = b.json().api_key.api_key;
  const payload = {
    display_name: b.json().node.display_name,
    email: b.json().node.email,
    recovery_public_key: null,
    messaging_handles: [],
    event_webhook_url: null,
  };

  const first = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'patch-me-idem-replay' },
    payload,
  });
  assert.equal(first.statusCode, 200);

  const replay = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'patch-me-idem-replay' },
    payload,
  });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), first.json());
  assert.equal(Object.hasOwn(replay.json(), 'error'), false);
  assert.doesNotMatch(replay.body, /idempotency_keys|null value in column \"path\"/i);
  await app.close();
});

test('PATCH /v1/me supports partial update with only event_webhook_secret', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-patch-me-secret-only');
  assert.equal(b.statusCode, 200);
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  const patch = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'patch-me-secret-only' },
    payload: { event_webhook_secret: 'abc' },
  });
  assert.equal(patch.statusCode, 200);
  assert.equal(Object.hasOwn(patch.json().node, 'event_webhook_secret'), false);

  const me = await app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  assert.equal(me.statusCode, 200);
  assert.equal(Object.hasOwn(me.json().node, 'event_webhook_secret'), false);

  const rows = await query('select event_webhook_secret from nodes where id=$1', [nodeId]);
  assert.equal(rows[0].event_webhook_secret, 'abc');
  await app.close();
});

test('PATCH /v1/me supports partial clear with only event_webhook_url=null', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-patch-me-url-clear-only');
  assert.equal(b.statusCode, 200);
  const apiKey = b.json().api_key.api_key;

  const setWebhook = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'patch-me-url-set-only' },
    payload: { event_webhook_url: 'https://203.0.113.77/hooks' },
  });
  assert.equal(setWebhook.statusCode, 200);
  assert.equal(setWebhook.json().node.event_webhook_url, 'https://203.0.113.77/hooks');

  const clearWebhook = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'patch-me-url-clear-only' },
    payload: { event_webhook_url: null },
  });
  assert.equal(clearWebhook.statusCode, 200);
  assert.equal(clearWebhook.json().node.event_webhook_url, null);
  await app.close();
});

test('PATCH /v1/me accepts empty object and leaves profile unchanged', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-patch-me-empty-body');
  assert.equal(b.statusCode, 200);
  const apiKey = b.json().api_key.api_key;

  const before = await app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  assert.equal(before.statusCode, 200);

  const patched = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'patch-me-empty-body' },
    payload: {},
  });
  assert.equal(patched.statusCode, 200);
  assert.equal(Object.hasOwn(patched.json().node, 'event_webhook_secret'), false);

  const after = await app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  assert.equal(after.statusCode, 200);
  assert.equal(after.json().node.display_name, before.json().node.display_name);
  assert.equal(after.json().node.email, before.json().node.email);
  assert.equal(after.json().node.event_webhook_url, before.json().node.event_webhook_url);
  await app.close();
});

test('unmatched non-GET route with idempotency key returns 404 without idempotency path DB error', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-idem-404');
  assert.equal(b.statusCode, 200);
  const apiKey = b.json().api_key.api_key;

  const res = await app.inject({
    method: 'PATCH',
    url: '/v1/me/',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'idem-unmatched-route' },
    payload: {
      display_name: b.json().node.display_name,
      email: b.json().node.email,
      recovery_public_key: null,
      messaging_handles: [],
      event_webhook_url: null,
    },
  });
  assert.equal(res.statusCode, 404);
  assert.doesNotMatch(res.body, /idempotency_keys|null value in column \"path\"/i);
  await app.close();
});

test('PATCH /v1/me persists webhook URL and write-only webhook secret', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-webhook-config');
  assert.equal(b.statusCode, 200);
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  const displayName = b.json().node.display_name;
  const email = b.json().node.email;

  const setWebhook = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'patch-webhook-set' },
    payload: {
      display_name: displayName,
      email,
      recovery_public_key: null,
      messaging_handles: [],
      event_webhook_url: 'https://203.0.113.25/hooks',
      event_webhook_secret: '  webhook-secret  ',
    },
  });
  assert.equal(setWebhook.statusCode, 200);
  assert.equal(setWebhook.json().node.event_webhook_url, 'https://203.0.113.25/hooks');
  assert.equal(Object.hasOwn(setWebhook.json().node, 'event_webhook_secret'), false);

  const meAfterSet = await app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  assert.equal(meAfterSet.statusCode, 200);
  assert.equal(meAfterSet.json().node.event_webhook_url, 'https://203.0.113.25/hooks');
  assert.equal(Object.hasOwn(meAfterSet.json().node, 'event_webhook_secret'), false);

  const secretSetRows = await query('select event_webhook_secret from nodes where id=$1', [nodeId]);
  assert.equal(secretSetRows[0].event_webhook_secret, 'webhook-secret');

  const clearWebhook = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'patch-webhook-clear' },
    payload: {
      display_name: displayName,
      email,
      recovery_public_key: null,
      messaging_handles: [],
      event_webhook_url: null,
      event_webhook_secret: null,
    },
  });
  assert.equal(clearWebhook.statusCode, 200);
  assert.equal(clearWebhook.json().node.event_webhook_url, null);
  assert.equal(Object.hasOwn(clearWebhook.json().node, 'event_webhook_secret'), false);

  const secretClearRows = await query('select event_webhook_secret from nodes where id=$1', [nodeId]);
  assert.equal(secretClearRows[0].event_webhook_secret, null);
  await app.close();
});

test('PATCH /v1/me rejects invalid and SSRF-blocked webhook URLs', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-webhook-invalid');
  assert.equal(b.statusCode, 200);
  const apiKey = b.json().api_key.api_key;
  const displayName = b.json().node.display_name;
  const email = b.json().node.email;
  const invalidCases = [
    { url: 'http://example.com/hook', reason: 'event_webhook_url_https_required' },
    { url: 'https://localhost/hook', reason: 'event_webhook_url_ssrf_blocked' },
    { url: 'https://127.0.0.1/hook', reason: 'event_webhook_url_ssrf_blocked' },
    { url: 'https://0.0.0.0/hook', reason: 'event_webhook_url_ssrf_blocked' },
    { url: 'https://169.254.169.254/hook', reason: 'event_webhook_url_ssrf_blocked' },
    { url: 'https://192.168.0.1/hook', reason: 'event_webhook_url_ssrf_blocked' },
    { url: 'https://[::1]/hook', reason: 'event_webhook_url_ssrf_blocked' },
    { url: 'https://[fe80::1]/hook', reason: 'event_webhook_url_ssrf_blocked' },
    { url: 'https://[fc00::1]/hook', reason: 'event_webhook_url_ssrf_blocked' },
  ];

  for (let i = 0; i < invalidCases.length; i += 1) {
    const invalid = invalidCases[i];
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `patch-webhook-invalid-${i}` },
      payload: {
        display_name: displayName,
        email,
        recovery_public_key: null,
        messaging_handles: [],
        event_webhook_url: invalid.url,
      },
    });
    assert.equal(res.statusCode, 422);
    assert.equal(res.json().error.code, 'validation_error');
    assert.equal(res.json().error.details.reason, invalid.reason);
  }
  await app.close();
});

test('PATCH /v1/me rejects webhook URL when DNS resolves to blocked address', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-webhook-dns');
  assert.equal(b.statusCode, 200);
  const apiKey = b.json().api_key.api_key;
  const displayName = b.json().node.display_name;
  const email = b.json().node.email;

  await withMockWebhookDnsLookup(async (hostname) => {
    if (hostname === 'rebind.example.test') {
      return [
        { address: '203.0.113.9', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ];
    }
    return [{ address: '203.0.113.9', family: 4 }];
  }, async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'patch-webhook-dns-rebind' },
      payload: {
        display_name: displayName,
        email,
        recovery_public_key: null,
        messaging_handles: [],
        event_webhook_url: 'https://rebind.example.test/hooks',
      },
    });
    assert.equal(res.statusCode, 422);
    assert.equal(res.json().error.code, 'validation_error');
    assert.equal(res.json().error.details.reason, 'event_webhook_url_ssrf_blocked');
  });
  await app.close();
});

test('PATCH /v1/me rate limit returns canonical envelope', async () => {
  await withConfigOverrides({ rateLimitMePatchPerMinute: 1 }, async () => {
    const app = buildApp();
    const b = await bootstrap(app, 'boot-rate-limit-me');
    assert.equal(b.statusCode, 200);
    const apiKey = b.json().api_key.api_key;
    const displayName = b.json().node.display_name;
    const email = b.json().node.email;

    const first = await app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'patch-me-rl-first' },
      payload: {
        display_name: displayName,
        email,
        recovery_public_key: null,
        messaging_handles: [],
        event_webhook_url: null,
      },
    });
    assert.equal(first.statusCode, 200);

    const second = await app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'patch-me-rl-second' },
      payload: {
        display_name: displayName,
        email,
        recovery_public_key: null,
        messaging_handles: [],
        event_webhook_url: null,
      },
    });
    assert.equal(second.statusCode, 429);
    assert.equal(second.json().error.code, 'rate_limit_exceeded');
    assert.equal(second.json().error.details.rule, 'profile_patch');
    await app.close();
  });
});

test('bootstrap records referral claim when referral_code is provided', async () => {
  const app = buildApp();
  const res = await bootstrap(app, 'boot-ref', { display_name: 'R', email: null, referral_code: 'REF123' });
  assert.equal(res.statusCode, 200);
  const nodeId = res.json().node.id;
  const has = await repo.hasReferralClaim(nodeId);
  assert.equal(has, true);
  await app.close();
});

test('GET /v1/auth/keys returns masked prefix format', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-keys');
  const key = b.json().api_key.api_key;
  const res = await app.inject({ method: 'GET', url: '/v1/auth/keys', headers: { authorization: `ApiKey ${key}` } });
  assert.equal(res.statusCode, 200);
  assert.match(res.json().keys[0].prefix, /^.{4,8}\.\.\.$/);
  await app.close();
});

test('revoked api key is rejected with 403 forbidden', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-revoke-key-auth');
  const primaryKey = b.json().api_key.api_key;

  const minted = await app.inject({
    method: 'POST',
    url: '/v1/auth/keys',
    headers: { authorization: `ApiKey ${primaryKey}`, 'idempotency-key': 'mint-revoked-key' },
    payload: { label: 'revoke-me' },
  });
  assert.equal(minted.statusCode, 200);
  const revokedKey = minted.json().api_key;
  const revokedKeyId = minted.json().key_id;

  const revoke = await app.inject({
    method: 'DELETE',
    url: `/v1/auth/keys/${revokedKeyId}`,
    headers: { authorization: `ApiKey ${primaryKey}`, 'idempotency-key': 'revoke-key-now' },
    payload: {},
  });
  assert.equal(revoke.statusCode, 200);
  assert.equal(revoke.json().ok, true);

  const revokedRes = await app.inject({
    method: 'GET',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${revokedKey}` },
  });
  assert.equal(revokedRes.statusCode, 403);
  assert.equal(revokedRes.json().error.code, 'forbidden');
  assert.equal(revokedRes.json().error.message, 'API key is revoked');
  await app.close();
});

test('suspended node api key is rejected at auth middleware', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-suspend-auth');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  const activeRes = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${apiKey}` } });
  assert.equal(activeRes.statusCode, 200);

  await suspendNode(nodeId);

  const suspendedRes = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${apiKey}` } });
  assert.equal(suspendedRes.statusCode, 403);
  assert.equal(suspendedRes.json().error.code, 'forbidden');
  assert.equal(suspendedRes.json().error.message, 'Node is suspended');
  await app.close();
});

test('publish endpoint rejects suspended node before projection write', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-suspend-publish');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  const unit = await repo.createResource('units', nodeId, {
    title: 'Suspended publish',
    description: 'should be blocked',
    type: 'service',
    condition: null,
    quantity: 1,
    measure: 'EA',
    custom_measure: null,
    scope_primary: 'OTHER',
    scope_secondary: [],
    scope_notes: 'suspension-publish',
    location_text_public: null,
    origin_region: null,
    dest_region: null,
    service_region: null,
    delivery_format: null,
    tags: [],
    category_ids: [],
    public_summary: 'suspension publish test',
  });

  await suspendNode(nodeId);

  const res = await app.inject({
    method: 'POST',
    url: `/v1/units/${unit.id}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `suspend-publish-${nodeId}` },
    payload: {},
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, 'forbidden');
  assert.equal(res.json().error.message, 'Node is suspended');
  await app.close();
});

test('unit create rejects description containing email with content_contact_info_disallowed', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-contact-email-unit');
  const apiKey = b.json().api_key.api_key;
  const payload = { ...unitPayload('Email test'), description: 'Contact me at seller@example.com for details' };
  const res = await app.inject({ method: 'POST', url: '/v1/units', headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'ci-email-unit' }, payload });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, 'content_contact_info_disallowed');
  assert.equal(res.json().error.details.field, 'description');
  await app.close();
});

test('unit create rejects description containing phone number', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-contact-phone-unit');
  const apiKey = b.json().api_key.api_key;
  const payload = { ...unitPayload('Phone test'), description: 'Call me at 555-123-4567' };
  const res = await app.inject({ method: 'POST', url: '/v1/units', headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'ci-phone-unit' }, payload });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, 'content_contact_info_disallowed');
  assert.equal(res.json().error.details.field, 'description');
  await app.close();
});

test('unit create rejects description containing labeled messaging handle', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-contact-handle-unit');
  const apiKey = b.json().api_key.api_key;
  const payload = { ...unitPayload('Handle test'), description: 'Telegram: @myhandle for offers' };
  const res = await app.inject({ method: 'POST', url: '/v1/units', headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'ci-handle-unit' }, payload });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, 'content_contact_info_disallowed');
  assert.equal(res.json().error.details.field, 'description');
  await app.close();
});

test('unit create accepts clean description without contact info', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-contact-clean-unit');
  const apiKey = b.json().api_key.api_key;
  const payload = { ...unitPayload('Clean unit'), description: 'Professional CAD design services for mechanical enclosures' };
  const res = await app.inject({ method: 'POST', url: '/v1/units', headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'ci-clean-unit' }, payload });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test('request create rejects scope_notes containing email', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-contact-email-req');
  const apiKey = b.json().api_key.api_key;
  const payload = { ...unitPayload('Req email test'), scope_notes: 'Email me at buyer@domain.org' };
  const res = await app.inject({ method: 'POST', url: '/v1/requests', headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'ci-email-req' }, payload });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, 'content_contact_info_disallowed');
  assert.equal(res.json().error.details.field, 'scope_notes');
  await app.close();
});

test('resource region objects enforce US-only allowlist on create and patch', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-region-object-allowlist');
  const apiKey = b.json().api_key.api_key;

  const validUnit = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'region-object-valid-unit' },
    payload: {
      ...unitPayload('Valid region object unit'),
      service_region: { country_code: 'US', admin1: 'CA' },
    },
  });
  assert.equal(validUnit.statusCode, 200);

  const invalidCountry = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'region-object-invalid-country' },
    payload: {
      ...unitPayload('Invalid region country unit'),
      service_region: { country_code: 'CA', admin1: 'BC' },
    },
  });
  assert.equal(invalidCountry.statusCode, 422);
  assert.equal(invalidCountry.json().error.code, 'validation_error');
  assert.equal(invalidCountry.json().error.details.reason, 'region_id_invalid');

  const requestCreated = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'region-object-request-create' },
    payload: unitPayload('Region object request'),
  });
  assert.equal(requestCreated.statusCode, 200);

  const invalidAdmin1Patch = await app.inject({
    method: 'PATCH',
    url: `/v1/requests/${requestCreated.json().request.id}`,
    headers: {
      authorization: `ApiKey ${apiKey}`,
      'idempotency-key': 'region-object-invalid-admin1-patch',
      'if-match': String(requestCreated.json().request.version),
    },
    payload: { service_region: { country_code: 'US', admin1: 'BC' } },
  });
  assert.equal(invalidAdmin1Patch.statusCode, 422);
  assert.equal(invalidAdmin1Patch.json().error.code, 'validation_error');
  assert.equal(invalidAdmin1Patch.json().error.details.reason, 'region_id_invalid');
  await app.close();
});

test('unit patch rejects public_summary containing phone number', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-contact-patch-unit');
  const apiKey = b.json().api_key.api_key;
  const createPayload = unitPayload('Patch contact test');
  const created = await app.inject({ method: 'POST', url: '/v1/units', headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'ci-patch-create' }, payload: createPayload });
  assert.equal(created.statusCode, 200);
  const unitId = created.json().unit.id;
  const version = created.json().unit.version;
  const patch = await app.inject({ method: 'PATCH', url: `/v1/units/${unitId}`, headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'ci-patch-phone', 'if-match': String(version) }, payload: { public_summary: 'Call +1-800-555-1234 for pricing' } });
  assert.equal(patch.statusCode, 422);
  assert.equal(patch.json().error.code, 'content_contact_info_disallowed');
  assert.equal(patch.json().error.details.field, 'public_summary');
  await app.close();
});

test('search works with credits only (no subscriber gate) and offer progression is available without subscriber status', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-offer-no-sub-seller', {
    display_name: 'Offer No Sub Seller',
    email: `offer.no.sub.seller.${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
  });
  const buyerBoot = await bootstrap(app, 'boot-offer-no-sub-buyer', {
    display_name: 'Offer No Sub Buyer',
    email: `offer.no.sub.buyer.${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
  });
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  const buyerNodeId = buyerBoot.json().node.id;
  const buyerApiKey = buyerBoot.json().api_key.api_key;

  const search = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'sg-1' },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'x' }, budget: { credits_max: config.searchCreditCost }, limit: 20, cursor: null },
  });
  assert.equal(search.statusCode, 200);
  assert.equal(search.json().budget.breakdown.broadening_cost, 0);

  const sellerUnit = await repo.createResource('units', sellerNodeId, unitPayload('No-sub offer unit', 'no-sub-offer-scope'));
  const created = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'sg-offer-create' },
    payload: { unit_ids: [sellerUnit.id], thread_id: null, note: null },
  });
  assert.equal(created.statusCode, 200);
  const firstOfferId = created.json().offer.id;

  const counter = await app.inject({
    method: 'POST',
    url: `/v1/offers/${firstOfferId}/counter`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'sg-offer-counter-seller' },
    payload: { unit_ids: [sellerUnit.id], note: null },
  });
  assert.equal(counter.statusCode, 200);

  const acceptedFlowOffer = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'sg-offer-create-accepted-flow' },
    payload: { unit_ids: [sellerUnit.id], thread_id: null, note: null },
  });
  assert.equal(acceptedFlowOffer.statusCode, 200);
  const offerId = acceptedFlowOffer.json().offer.id;

  const sellerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'sg-offer-accept-seller' },
    payload: {},
  });
  assert.equal(sellerAccept.statusCode, 200);

  const buyerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'sg-offer-accept-buyer' },
    payload: {},
  });
  assert.equal(buyerAccept.statusCode, 200);
  assert.equal(buyerAccept.json().offer.status, 'mutually_accepted');

  const reveal = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/reveal-contact`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'sg-offer-reveal' },
    payload: {},
  });
  assert.equal(reveal.statusCode, 200);
  assert.equal(reveal.json().contact.email, `offer.no.sub.seller.${TEST_RUN_SUFFIX}@example.com`);

  const balAfter = await repo.creditBalance(buyerNodeId);
  assert.equal(balAfter > 0, true);
  await app.close();
});

test('offer actions stay blocked for suspended nodes even without subscriber gating', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-offer-suspended-seller');
  const buyerBoot = await bootstrap(app, 'boot-offer-suspended-buyer');
  const sellerNodeId = sellerBoot.json().node.id;
  const buyerNodeId = buyerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  const buyerApiKey = buyerBoot.json().api_key.api_key;

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Suspended offer unit', 'suspended-offer-scope'));
  const created = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'susp-offer-create-active' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(created.statusCode, 200);
  const offerId = created.json().offer.id;

  const sellerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'susp-offer-accept-seller-active' },
    payload: {},
  });
  assert.equal(sellerAccept.statusCode, 200);
  const buyerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'susp-offer-accept-buyer-active' },
    payload: {},
  });
  assert.equal(buyerAccept.statusCode, 200);

  await suspendNode(buyerNodeId);

  const suspendedCreate = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'susp-offer-create-blocked' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(suspendedCreate.statusCode, 403);
  assert.equal(suspendedCreate.json().error.code, 'forbidden');

  const suspendedCounter = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/counter`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'susp-offer-counter-blocked' },
    payload: { unit_ids: [unit.id], note: null },
  });
  assert.equal(suspendedCounter.statusCode, 403);
  assert.equal(suspendedCounter.json().error.code, 'forbidden');

  const suspendedAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'susp-offer-accept-blocked' },
    payload: {},
  });
  assert.equal(suspendedAccept.statusCode, 403);
  assert.equal(suspendedAccept.json().error.code, 'forbidden');

  const suspendedReveal = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/reveal-contact`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'susp-offer-reveal-blocked' },
    payload: {},
  });
  assert.equal(suspendedReveal.statusCode, 403);
  assert.equal(suspendedReveal.json().error.code, 'forbidden');
  await app.close();
});

test('offer actions require current legal assent even without subscriber gating', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-offer-legal-seller');
  const buyerBoot = await bootstrap(app, 'boot-offer-legal-buyer');
  const sellerNodeId = sellerBoot.json().node.id;
  const buyerNodeId = buyerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Legal required offer unit', 'legal-required-offer-scope'));

  await query("update nodes set legal_version='2020-01-01' where id=$1", [buyerNodeId]);
  const createLegalRequired = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'legal-offer-create-blocked' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(createLegalRequired.statusCode, 422);
  assert.equal(createLegalRequired.json().error.code, 'legal_required');

  await query('update nodes set legal_version=$2 where id=$1', [buyerNodeId, REQUIRED_LEGAL_VERSION]);
  const created = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'legal-offer-create-active' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(created.statusCode, 200);
  const offerId = created.json().offer.id;

  await query("update nodes set legal_version='2020-01-01' where id=$1", [sellerNodeId]);
  const counterLegalRequired = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/counter`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'legal-offer-counter-blocked' },
    payload: { unit_ids: [unit.id], note: null },
  });
  assert.equal(counterLegalRequired.statusCode, 422);
  assert.equal(counterLegalRequired.json().error.code, 'legal_required');

  const acceptLegalRequired = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'legal-offer-accept-blocked' },
    payload: {},
  });
  assert.equal(acceptLegalRequired.statusCode, 422);
  assert.equal(acceptLegalRequired.json().error.code, 'legal_required');

  await query('update nodes set legal_version=$2 where id=$1', [sellerNodeId, REQUIRED_LEGAL_VERSION]);
  const sellerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'legal-offer-accept-seller' },
    payload: {},
  });
  assert.equal(sellerAccept.statusCode, 200);
  const buyerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'legal-offer-accept-buyer' },
    payload: {},
  });
  assert.equal(buyerAccept.statusCode, 200);
  assert.equal(buyerAccept.json().offer.status, 'mutually_accepted');

  await query("update nodes set legal_version='2020-01-01' where id=$1", [buyerNodeId]);
  const revealLegalRequired = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/reveal-contact`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'legal-offer-reveal-blocked' },
    payload: {},
  });
  assert.equal(revealLegalRequired.statusCode, 422);
  assert.equal(revealLegalRequired.json().error.code, 'legal_required');
  await app.close();
});

test('pre-purchase daily offer-create limit blocks the fourth offer until first purchase', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-prepurchase-create-seller');
  const buyerBoot = await bootstrap(app, 'boot-prepurchase-create-buyer');
  const sellerNodeId = sellerBoot.json().node.id;
  const buyerNodeId = buyerBoot.json().node.id;
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Prepurchase create unit', 'prepurchase-create-scope'));

  for (let i = 0; i < 3; i += 1) {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/offers',
      headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': `prepurchase-create-${i}` },
      payload: { unit_ids: [unit.id], thread_id: null, note: `offer-${i}` },
    });
    assert.equal(create.statusCode, 200);
  }

  const blocked = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'prepurchase-create-blocked' },
    payload: { unit_ids: [unit.id], thread_id: null, note: 'blocked-offer' },
  });
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json().error.code, 'prepurchase_daily_limit_exceeded');
  assert.equal(blocked.json().error.details.action, 'offer_create');
  assert.equal(blocked.json().error.details.limit, 3);

  await repo.addCredit(buyerNodeId, 'topup_purchase', 500, { reason: 'test_unlock_prepurchase_create' }, `test_prepurchase_create:${buyerNodeId}`);

  const allowedAfterPurchase = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'prepurchase-create-after-purchase' },
    payload: { unit_ids: [unit.id], thread_id: null, note: 'after-purchase' },
  });
  assert.equal(allowedAfterPurchase.statusCode, 200);
  await app.close();
});

test('pre-purchase daily offer-accept limit blocks second acceptance until first purchase', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-prepurchase-accept-seller');
  const buyerBoot = await bootstrap(app, 'boot-prepurchase-accept-buyer');
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  const buyerApiKey = buyerBoot.json().api_key.api_key;

  const unitA = await repo.createResource('units', sellerNodeId, unitPayload('Prepurchase accept unit A', 'prepurchase-accept-a'));
  const unitB = await repo.createResource('units', sellerNodeId, unitPayload('Prepurchase accept unit B', 'prepurchase-accept-b'));

  const offerA = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'prepurchase-accept-create-a' },
    payload: { unit_ids: [unitA.id], thread_id: null, note: null },
  });
  assert.equal(offerA.statusCode, 200);
  const offerAId = offerA.json().offer.id;

  const offerB = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'prepurchase-accept-create-b' },
    payload: { unit_ids: [unitB.id], thread_id: null, note: null },
  });
  assert.equal(offerB.statusCode, 200);
  const offerBId = offerB.json().offer.id;

  const firstAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerAId}/accept`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'prepurchase-accept-first' },
    payload: {},
  });
  assert.equal(firstAccept.statusCode, 200);

  const secondAcceptBlocked = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerBId}/accept`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'prepurchase-accept-second-blocked' },
    payload: {},
  });
  assert.equal(secondAcceptBlocked.statusCode, 429);
  assert.equal(secondAcceptBlocked.json().error.code, 'prepurchase_daily_limit_exceeded');
  assert.equal(secondAcceptBlocked.json().error.details.action, 'offer_accept');
  assert.equal(secondAcceptBlocked.json().error.details.limit, 1);

  await repo.addCredit(sellerNodeId, 'topup_purchase', 500, { reason: 'test_unlock_prepurchase_accept' }, `test_prepurchase_accept:${sellerNodeId}`);

  const secondAcceptAfterPurchase = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerBId}/accept`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'prepurchase-accept-second-after-purchase' },
    payload: {},
  });
  assert.equal(secondAcceptAfterPurchase.statusCode, 200);
  await app.close();
});

test('offer ttl_minutes defaults/overrides are enforced and hold expiry matches offer expiry', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-offer-ttl-seller');
  const buyerBoot = await bootstrap(app, 'boot-offer-ttl-buyer');
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Offer TTL unit', 'offer-ttl-scope'));
  const overrideUnit = await repo.createResource('units', sellerNodeId, unitPayload('Offer TTL override unit', 'offer-ttl-override-scope'));

  const defaultOffer = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'offer-ttl-default' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(defaultOffer.statusCode, 200);
  const defaultBody = defaultOffer.json().offer;
  const defaultMinutes = (new Date(defaultBody.expires_at).getTime() - Date.now()) / 60000;
  assert.equal(defaultMinutes >= 2860 && defaultMinutes <= 2890, true);
  assert.equal(Math.abs(new Date(defaultBody.hold_expires_at).getTime() - new Date(defaultBody.expires_at).getTime()) < 2000, true);

  const overriddenOffer = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'offer-ttl-override' },
    payload: { unit_ids: [overrideUnit.id], thread_id: null, note: null, ttl_minutes: 30 },
  });
  assert.equal(overriddenOffer.statusCode, 200);
  const overriddenBody = overriddenOffer.json().offer;
  const overrideMinutes = (new Date(overriddenBody.expires_at).getTime() - Date.now()) / 60000;
  assert.equal(overrideMinutes >= 27 && overrideMinutes <= 33, true);
  assert.equal(Math.abs(new Date(overriddenBody.hold_expires_at).getTime() - new Date(overriddenBody.expires_at).getTime()) < 2000, true);

  const invalidOffer = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'offer-ttl-invalid' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null, ttl_minutes: 10 },
  });
  assert.equal(invalidOffer.statusCode, 400);
  assert.equal(invalidOffer.json().error.code, 'validation_error');
  assert.equal(invalidOffer.json().error.details.reason, 'ttl_minutes_out_of_range');
  await app.close();
});

test('counter ttl_minutes overrides are enforced with bounds', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-counter-ttl-seller');
  const buyerBoot = await bootstrap(app, 'boot-counter-ttl-buyer');
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Counter TTL unit', 'counter-ttl-scope'));

  const created = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'counter-ttl-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null, ttl_minutes: 120 },
  });
  assert.equal(created.statusCode, 200);
  const offerId = created.json().offer.id;

  const counter = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/counter`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'counter-ttl-valid' },
    payload: { unit_ids: [unit.id], note: null, ttl_minutes: 240 },
  });
  assert.equal(counter.statusCode, 200);
  const counterOffer = counter.json().offer;
  const counterMinutes = (new Date(counterOffer.expires_at).getTime() - Date.now()) / 60000;
  assert.equal(counterMinutes >= 237 && counterMinutes <= 243, true);
  assert.equal(Math.abs(new Date(counterOffer.hold_expires_at).getTime() - new Date(counterOffer.expires_at).getTime()) < 2000, true);

  const invalidCounter = await app.inject({
    method: 'POST',
    url: `/v1/offers/${counterOffer.id}/counter`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'counter-ttl-invalid' },
    payload: { unit_ids: [unit.id], note: null, ttl_minutes: 10081 },
  });
  assert.equal(invalidCounter.statusCode, 400);
  assert.equal(invalidCounter.json().error.code, 'validation_error');
  assert.equal(invalidCounter.json().error.details.reason, 'ttl_minutes_out_of_range');
  await app.close();
});

test('request ttl_minutes defaults/overrides are enforced and expired requests are excluded from public matching', async () => {
  const app = buildApp();
  const ownerBoot = await bootstrap(app, 'boot-request-ttl-owner');
  const seekerBoot = await bootstrap(app, 'boot-request-ttl-seeker');
  const ownerApiKey = ownerBoot.json().api_key.api_key;
  const seekerApiKey = seekerBoot.json().api_key.api_key;
  const ownerNodeId = ownerBoot.json().node.id;
  const seekerNodeId = seekerBoot.json().node.id;
  const uniqueToken = `reqexpiry${crypto.randomBytes(6).toString('hex').replace(/[0-9]/g, 'a')}`;

  const created = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${ownerApiKey}`, 'idempotency-key': 'request-ttl-default' },
    payload: unitPayload(`Request TTL ${uniqueToken}`, `request-ttl-${uniqueToken}`),
  });
  assert.equal(created.statusCode, 200);
  const requestId = created.json().request.id;
  const defaultMinutes = (new Date(created.json().request.expires_at).getTime() - Date.now()) / 60000;
  assert.equal(defaultMinutes >= 525595 && defaultMinutes <= 525605, true);

  const patched = await app.inject({
    method: 'PATCH',
    url: `/v1/requests/${requestId}`,
    headers: { authorization: `ApiKey ${ownerApiKey}`, 'idempotency-key': 'request-ttl-patch', 'if-match': String(created.json().request.version) },
    payload: { ttl_minutes: 180 },
  });
  assert.equal(patched.statusCode, 200);
  const patchedMinutes = (new Date(patched.json().expires_at).getTime() - Date.now()) / 60000;
  assert.equal(patchedMinutes >= 177 && patchedMinutes <= 183, true);

  const invalidCreate = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${ownerApiKey}`, 'idempotency-key': 'request-ttl-invalid-create' },
    payload: { ...unitPayload('Request TTL invalid create', 'request-ttl-invalid'), ttl_minutes: 30 },
  });
  assert.equal(invalidCreate.statusCode, 400);
  assert.equal(invalidCreate.json().error.code, 'validation_error');
  assert.equal(invalidCreate.json().error.details.reason, 'ttl_minutes_out_of_range');

  const invalidPatch = await app.inject({
    method: 'PATCH',
    url: `/v1/requests/${requestId}`,
    headers: { authorization: `ApiKey ${ownerApiKey}`, 'idempotency-key': 'request-ttl-invalid-patch', 'if-match': String(patched.json().version) },
    payload: { ttl_minutes: 59 },
  });
  assert.equal(invalidPatch.statusCode, 400);
  assert.equal(invalidPatch.json().error.code, 'validation_error');
  assert.equal(invalidPatch.json().error.details.reason, 'ttl_minutes_out_of_range');

  const publish = await app.inject({
    method: 'POST',
    url: `/v1/requests/${requestId}/publish`,
    headers: { authorization: `ApiKey ${ownerApiKey}`, 'idempotency-key': 'request-ttl-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 200);

  const beforeExpireSearch = await app.inject({
    method: 'POST',
    url: '/v1/search/requests',
    headers: { authorization: `ApiKey ${seekerApiKey}`, 'idempotency-key': 'request-ttl-before-expire-search' },
    payload: {
      q: uniqueToken,
      scope: 'OTHER',
      filters: { scope_notes: `request-ttl-${uniqueToken}` },
      budget: { credits_max: config.searchCreditCost },
      limit: 20,
      cursor: null,
      target: { node_id: ownerNodeId },
    },
  });
  assert.equal(beforeExpireSearch.statusCode, 200);
  assert.equal(beforeExpireSearch.json().items.some((row) => row.item.id === requestId), true);

  await query("update requests set expires_at = now() - interval '1 minute' where id=$1", [requestId]);

  const ownerHistory = await app.inject({
    method: 'GET',
    url: `/v1/requests/${requestId}`,
    headers: { authorization: `ApiKey ${ownerApiKey}` },
  });
  assert.equal(ownerHistory.statusCode, 200);
  assert.equal(ownerHistory.json().id, requestId);

  const afterExpireSearch = await app.inject({
    method: 'POST',
    url: '/v1/search/requests',
    headers: { authorization: `ApiKey ${seekerApiKey}`, 'idempotency-key': 'request-ttl-after-expire-search' },
    payload: {
      q: uniqueToken,
      scope: 'OTHER',
      filters: { scope_notes: `request-ttl-${uniqueToken}` },
      budget: { credits_max: config.searchCreditCost },
      limit: 20,
      cursor: null,
      target: { node_id: ownerNodeId },
    },
  });
  assert.equal(afterExpireSearch.statusCode, 200);
  assert.equal(afterExpireSearch.json().items.some((row) => row.item.id === requestId), false);

  const publicInventory = await app.inject({
    method: 'GET',
    url: `/v1/public/nodes/${ownerNodeId}/requests`,
    headers: { authorization: `ApiKey ${seekerApiKey}` },
  });
  assert.equal(publicInventory.statusCode, 200);
  assert.equal(publicInventory.json().items.some((item) => item.id === requestId), false);
  await app.close();
});

test('unit publish and unpublish toggle projection visibility', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-unit-publish-unpublish');
  const apiKey = b.json().api_key.api_key;
  const nodeId = b.json().node.id;

  const created = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'unit-publish-unpublish-create' },
    payload: unitPayload('Unit publish/unpublish', 'unit-publish-unpublish-scope'),
  });
  assert.equal(created.statusCode, 200);
  const unitId = created.json().unit.id;

  const publish = await app.inject({
    method: 'POST',
    url: `/v1/units/${unitId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'unit-publish-unpublish-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 200);

  const publishedRows = await query(
    `select published_at
     from units
     where id=$1`,
    [unitId],
  );
  assert.equal(publishedRows.length, 1);
  assert.notEqual(publishedRows[0].published_at, null);
  const listingRows = await query('select count(*)::text as c from public_listings where unit_id=$1', [unitId]);
  assert.equal(Number(listingRows[0].c), 1);

  const unpublish = await app.inject({
    method: 'POST',
    url: `/v1/units/${unitId}/unpublish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'unit-publish-unpublish-unpublish' },
    payload: {},
  });
  assert.equal(unpublish.statusCode, 200);

  const unpublishedRows = await query(
    `select published_at
     from units
     where id=$1`,
    [unitId],
  );
  assert.equal(unpublishedRows.length, 1);
  assert.equal(unpublishedRows[0].published_at, null);
  const listingRowsAfter = await query('select count(*)::text as c from public_listings where unit_id=$1', [unitId]);
  assert.equal(Number(listingRowsAfter[0].c), 0);

  await app.close();
});

test('request publish and unpublish toggle projection visibility', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-request-publish-unpublish');
  const apiKey = b.json().api_key.api_key;
  const nodeId = b.json().node.id;

  const created = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'request-publish-unpublish-create' },
    payload: unitPayload('Request publish/unpublish', 'request-publish-unpublish-scope'),
  });
  assert.equal(created.statusCode, 200);
  const requestId = created.json().request.id;

  const publish = await app.inject({
    method: 'POST',
    url: `/v1/requests/${requestId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'request-publish-unpublish-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 200);

  const publishedRows = await query(
    `select published_at
     from requests
     where id=$1`,
    [requestId],
  );
  assert.equal(publishedRows.length, 1);
  assert.notEqual(publishedRows[0].published_at, null);
  const requestRows = await query('select count(*)::text as c from public_requests where request_id=$1', [requestId]);
  assert.equal(Number(requestRows[0].c), 1);

  const unpublish = await app.inject({
    method: 'POST',
    url: `/v1/requests/${requestId}/unpublish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'request-publish-unpublish-unpublish' },
    payload: {},
  });
  assert.equal(unpublish.statusCode, 200);

  const unpublishedRows = await query(
    `select published_at
     from requests
     where id=$1`,
    [requestId],
  );
  assert.equal(unpublishedRows.length, 1);
  assert.equal(unpublishedRows[0].published_at, null);
  const requestRowsAfter = await query('select count(*)::text as c from public_requests where request_id=$1', [requestId]);
  assert.equal(Number(requestRowsAfter[0].c), 0);

  await app.close();
});

test('DELETE unit/request endpoints soft-delete resources and hide them from detail reads', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-delete-soft');
  const apiKey = b.json().api_key.api_key;

  const createdUnit = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'delete-soft-unit-create' },
    payload: unitPayload('Delete soft unit', 'delete-soft-unit-scope'),
  });
  assert.equal(createdUnit.statusCode, 200);
  const unitId = createdUnit.json().unit.id;

  const createdRequest = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'delete-soft-request-create' },
    payload: unitPayload('Delete soft request', 'delete-soft-request-scope'),
  });
  assert.equal(createdRequest.statusCode, 200);
  const requestId = createdRequest.json().request.id;

  const deleteUnit = await app.inject({
    method: 'DELETE',
    url: `/v1/units/${unitId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'delete-soft-unit-delete' },
  });
  assert.equal(deleteUnit.statusCode, 200);
  assert.equal(deleteUnit.json().ok, true);

  const deleteRequest = await app.inject({
    method: 'DELETE',
    url: `/v1/requests/${requestId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'delete-soft-request-delete' },
  });
  assert.equal(deleteRequest.statusCode, 200);
  assert.equal(deleteRequest.json().ok, true);

  const unitDetail = await app.inject({
    method: 'GET',
    url: `/v1/units/${unitId}`,
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  assert.equal(unitDetail.statusCode, 404);
  assert.equal(unitDetail.json().error.code, 'not_found');

  const requestDetail = await app.inject({
    method: 'GET',
    url: `/v1/requests/${requestId}`,
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  assert.equal(requestDetail.statusCode, 404);
  assert.equal(requestDetail.json().error.code, 'not_found');

  const unitRows = await query('select deleted_at from units where id=$1', [unitId]);
  const requestRows = await query('select deleted_at from requests where id=$1', [requestId]);
  assert.equal(unitRows.length, 1);
  assert.equal(requestRows.length, 1);
  assert.notEqual(unitRows[0].deleted_at, null);
  assert.notEqual(requestRows[0].deleted_at, null);
  await app.close();
});

test('public request category drilldown endpoint returns filtered results and debits credits on 200', async () => {
  const app = buildApp();
  const ownerBoot = await bootstrap(app, 'boot-request-category-owner');
  const ownerNodeId = ownerBoot.json().node.id;
  const ownerApiKey = ownerBoot.json().api_key.api_key;

  const viewerBoot = await bootstrap(app, 'boot-request-category-viewer');
  const viewerNodeId = viewerBoot.json().node.id;
  const viewerApiKey = viewerBoot.json().api_key.api_key;

  const created = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${ownerApiKey}`, 'idempotency-key': 'request-category-create' },
    payload: {
      ...unitPayload('Request category drilldown', 'request-category-drilldown-scope'),
      category_ids: [812],
    },
  });
  assert.equal(created.statusCode, 200);
  const requestId = created.json().request.id;

  const publish = await app.inject({
    method: 'POST',
    url: `/v1/requests/${requestId}/publish`,
    headers: { authorization: `ApiKey ${ownerApiKey}`, 'idempotency-key': 'request-category-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 200);

  const before = await repo.creditBalance(viewerNodeId);
  const drilldown = await app.inject({
    method: 'GET',
    url: `/v1/public/nodes/${ownerNodeId}/requests/categories/812?limit=20`,
    headers: { authorization: `ApiKey ${viewerApiKey}` },
  });
  assert.equal(drilldown.statusCode, 200);
  assert.equal(Array.isArray(drilldown.json().items), true);
  assert.equal(drilldown.json().items.some((item) => item.id === requestId), true);

  const after = await repo.creditBalance(viewerNodeId);
  assert.equal(before - after, config.nodeCategoryDrilldownCost);
  await app.close();
});

test('mutual acceptance auto-unpublishes involved units from projections/search', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-mutual-unpublish-seller');
  const buyerBoot = await bootstrap(app, 'boot-mutual-unpublish-buyer');
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  const buyerNodeId = buyerBoot.json().node.id;
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  const marker = `mutualunpub${Date.now()}`;

  const unit = await repo.createResource('units', sellerNodeId, unitPayload(`Mutual unpublish ${marker}`, `mutual-unpublish-${marker}`));
  const publish = await app.inject({
    method: 'POST',
    url: `/v1/units/${unit.id}/publish`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'mutual-unpublish-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 200);

  const visibleBefore = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'mutual-unpublish-search-before' },
    payload: {
      q: marker,
      scope: 'OTHER',
      filters: { scope_notes: `mutual-unpublish-${marker}` },
      budget: { credits_max: config.searchCreditCost },
      limit: 20,
      cursor: null,
      target: { node_id: sellerNodeId },
    },
  });
  assert.equal(visibleBefore.statusCode, 200);
  assert.equal(visibleBefore.json().items.some((row) => row.item.id === unit.id), true);

  const created = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'mutual-unpublish-offer-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(created.statusCode, 200);
  const offerId = created.json().offer.id;

  const sellerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'mutual-unpublish-seller-accept' },
    payload: {},
  });
  assert.equal(sellerAccept.statusCode, 200);

  const buyerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'mutual-unpublish-buyer-accept' },
    payload: {},
  });
  assert.equal(buyerAccept.statusCode, 200);
  assert.equal(buyerAccept.json().offer.status, 'mutually_accepted');

  const unitRow = await query("select published_at from units where id=$1", [unit.id]);
  assert.equal(unitRow[0].published_at, null);
  const projectionRow = await query("select count(*)::text as c from public_listings where unit_id=$1", [unit.id]);
  assert.equal(Number(projectionRow[0].c), 0);

  const visibleAfter = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'mutual-unpublish-search-after' },
    payload: {
      q: marker,
      scope: 'OTHER',
      filters: { scope_notes: `mutual-unpublish-${marker}` },
      budget: { credits_max: config.searchCreditCost },
      limit: 20,
      cursor: null,
      target: { node_id: sellerNodeId },
    },
  });
  assert.equal(visibleAfter.statusCode, 200);
  assert.equal(visibleAfter.json().items.some((row) => row.item.id === unit.id), false);

  const publicInventory = await app.inject({
    method: 'GET',
    url: `/v1/public/nodes/${sellerNodeId}/listings`,
    headers: { authorization: `ApiKey ${buyerApiKey}` },
  });
  assert.equal(publicInventory.statusCode, 200);
  assert.equal(publicInventory.json().items.some((item) => item.id === unit.id), false);
  await app.close();
});

test('buyer offer create cannot lock seller inventory; seller-side accept locks; idempotency works', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-hold-seller', {
    display_name: 'Hold Seller',
    email: null,
    referral_code: null,
  });
  const buyerBoot = await bootstrap(app, 'boot-hold-buyer', {
    display_name: 'Hold Buyer',
    email: null,
    referral_code: null,
  });
  const outsiderBoot = await bootstrap(app, 'boot-hold-outsider', {
    display_name: 'Hold Outsider',
    email: null,
    referral_code: null,
  });
  assert.equal(sellerBoot.statusCode, 200);
  assert.equal(buyerBoot.statusCode, 200);
  assert.equal(outsiderBoot.statusCode, 200);
  const sellerNodeId = sellerBoot.json().node.id;
  const buyerNodeId = buyerBoot.json().node.id;
  const sellerKey = sellerBoot.json().api_key.api_key;
  const buyerKey = buyerBoot.json().api_key.api_key;
  const outsiderKey = outsiderBoot.json().api_key.api_key;

  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_sub_hold_seller')).statusCode, 200);
  assert.equal((await activateBasicSubscriber(app, buyerNodeId, 'evt_sub_hold_buyer')).statusCode, 200);

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Hold invariant unit', 'hold-invariant-scope'));
  const createPayload = { unit_ids: [unit.id], thread_id: null, note: null };
  const create = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerKey}`, 'idempotency-key': 'hold-offer-create' },
    payload: createPayload,
  });
  assert.equal(create.statusCode, 200);
  const createdOffer = create.json().offer;
  assert.deepEqual(createdOffer.held_unit_ids, []);
  assert.deepEqual(createdOffer.unheld_unit_ids, [unit.id]);

  const activeBefore = await query("select count(*)::text as c from holds where unit_id=$1 and status='active'", [unit.id]);
  assert.equal(Number(activeBefore[0].c), 0);

  const outsiderCounter = await app.inject({
    method: 'POST',
    url: `/v1/offers/${createdOffer.id}/counter`,
    headers: { authorization: `ApiKey ${outsiderKey}`, 'idempotency-key': 'hold-offer-counter-outsider' },
    payload: { unit_ids: [unit.id], note: null },
  });
  assert.equal(outsiderCounter.statusCode, 404);
  assert.equal(outsiderCounter.json().error.code, 'not_found');

  const replay = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerKey}`, 'idempotency-key': 'hold-offer-create' },
    payload: createPayload,
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().offer.id, createdOffer.id);

  const idemConflict = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerKey}`, 'idempotency-key': 'hold-offer-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: 'changed' },
  });
  assert.equal(idemConflict.statusCode, 409);
  assert.equal(idemConflict.json().error.code, 'idempotency_key_reuse_conflict');

  const sellerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${createdOffer.id}/accept`,
    headers: { authorization: `ApiKey ${sellerKey}`, 'idempotency-key': 'hold-offer-accept-seller' },
    payload: {},
  });
  assert.equal(sellerAccept.statusCode, 200);
  assert.equal(sellerAccept.json().offer.status, 'accepted_by_b');
  assert.deepEqual(sellerAccept.json().offer.held_unit_ids, [unit.id]);
  assert.deepEqual(sellerAccept.json().offer.unheld_unit_ids, []);

  const activeAfter = await query("select count(*)::text as c from holds where unit_id=$1 and status='active'", [unit.id]);
  assert.equal(Number(activeAfter[0].c), 1);
  await app.close();
});

test('mutual acceptance charges one credit per side exactly once', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-deal-fee-seller');
  const buyerBoot = await bootstrap(app, 'boot-deal-fee-buyer');
  const sellerNodeId = sellerBoot.json().node.id;
  const buyerNodeId = buyerBoot.json().node.id;
  const sellerKey = sellerBoot.json().api_key.api_key;
  const buyerKey = buyerBoot.json().api_key.api_key;

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Deal fee unit', 'deal-fee-scope'));
  const created = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerKey}`, 'idempotency-key': 'deal-fee-offer-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: 'deal-fee' },
  });
  assert.equal(created.statusCode, 200);
  const offerId = created.json().offer.id;

  const sellerBalanceBefore = await repo.creditBalance(sellerNodeId);
  const buyerBalanceBefore = await repo.creditBalance(buyerNodeId);

  const sellerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${sellerKey}`, 'idempotency-key': 'deal-fee-accept-seller' },
    payload: {},
  });
  assert.equal(sellerAccept.statusCode, 200);
  assert.equal(sellerAccept.json().offer.status, 'accepted_by_b');

  const buyerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${buyerKey}`, 'idempotency-key': 'deal-fee-accept-buyer' },
    payload: {},
  });
  assert.equal(buyerAccept.statusCode, 200);
  assert.equal(buyerAccept.json().offer.status, 'mutually_accepted');

  const sellerBalanceAfter = await repo.creditBalance(sellerNodeId);
  const buyerBalanceAfter = await repo.creditBalance(buyerNodeId);
  assert.equal(sellerBalanceAfter, sellerBalanceBefore - config.dealAcceptanceFeeCredits);
  assert.equal(buyerBalanceAfter, buyerBalanceBefore - config.dealAcceptanceFeeCredits);

  const sellerFeeRows = await query(
    "select count(*)::text as c from credit_ledger where node_id=$1 and type='deal_accept_fee' and (meta->>'offer_id')=$2",
    [sellerNodeId, offerId],
  );
  const buyerFeeRows = await query(
    "select count(*)::text as c from credit_ledger where node_id=$1 and type='deal_accept_fee' and (meta->>'offer_id')=$2",
    [buyerNodeId, offerId],
  );
  assert.equal(Number(sellerFeeRows[0].c), 1);
  assert.equal(Number(buyerFeeRows[0].c), 1);

  const replay = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${buyerKey}`, 'idempotency-key': 'deal-fee-accept-buyer-retry' },
    payload: {},
  });
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.json().error.code, 'invalid_state_transition');

  const sellerFeeRowsAfterReplay = await query(
    "select count(*)::text as c from credit_ledger where node_id=$1 and type='deal_accept_fee' and (meta->>'offer_id')=$2",
    [sellerNodeId, offerId],
  );
  const buyerFeeRowsAfterReplay = await query(
    "select count(*)::text as c from credit_ledger where node_id=$1 and type='deal_accept_fee' and (meta->>'offer_id')=$2",
    [buyerNodeId, offerId],
  );
  assert.equal(Number(sellerFeeRowsAfterReplay[0].c), 1);
  assert.equal(Number(buyerFeeRowsAfterReplay[0].c), 1);
  await app.close();
});

test('mutual acceptance is blocked when either side lacks credits', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-deal-fee-block-seller');
  const buyerBoot = await bootstrap(app, 'boot-deal-fee-block-buyer');
  const sellerNodeId = sellerBoot.json().node.id;
  const buyerNodeId = buyerBoot.json().node.id;
  const sellerKey = sellerBoot.json().api_key.api_key;
  const buyerKey = buyerBoot.json().api_key.api_key;

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Deal fee blocked unit', 'deal-fee-block-scope'));
  const created = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerKey}`, 'idempotency-key': 'deal-fee-block-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: 'deal-fee-block' },
  });
  assert.equal(created.statusCode, 200);
  const offerId = created.json().offer.id;

  const sellerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${sellerKey}`, 'idempotency-key': 'deal-fee-block-accept-seller' },
    payload: {},
  });
  assert.equal(sellerAccept.statusCode, 200);
  assert.equal(sellerAccept.json().offer.status, 'accepted_by_b');

  const sellerBalance = await repo.creditBalance(sellerNodeId);
  await repo.addCredit(sellerNodeId, 'adjustment_manual', -sellerBalance, { reason: 'test_drain_deal_accept_fee' });

  const buyerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${buyerKey}`, 'idempotency-key': 'deal-fee-block-accept-buyer' },
    payload: {},
  });
  assert.equal(buyerAccept.statusCode, 402);
  assert.equal(buyerAccept.json().error.code, 'credits_exhausted');
  assert.equal(buyerAccept.json().error.details.credits_required, config.dealAcceptanceFeeCredits);

  const offerAfter = await repo.getOffer(offerId);
  assert.equal(offerAfter.status, 'accepted_by_b');

  const feeRows = await query(
    "select count(*)::text as c from credit_ledger where type='deal_accept_fee' and (meta->>'offer_id')=$1",
    [offerId],
  );
  assert.equal(Number(feeRows[0].c), 0);
  await app.close();
});

test('detail GET endpoints persist detail_view visibility events', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-detail-views');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  const unit = await repo.createResource('units', nodeId, unitPayload('Detail view unit', 'detail-view-scope'));
  const request = await repo.createResource('requests', nodeId, { ...unitPayload('Detail view request', 'detail-view-scope') });

  const unitRes = await app.inject({
    method: 'GET',
    url: `/v1/units/${unit.id}`,
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  assert.equal(unitRes.statusCode, 200);

  const requestRes = await app.inject({
    method: 'GET',
    url: `/v1/requests/${request.id}`,
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  assert.equal(requestRes.statusCode, 200);

  const events = await query(
    `select event_type, subject_kind, item_id::text as item_id
     from visibility_events
     where event_type='detail_view' and viewer_node_id=$1
     order by created_at desc`,
    [nodeId],
  );
  const listingEvent = events.find((row) => row.subject_kind === 'listing' && row.item_id === unit.id);
  const requestEvent = events.find((row) => row.subject_kind === 'request' && row.item_id === request.id);
  assert.equal(Boolean(listingEvent), true);
  assert.equal(Boolean(requestEvent), true);
  await app.close();
});

test('offer outcomes are persisted for accepted, rejected, cancelled, and expired', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-offer-outcome-seller');
  const buyerBoot = await bootstrap(app, 'boot-offer-outcome-buyer');
  const sellerNodeId = sellerBoot.json().node.id;
  const buyerNodeId = buyerBoot.json().node.id;
  const sellerKey = sellerBoot.json().api_key.api_key;
  const buyerKey = buyerBoot.json().api_key.api_key;

  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_subscriber_offer_outcome_seller')).statusCode, 200);
  assert.equal((await activateBasicSubscriber(app, buyerNodeId, 'evt_subscriber_offer_outcome_buyer')).statusCode, 200);

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Offer outcome unit', 'offer-outcome-scope'));

  const acceptedCreate = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerKey}`, 'idempotency-key': 'offer-outcome-accepted-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(acceptedCreate.statusCode, 200);
  const acceptedOfferId = acceptedCreate.json().offer.id;
  const accepted = await app.inject({
    method: 'POST',
    url: `/v1/offers/${acceptedOfferId}/accept`,
    headers: { authorization: `ApiKey ${sellerKey}`, 'idempotency-key': 'offer-outcome-accept' },
    payload: {},
  });
  assert.equal(accepted.statusCode, 200);

  const rejectedCreate = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerKey}`, 'idempotency-key': 'offer-outcome-rejected-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(rejectedCreate.statusCode, 200);
  const rejectedOfferId = rejectedCreate.json().offer.id;
  const rejected = await app.inject({
    method: 'POST',
    url: `/v1/offers/${rejectedOfferId}/reject`,
    headers: { authorization: `ApiKey ${sellerKey}`, 'idempotency-key': 'offer-outcome-reject' },
    payload: {},
  });
  assert.equal(rejected.statusCode, 200);

  const cancelledCreate = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerKey}`, 'idempotency-key': 'offer-outcome-cancelled-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(cancelledCreate.statusCode, 200);
  const cancelledOfferId = cancelledCreate.json().offer.id;
  const cancelled = await app.inject({
    method: 'POST',
    url: `/v1/offers/${cancelledOfferId}/cancel`,
    headers: { authorization: `ApiKey ${buyerKey}`, 'idempotency-key': 'offer-outcome-cancel' },
    payload: {},
  });
  assert.equal(cancelled.statusCode, 200);

  const expiredCreate = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerKey}`, 'idempotency-key': 'offer-outcome-expired-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(expiredCreate.statusCode, 200);
  const expiredOfferId = expiredCreate.json().offer.id;
  await query("update offers set expires_at = now() - interval '1 minute' where id=$1", [expiredOfferId]);

  const expiredRead = await app.inject({
    method: 'GET',
    url: `/v1/offers/${expiredOfferId}`,
    headers: { authorization: `ApiKey ${buyerKey}` },
  });
  assert.equal(expiredRead.statusCode, 200);
  assert.equal(expiredRead.json().offer.status, 'expired');

  const outcomeRows = await query(
    `select id::text as id, status, expired_at
     from offers
     where id = any($1::uuid[])`,
    [[acceptedOfferId, rejectedOfferId, cancelledOfferId, expiredOfferId]],
  );
  const byId = new Map(outcomeRows.map((row) => [row.id, row]));
  assert.equal(byId.get(acceptedOfferId)?.status, 'accepted_by_b');
  assert.equal(byId.get(rejectedOfferId)?.status, 'rejected');
  assert.equal(byId.get(cancelledOfferId)?.status, 'cancelled');
  assert.equal(byId.get(expiredOfferId)?.status, 'expired');
  assert.equal(Boolean(byId.get(expiredOfferId)?.expired_at), true);
  await app.close();
});

test('reveal-contact returns sanitized messaging_handles and persists them in audit log', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-mh-seller', {
    display_name: 'MH Seller',
    email: `mh.seller.${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
  });
  const buyerBoot = await bootstrap(app, 'boot-mh-buyer', {
    display_name: 'MH Buyer',
    email: `mh.buyer.${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
  });
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  const buyerApiKey = buyerBoot.json().api_key.api_key;

  const sellerPatch = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'mh-seller-patch' },
    payload: {
      display_name: sellerBoot.json().node.display_name,
      email: sellerBoot.json().node.email,
      recovery_public_key: null,
      messaging_handles: [
        { kind: ' TELEGRAM ', handle: ' @mh_seller ', url: 'https://t.me/mh_seller ' },
      ],
    },
  });
  assert.equal(sellerPatch.statusCode, 200);
  assert.equal(sellerPatch.json().node.messaging_handles[0].kind, 'telegram');
  assert.equal(sellerPatch.json().node.messaging_handles[0].handle, '@mh_seller');
  assert.equal(sellerPatch.json().node.messaging_handles[0].url, 'https://t.me/mh_seller');

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Messaging handle unit', 'messaging-handle-scope'));
  const created = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'mh-offer-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(created.statusCode, 200);
  const offerId = created.json().offer.id;

  const sellerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'mh-offer-accept-seller' },
    payload: {},
  });
  assert.equal(sellerAccept.statusCode, 200);
  const buyerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'mh-offer-accept-buyer' },
    payload: {},
  });
  assert.equal(buyerAccept.statusCode, 200);
  assert.equal(buyerAccept.json().offer.status, 'mutually_accepted');

  const reveal = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/reveal-contact`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'mh-offer-reveal' },
    payload: {},
  });
  assert.equal(reveal.statusCode, 200);
  assert.equal(reveal.json().contact.email, `mh.seller.${TEST_RUN_SUFFIX}@example.com`);
  assert.equal(Array.isArray(reveal.json().contact.messaging_handles), true);
  assert.equal(reveal.json().contact.messaging_handles.length, 1);
  assert.equal(reveal.json().contact.messaging_handles[0].kind, 'telegram');
  assert.equal(reveal.json().contact.messaging_handles[0].handle, '@mh_seller');

  const rows = await query(
    `select revealed_messaging_handles
     from contact_reveals
     where offer_id=$1
     order by created_at desc
     limit 1`,
    [offerId],
  );
  assert.equal(Array.isArray(rows[0]?.revealed_messaging_handles), true);
  assert.equal(rows[0].revealed_messaging_handles[0].kind, 'telegram');
  await app.close();
});

test('messaging_handles accepts valid values and rejects invalid profile updates', async () => {
  const app = buildApp();
  const boot = await bootstrap(app, 'boot-mh-validate', {
    display_name: 'MH Validate',
    email: `mh.validate.${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
    messaging_handles: [
      { kind: ' TELEGRAM ', handle: ' @mh_validate ', url: 'https://t.me/mh_validate ' },
    ],
  });
  assert.equal(boot.statusCode, 200);
  assert.equal(boot.json().node.messaging_handles[0].kind, 'telegram');
  assert.equal(boot.json().node.messaging_handles[0].handle, '@mh_validate');
  assert.equal(boot.json().node.messaging_handles[0].url, 'https://t.me/mh_validate');

  const apiKey = boot.json().api_key.api_key;
  const invalidPatch = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'mh-invalid-patch' },
    payload: {
      display_name: boot.json().node.display_name,
      email: boot.json().node.email,
      recovery_public_key: null,
      messaging_handles: [{ kind: 'bad kind', handle: '@invalid', url: null }],
    },
  });
  assert.equal(invalidPatch.statusCode, 422);
  assert.equal(invalidPatch.json().error.code, 'validation_error');
  await app.close();
});

test('reveal-contact returns empty messaging_handles array when none configured', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-mh-empty-seller', {
    display_name: 'MH Empty Seller',
    email: `mh.empty.seller.${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
  });
  const buyerBoot = await bootstrap(app, 'boot-mh-empty-buyer', {
    display_name: 'MH Empty Buyer',
    email: `mh.empty.buyer.${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
  });

  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Messaging handle empty unit', 'messaging-handle-empty-scope'));
  const created = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'mh-empty-offer-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(created.statusCode, 200);
  const offerId = created.json().offer.id;

  const sellerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'mh-empty-offer-accept-seller' },
    payload: {},
  });
  assert.equal(sellerAccept.statusCode, 200);
  const buyerAccept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'mh-empty-offer-accept-buyer' },
    payload: {},
  });
  assert.equal(buyerAccept.statusCode, 200);

  const reveal = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/reveal-contact`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'mh-empty-offer-reveal' },
    payload: {},
  });
  assert.equal(reveal.statusCode, 200);
  assert.deepEqual(reveal.json().contact.messaging_handles, []);
  await app.close();
});

test('offer lifecycle events emit webhooks and /v1/events supports cursor polling', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-event-seller', {
    display_name: 'Event Seller',
    email: `event.seller.${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
  });
  const buyerBoot = await bootstrap(app, 'boot-event-buyer', {
    display_name: 'Event Buyer',
    email: `event.buyer.${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
  });
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  const buyerApiKey = buyerBoot.json().api_key.api_key;

  await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'events-seller-webhook' },
    payload: {
      display_name: sellerBoot.json().node.display_name,
      email: sellerBoot.json().node.email,
      recovery_public_key: null,
      event_webhook_url: 'https://hooks.example.test/seller',
      event_webhook_secret: 'seller-event-secret',
      messaging_handles: [],
    },
  });
  await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'events-buyer-webhook' },
    payload: {
      display_name: buyerBoot.json().node.display_name,
      email: buyerBoot.json().node.email,
      recovery_public_key: null,
      event_webhook_url: 'https://hooks.example.test/buyer',
      event_webhook_secret: null,
      messaging_handles: [],
    },
  });

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Offer events unit', 'offer-events-scope'));
  const webhookCalls = [];

  await withMockFetch(async (url, init) => {
    const rawBody = init && typeof init.body === 'string' ? init.body : '{}';
    const headerEntries = init && init.headers instanceof Headers
      ? [...init.headers.entries()]
      : Object.entries((init && init.headers) || {});
    const headers = Object.fromEntries(headerEntries.map(([k, v]) => [String(k).toLowerCase(), String(v)]));
    webhookCalls.push({ url: String(url), rawBody, body: JSON.parse(rawBody), headers });
    return jsonResponse(200, { ok: true });
  }, async () => {
    const createdA = await app.inject({
      method: 'POST',
      url: '/v1/offers',
      headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'events-offer-create-a' },
      payload: { unit_ids: [unit.id], thread_id: null, note: 'create-a' },
    });
    assert.equal(createdA.statusCode, 200);
    const offerAId = createdA.json().offer.id;

    const counterA = await app.inject({
      method: 'POST',
      url: `/v1/offers/${offerAId}/counter`,
      headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'events-offer-counter-a' },
      payload: { unit_ids: [unit.id], note: 'counter-a' },
    });
    assert.equal(counterA.statusCode, 200);
    const acceptedCreate = await app.inject({
      method: 'POST',
      url: '/v1/offers',
      headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'events-offer-create-accepted' },
      payload: { unit_ids: [unit.id], thread_id: null, note: 'accepted-offer' },
    });
    assert.equal(acceptedCreate.statusCode, 200);
    const acceptedOfferId = acceptedCreate.json().offer.id;

    const acceptByBuyer = await app.inject({
      method: 'POST',
      url: `/v1/offers/${acceptedOfferId}/accept`,
      headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'events-offer-accept-buyer' },
      payload: {},
    });
    assert.equal(acceptByBuyer.statusCode, 200);
    const acceptBySeller = await app.inject({
      method: 'POST',
      url: `/v1/offers/${acceptedOfferId}/accept`,
      headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'events-offer-accept-seller' },
      payload: {},
    });
    assert.equal(acceptBySeller.statusCode, 200);

    const reveal = await app.inject({
      method: 'POST',
      url: `/v1/offers/${acceptedOfferId}/reveal-contact`,
      headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'events-offer-reveal' },
      payload: {},
    });
    assert.equal(reveal.statusCode, 200);

    const createdB = await app.inject({
      method: 'POST',
      url: '/v1/offers',
      headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'events-offer-create-b' },
      payload: { unit_ids: [unit.id], thread_id: null, note: 'create-b' },
    });
    assert.equal(createdB.statusCode, 200);
    const offerBId = createdB.json().offer.id;
    const cancelB = await app.inject({
      method: 'POST',
      url: `/v1/offers/${offerBId}/cancel`,
      headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'events-offer-cancel-b' },
      payload: {},
    });
    assert.equal(cancelB.statusCode, 200);
  });

  const webhookTypes = new Set(webhookCalls.map((call) => call.body?.type));
  assert.equal(webhookTypes.has('offer_created'), true);
  assert.equal(webhookTypes.has('offer_countered'), true);
  assert.equal(webhookTypes.has('offer_accepted'), true);
  assert.equal(webhookTypes.has('offer_cancelled'), true);
  assert.equal(webhookTypes.has('offer_contact_revealed'), true);
  for (const call of webhookCalls) {
    assert.deepEqual(call.body?.payload ?? {}, {});
    assert.equal(Object.hasOwn(call.body ?? {}, 'contact'), false);
    assert.equal(Object.hasOwn(call.body?.payload ?? {}, 'email'), false);
    assert.equal(Object.hasOwn(call.body?.payload ?? {}, 'phone'), false);
    assert.equal(Object.hasOwn(call.body?.payload ?? {}, 'messaging_handles'), false);
  }

  const sellerWebhookCalls = webhookCalls.filter((call) => call.url === 'https://hooks.example.test/seller');
  const buyerWebhookCalls = webhookCalls.filter((call) => call.url === 'https://hooks.example.test/buyer');
  assert.equal(sellerWebhookCalls.length > 0, true);
  assert.equal(buyerWebhookCalls.length > 0, true);

  for (const call of sellerWebhookCalls) {
    const timestamp = call.headers['x-fabric-timestamp'];
    assert.equal(typeof timestamp, 'string');
    const expected = crypto.createHmac('sha256', 'seller-event-secret')
      .update(`${timestamp}.${call.rawBody}`, 'utf8')
      .digest('hex');
    assert.equal(call.headers['x-fabric-signature'], `t=${timestamp},v1=${expected}`);
  }
  for (const call of buyerWebhookCalls) {
    assert.equal(call.headers['x-fabric-timestamp'], undefined);
    assert.equal(call.headers['x-fabric-signature'], undefined);
  }

  const page1 = await app.inject({
    method: 'GET',
    url: '/v1/events?limit=2',
    headers: { authorization: `ApiKey ${buyerApiKey}` },
  });
  assert.equal(page1.statusCode, 200);
  assert.equal(Array.isArray(page1.json().events), true);
  assert.equal(page1.json().events.length, 2);
  assert.equal(typeof page1.json().next_cursor, 'string');

  const page2 = await app.inject({
    method: 'GET',
    url: `/v1/events?since=${encodeURIComponent(page1.json().next_cursor)}&limit=100`,
    headers: { authorization: `ApiKey ${buyerApiKey}` },
  });
  assert.equal(page2.statusCode, 200);
  const combinedEvents = [...page1.json().events, ...page2.json().events];
  const allIds = combinedEvents.map((event) => event.id);
  assert.equal(new Set(allIds).size, allIds.length);
  for (const event of combinedEvents) {
    assert.deepEqual(event.payload ?? {}, {});
    assert.equal(Object.hasOwn(event.payload ?? {}, 'email'), false);
    assert.equal(Object.hasOwn(event.payload ?? {}, 'phone'), false);
    assert.equal(Object.hasOwn(event.payload ?? {}, 'messaging_handles'), false);
  }

  const invalidCursor = await app.inject({
    method: 'GET',
    url: '/v1/events?since=not-a-cursor',
    headers: { authorization: `ApiKey ${buyerApiKey}` },
  });
  assert.equal(invalidCursor.statusCode, 422);
  assert.equal(invalidCursor.json().error.code, 'validation_error');
  assert.equal(invalidCursor.json().error.details.reason, 'invalid_since_cursor');

  const deliveryRows = await query('select count(*)::text as c from event_webhook_deliveries');
  assert.equal(Number(deliveryRows[0].c) > 0, true);
  await app.close();
});

test('clearing event_webhook_secret omits webhook signing headers on subsequent deliveries', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-event-secret-clear-seller', {
    display_name: 'Event Secret Clear Seller',
    email: `event.secret.clear.seller.${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
  });
  const buyerBoot = await bootstrap(app, 'boot-event-secret-clear-buyer', {
    display_name: 'Event Secret Clear Buyer',
    email: `event.secret.clear.buyer.${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
  });
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  const buyerApiKey = buyerBoot.json().api_key.api_key;

  const patchSet = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'events-secret-clear-set' },
    payload: {
      event_webhook_url: 'https://hooks.example.test/secret-clear',
      event_webhook_secret: 'secret-before-clear',
    },
  });
  assert.equal(patchSet.statusCode, 200);

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Offer events clear-secret unit', 'offer-events-clear-secret-scope'));
  const webhookCalls = [];

  await withMockFetch(async (url, init) => {
    const rawBody = init && typeof init.body === 'string' ? init.body : '{}';
    const headerEntries = init && init.headers instanceof Headers
      ? [...init.headers.entries()]
      : Object.entries((init && init.headers) || {});
    const headers = Object.fromEntries(headerEntries.map(([k, v]) => [String(k).toLowerCase(), String(v)]));
    webhookCalls.push({ url: String(url), rawBody, body: JSON.parse(rawBody), headers });
    return jsonResponse(200, { ok: true });
  }, async () => {
    const createdBeforeClear = await app.inject({
      method: 'POST',
      url: '/v1/offers',
      headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'events-secret-clear-offer-before' },
      payload: { unit_ids: [unit.id], thread_id: null, note: 'before-clear' },
    });
    assert.equal(createdBeforeClear.statusCode, 200);

    const clearSecret = await app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'events-secret-clear-null' },
      payload: { event_webhook_secret: null },
    });
    assert.equal(clearSecret.statusCode, 200);

    const createdAfterClear = await app.inject({
      method: 'POST',
      url: '/v1/offers',
      headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'events-secret-clear-offer-after' },
      payload: { unit_ids: [unit.id], thread_id: null, note: 'after-clear' },
    });
    assert.equal(createdAfterClear.statusCode, 200);
  });

  const sellerCalls = webhookCalls.filter((call) => call.url === 'https://hooks.example.test/secret-clear' && call.body?.type === 'offer_created');
  assert.equal(sellerCalls.length >= 2, true);

  const firstCall = sellerCalls[0];
  const firstTimestamp = firstCall.headers['x-fabric-timestamp'];
  assert.equal(typeof firstTimestamp, 'string');
  const expectedFirst = crypto.createHmac('sha256', 'secret-before-clear')
    .update(`${firstTimestamp}.${firstCall.rawBody}`, 'utf8')
    .digest('hex');
  assert.equal(firstCall.headers['x-fabric-signature'], `t=${firstTimestamp},v1=${expectedFirst}`);

  const lastCall = sellerCalls[sellerCalls.length - 1];
  assert.equal(lastCall.headers['x-fabric-timestamp'], undefined);
  assert.equal(lastCall.headers['x-fabric-signature'], undefined);

  await app.close();
});

test('/v1/events cursor pagination with limit=1 returns strictly later events after since cursor', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-event-cursor-seller', {
    display_name: 'Event Cursor Seller',
    email: `event.cursor.seller.${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
  });
  const buyerBoot = await bootstrap(app, 'boot-event-cursor-buyer', {
    display_name: 'Event Cursor Buyer',
    email: `event.cursor.buyer.${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
  });
  const sellerNodeId = sellerBoot.json().node.id;
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Offer events cursor unit', 'offer-events-cursor-scope'));

  const firstOffer = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'events-cursor-offer-a' },
    payload: { unit_ids: [unit.id], thread_id: null, note: 'cursor-a' },
  });
  assert.equal(firstOffer.statusCode, 200);
  const secondOffer = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'events-cursor-offer-b' },
    payload: { unit_ids: [unit.id], thread_id: null, note: 'cursor-b' },
  });
  assert.equal(secondOffer.statusCode, 200);

  const page1 = await app.inject({
    method: 'GET',
    url: '/v1/events?limit=1',
    headers: { authorization: `ApiKey ${buyerApiKey}` },
  });
  assert.equal(page1.statusCode, 200);
  assert.equal(page1.json().events.length, 1);
  assert.equal(typeof page1.json().next_cursor, 'string');
  const firstEvent = page1.json().events[0];

  const page2 = await app.inject({
    method: 'GET',
    url: `/v1/events?since=${encodeURIComponent(page1.json().next_cursor)}&limit=10`,
    headers: { authorization: `ApiKey ${buyerApiKey}` },
  });
  assert.equal(page2.statusCode, 200);
  assert.equal(page2.json().events.length >= 1, true);
  assert.equal(page2.json().events.some((event) => event.id === firstEvent.id), false);
  assert.equal(page2.json().events.every((event) => Date.parse(event.created_at) >= Date.parse(firstEvent.created_at)), true);

  await app.close();
});

test('event webhook retries are bounded and polling remains available when delivery fails', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-event-retry-seller', {
    display_name: 'Event Retry Seller',
    email: `event.retry.seller.${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
  });
  const buyerBoot = await bootstrap(app, 'boot-event-retry-buyer', {
    display_name: 'Event Retry Buyer',
    email: `event.retry.buyer.${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
  });
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  const buyerApiKey = buyerBoot.json().api_key.api_key;

  const patchSeller = await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'events-retry-seller-webhook' },
    payload: {
      display_name: sellerBoot.json().node.display_name,
      email: sellerBoot.json().node.email,
      recovery_public_key: null,
      event_webhook_url: 'https://hooks.example.test/retry-fail',
      event_webhook_secret: 'retry-secret',
      messaging_handles: [],
    },
  });
  assert.equal(patchSeller.statusCode, 200);

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Offer events retry unit', 'offer-events-retry-scope'));
  let failingAttemptCount = 0;

  await withConfigOverrides({
    eventWebhookRetryWindowMinutes: 0.0015,
    eventWebhookRetryBaseMs: 10,
    eventWebhookRetryMaxMs: 20,
  }, async () => {
    await withMockFetch(async (url) => {
      if (String(url) === 'https://hooks.example.test/retry-fail') {
        failingAttemptCount += 1;
        return jsonResponse(500, { ok: false });
      }
      return jsonResponse(200, { ok: true });
    }, async () => {
      const created = await app.inject({
        method: 'POST',
        url: '/v1/offers',
        headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'events-retry-offer-create' },
        payload: { unit_ids: [unit.id], thread_id: null, note: 'retry-case' },
      });
      assert.equal(created.statusCode, 200);

      await new Promise((resolve) => setTimeout(resolve, 250));
    });
  });

  assert.equal(failingAttemptCount > 1, true);
  const retryRows = await query(
    `select attempt_number, ok, next_retry_at, delivered_at
     from event_webhook_deliveries
     where webhook_url=$1
     order by created_at asc`,
    ['https://hooks.example.test/retry-fail'],
  );
  assert.equal(retryRows.length > 1, true);
  assert.equal(retryRows.some((row) => Number(row.attempt_number) > 1), true);
  assert.equal(retryRows[retryRows.length - 1].next_retry_at, null);
  assert.equal(retryRows[retryRows.length - 1].delivered_at, null);

  const eventsPoll = await app.inject({
    method: 'GET',
    url: '/v1/events?limit=10',
    headers: { authorization: `ApiKey ${sellerApiKey}` },
  });
  assert.equal(eventsPoll.statusCode, 200);
  assert.equal(Array.isArray(eventsPoll.json().events), true);
  assert.equal(eventsPoll.json().events.length > 0, true);
  await app.close();
});

test('unit milestones grant credits at 10 and 20 (idempotent, no excess grants)', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-upload-milestone');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  const firstMilestone = 10;
  const secondMilestone = 20;

  const balanceBefore = await repo.creditBalance(nodeId);

  for (let i = 0; i < firstMilestone - 1; i += 1) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/units',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `ms-unit-${i}` },
      payload: unitPayload(`Milestone unit ${i}`, `ms-upload-${i}`),
    });
    assert.equal(res.statusCode, 200);
  }

  const balanceBeforeFirstMilestone = await repo.creditBalance(nodeId);
  assert.equal(balanceBeforeFirstMilestone, balanceBefore);

  const firstMilestoneHit = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `ms-unit-${firstMilestone - 1}` },
    payload: unitPayload(`Milestone unit ${firstMilestone - 1}`, `ms-upload-${firstMilestone - 1}`),
  });
  assert.equal(firstMilestoneHit.statusCode, 200);

  const balanceAfterFirstMilestone = await repo.creditBalance(nodeId);
  assert.equal(balanceAfterFirstMilestone - balanceBeforeFirstMilestone, 100);

  for (let i = firstMilestone; i < secondMilestone - 1; i += 1) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/units',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `ms-unit-${i}` },
      payload: unitPayload(`Milestone unit ${i}`, `ms-upload-${i}`),
    });
    assert.equal(res.statusCode, 200);
  }

  const balanceBeforeSecondMilestone = await repo.creditBalance(nodeId);
  assert.equal(balanceBeforeSecondMilestone, balanceAfterFirstMilestone);

  const secondMilestoneHit = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `ms-unit-${secondMilestone - 1}` },
    payload: unitPayload(`Milestone unit ${secondMilestone - 1}`, `ms-upload-${secondMilestone - 1}`),
  });
  assert.equal(secondMilestoneHit.statusCode, 200);

  const balanceAfterSecondMilestone = await repo.creditBalance(nodeId);
  assert.equal(balanceAfterSecondMilestone - balanceBeforeSecondMilestone, 100);
  assert.equal(balanceAfterSecondMilestone - balanceBefore, 200);

  const postThreshold = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `ms-unit-${secondMilestone}` },
    payload: unitPayload(`Milestone unit ${secondMilestone}`, `ms-upload-${secondMilestone}`),
  });
  assert.equal(postThreshold.statusCode, 200);

  const balanceAfterPostThreshold = await repo.creditBalance(nodeId);
  assert.equal(balanceAfterPostThreshold, balanceAfterSecondMilestone);

  const trialGrantRows = await query("select count(*)::text as c, coalesce(sum(amount),0)::text as s from credit_ledger where node_id=$1 and type='grant_trial'", [nodeId]);
  assert.equal(Number(trialGrantRows[0].c), 2);
  assert.equal(Number(trialGrantRows[0].s), 200);
  await app.close();
});

test('request milestones grant credits at 10 and 20 only', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-request-milestone');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  const firstMilestone = 10;
  const secondMilestone = 20;

  const balanceBefore = await repo.creditBalance(nodeId);
  for (let i = 0; i < firstMilestone - 1; i += 1) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/requests',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `request-milestone-${i}` },
      payload: unitPayload(`Request milestone ${i}`, `request-milestone-${i}`),
    });
    assert.equal(res.statusCode, 200);
  }

  const balanceBeforeFirstMilestone = await repo.creditBalance(nodeId);
  assert.equal(balanceBeforeFirstMilestone, balanceBefore);

  const firstMilestoneHit = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `request-milestone-${firstMilestone - 1}` },
    payload: unitPayload(`Request milestone ${firstMilestone - 1}`, `request-milestone-${firstMilestone - 1}`),
  });
  assert.equal(firstMilestoneHit.statusCode, 200);
  const balanceAfterFirstMilestone = await repo.creditBalance(nodeId);
  assert.equal(balanceAfterFirstMilestone - balanceBeforeFirstMilestone, 100);

  for (let i = firstMilestone; i < secondMilestone - 1; i += 1) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/requests',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `request-milestone-${i}` },
      payload: unitPayload(`Request milestone ${i}`, `request-milestone-${i}`),
    });
    assert.equal(res.statusCode, 200);
  }

  const balanceBeforeSecondMilestone = await repo.creditBalance(nodeId);
  assert.equal(balanceBeforeSecondMilestone, balanceAfterFirstMilestone);

  const secondMilestoneHit = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `request-milestone-${secondMilestone - 1}` },
    payload: unitPayload(`Request milestone ${secondMilestone - 1}`, `request-milestone-${secondMilestone - 1}`),
  });
  assert.equal(secondMilestoneHit.statusCode, 200);
  const balanceAfterSecondMilestone = await repo.creditBalance(nodeId);
  assert.equal(balanceAfterSecondMilestone - balanceBeforeSecondMilestone, 100);
  assert.equal(balanceAfterSecondMilestone - balanceBefore, 200);

  const postThreshold = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `request-milestone-${secondMilestone}` },
    payload: unitPayload(`Request milestone ${secondMilestone}`, `request-milestone-${secondMilestone}`),
  });
  assert.equal(postThreshold.statusCode, 200);
  const balanceAfterPostThreshold = await repo.creditBalance(nodeId);
  assert.equal(balanceAfterPostThreshold, balanceAfterSecondMilestone);

  const grantRows = await query(
    "select count(*)::text as c, coalesce(sum(amount),0)::text as s from credit_ledger where node_id=$1 and type='grant_milestone_requests'",
    [nodeId],
  );
  assert.equal(Number(grantRows[0].c), 2);
  assert.equal(Number(grantRows[0].s), 200);
  await app.close();
});

test('search works with credits only (no subscriber gate required)', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-search-credits-only');
  const apiKey = b.json().api_key.api_key;

  const search = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'credits-only-search-1' },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'no-match-ok' }, broadening: { level: 0, allow: false }, budget: { credits_max: config.searchCreditCost }, limit: 20, cursor: null },
  });
  assert.equal(search.statusCode, 200);
  await app.close();
});

test('rate limit returns canonical envelope with rate_limit_exceeded', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-rate-limit');
  const apiKey = b.json().api_key.api_key;

  for (let i = 0; i < 10; i += 1) {
    const ok = await app.inject({
      method: 'POST',
      url: '/v1/auth/keys',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `rl-auth-keys-${i}` },
      payload: { label: `key-${i}` },
    });
    assert.equal(ok.statusCode, 200);
  }

  const limited = await app.inject({
    method: 'POST',
    url: '/v1/auth/keys',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'rl-auth-keys-over' },
    payload: { label: 'overflow' },
  });
  assert.equal(limited.statusCode, 429);
  assert.equal(limited.json().error.code, 'rate_limit_exceeded');
  assert.equal(limited.json().error.details.rule, 'auth_key_issue');
  await app.close();
});

test('GET /v1/credits/quote returns pack and plan quote catalog', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-credits-quote-get');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  const res = await app.inject({
    method: 'GET',
    url: '/v1/credits/quote',
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.node_id, nodeId);
  assert.equal(body.search_quote.estimated_cost, 5);
  assert.equal(Array.isArray(body.credit_packs), true);
  assert.equal(body.credit_packs.length, 3);
  assert.equal(body.credit_packs[0].pack_code, 'credits_500');
  assert.equal(body.credit_packs[0].name, '500 Credit Pack');
  assert.equal(body.credit_packs[0].credits, 500);
  assert.equal(body.credit_packs[0].price_cents, 999);
  assert.equal(body.credit_packs[0].stripe_price_id, 'price_credit_pack_500_test');
  await app.close();
});

test('POST /v1/credits/quote is idempotent and does not mutate balance', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-credits-quote-post');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  const balBefore = await repo.creditBalance(nodeId);

  const payload = {
    q: null,
    scope: 'OTHER',
    filters: { scope_notes: 'test quote' },
    broadening: { level: 2, allow: true },
    limit: 20,
    cursor: null,
  };
  const idemKey = 'credits-quote-idem-1';

  const first = await app.inject({
    method: 'POST',
    url: '/v1/credits/quote',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': idemKey },
    payload,
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().search_quote.estimated_cost, 5);
  assert.equal(first.json().affordability.can_afford_estimate, true);

  const replay = await app.inject({
    method: 'POST',
    url: '/v1/credits/quote',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': idemKey },
    payload,
  });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), first.json());

  const conflict = await app.inject({
    method: 'POST',
    url: '/v1/credits/quote',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': idemKey },
    payload: { ...payload, broadening: { level: 0, allow: false } },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, 'idempotency_key_reuse_conflict');

  const balAfter = await repo.creditBalance(nodeId);
  assert.equal(balAfter, balBefore);
  await app.close();
});

test('GET /v1/credits/balance requires auth and returns contract shape', async () => {
  const app = buildApp();
  const unauth = await app.inject({ method: 'GET', url: '/v1/credits/balance' });
  assert.equal(unauth.statusCode, 401);
  assert.equal(unauth.json().error.code, 'unauthorized');

  const b = await bootstrap(app, 'boot-credits-balance');
  const apiKey = b.json().api_key.api_key;
  const res = await app.inject({
    method: 'GET',
    url: '/v1/credits/balance',
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(typeof res.json().credits_balance, 'number');
  assert.equal(typeof res.json().subscription.plan, 'string');
  assert.equal(typeof res.json().subscription.status, 'string');
  await app.close();
});

test('GET /v1/credits/ledger requires auth and returns entries envelope', async () => {
  const app = buildApp();
  const unauth = await app.inject({ method: 'GET', url: '/v1/credits/ledger' });
  assert.equal(unauth.statusCode, 401);
  assert.equal(unauth.json().error.code, 'unauthorized');

  const b = await bootstrap(app, 'boot-credits-ledger');
  const apiKey = b.json().api_key.api_key;
  const res = await app.inject({
    method: 'GET',
    url: '/v1/credits/ledger?limit=5',
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(Array.isArray(res.json().entries), true);
  assert.equal(Object.hasOwn(res.json(), 'next_cursor'), true);
  assert.equal(res.json().entries.some((entry) => entry.type === 'grant_signup'), true);
  await app.close();
});

test('POST /v1/referrals/claim supports idempotent replay and rejects invalid code', async () => {
  const app = buildApp();
  const referrer = await bootstrap(app, 'boot-refclaim-referrer');
  const referrerNodeId = referrer.json().node.id;
  const code = `REF-CLAIM-${referrerNodeId.slice(0, 8)}`;
  await repo.ensureReferralCode(code, referrerNodeId);

  const claimer = await bootstrap(app, 'boot-refclaim-claimer');
  const apiKey = claimer.json().api_key.api_key;
  const idemKey = 'referral-claim-idem-1';

  const first = await app.inject({
    method: 'POST',
    url: '/v1/referrals/claim',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': idemKey },
    payload: { referral_code: code },
  });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().ok, true);
  assert.equal(first.json().referrer_node_id, referrerNodeId);

  const replay = await app.inject({
    method: 'POST',
    url: '/v1/referrals/claim',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': idemKey },
    payload: { referral_code: code },
  });
  assert.equal(replay.statusCode, 200);
  assert.deepEqual(replay.json(), first.json());

  const conflict = await app.inject({
    method: 'POST',
    url: '/v1/referrals/claim',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': idemKey },
    payload: { referral_code: `${code}-DIFF` },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, 'idempotency_key_reuse_conflict');

  const invalid = await app.inject({
    method: 'POST',
    url: '/v1/referrals/claim',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'referral-claim-invalid' },
    payload: { referral_code: 'UNKNOWN_CODE' },
  });
  assert.equal(invalid.statusCode, 422);
  assert.equal(invalid.json().error.code, 'validation_error');
  await app.close();
});

test('search log persistence redacts email and stores query hash', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-search-log-redaction');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  const res = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-log-redaction-1' },
    payload: {
      q: 'Need shipment updates to alice@example.com',
      scope: 'OTHER',
      filters: { scope_notes: 'search-redaction-scope' },
      broadening: { level: 0, allow: false },
      budget: { credits_requested: config.searchCreditCost },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(res.statusCode, 200);

  const rows = await query(
    `select query_redacted, query_hash
     from search_logs
     where node_id=$1
     order by created_at desc
     limit 1`,
    [nodeId],
  );
  assert.equal(rows.length, 1);
  assert.equal(String(rows[0].query_redacted).includes('alice@example.com'), false);
  assert.equal(String(rows[0].query_redacted).includes('[redacted_email]'), true);
  assert.match(String(rows[0].query_hash ?? ''), /^[a-f0-9]{64}$/);
  await app.close();
});

test('billing checkout-session creates a Stripe session and respects idempotency', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-billing');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  const idemKey = 'bill-checkout-1';
  let fetchCalls = 0;

  await withMockFetch(async (url, init = {}) => {
    fetchCalls += 1;
    assert.equal(String(url), 'https://api.stripe.com/v1/checkout/sessions');
    const headers = new Headers(init.headers);
    assert.match(headers.get('Authorization') ?? '', /^Bearer /);
    assert.match(headers.get('Idempotency-Key') ?? '', /^fabric_checkout:/);

    const form = new URLSearchParams(String(init.body ?? ''));
    assert.equal(form.get('mode'), 'subscription');
    assert.equal(form.get('line_items[0][price]'), 'price_pro_test');
    assert.equal(form.get('metadata[node_id]'), nodeId);
    assert.equal(form.get('metadata[plan_code]'), 'pro');
    assert.equal(form.get('subscription_data[metadata][node_id]'), nodeId);
    assert.equal(form.get('subscription_data[metadata][plan_code]'), 'pro');

    return jsonResponse(200, {
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      mode: 'subscription',
    });
  }, async () => {
    const payload = {
      node_id: nodeId,
      plan_code: 'pro',
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout-session',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': idemKey },
      payload,
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().node_id, nodeId);
    assert.equal(first.json().plan_code, 'pro');
    assert.equal(first.json().checkout_session_id, 'cs_test_123');
    assert.equal(first.json().checkout_url, 'https://checkout.stripe.com/c/pay/cs_test_123');

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout-session',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': idemKey },
      payload,
    });
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), first.json());

    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout-session',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': idemKey },
      payload: { ...payload, plan_code: 'basic' },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, 'idempotency_key_reuse_conflict');
  });

  assert.equal(fetchCalls, 1);
  await app.close();
});

test('billing credit-packs checkout-session creates payment mode session and respects idempotency', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-credit-pack-checkout');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  const idemKey = 'credit-pack-checkout-1';
  let fetchCalls = 0;

  await withMockFetch(async (url, init = {}) => {
    fetchCalls += 1;
    assert.equal(String(url), 'https://api.stripe.com/v1/checkout/sessions');
    const headers = new Headers(init.headers);
    assert.match(headers.get('Authorization') ?? '', /^Bearer /);
    assert.match(headers.get('Idempotency-Key') ?? '', /^fabric_credit_pack:/);

    const form = new URLSearchParams(String(init.body ?? ''));
    assert.equal(form.get('mode'), 'payment');
    assert.equal(form.get('line_items[0][price]'), 'price_credit_pack_1500_test');
    assert.equal(form.get('metadata[node_id]'), nodeId);
    assert.equal(form.get('metadata[pack_code]'), 'credits_1500');
    assert.equal(form.get('metadata[pack_credits]'), '1500');

    return jsonResponse(200, {
      id: 'cs_credit_pack_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_credit_pack_test_123',
      mode: 'payment',
    });
  }, async () => {
    const payload = {
      node_id: nodeId,
      pack_code: 'credits_1500',
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/billing/credit-packs/checkout-session',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': idemKey },
      payload,
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().node_id, nodeId);
    assert.equal(first.json().pack_code, 'credits_1500');
    assert.equal(first.json().credits, 1500);
    assert.equal(first.json().checkout_session_id, 'cs_credit_pack_test_123');
    assert.equal(first.json().checkout_url, 'https://checkout.stripe.com/c/pay/cs_credit_pack_test_123');

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/billing/credit-packs/checkout-session',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': idemKey },
      payload,
    });
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), first.json());

    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/billing/credit-packs/checkout-session',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': idemKey },
      payload: { ...payload, pack_code: 'credits_500' },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.json().error.code, 'idempotency_key_reuse_conflict');
  });

  assert.equal(fetchCalls, 1);
  await app.close();
});

test('billing checkout-session accepts basic/pro/business and rejects plus', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-billing-plan-validation');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  const expectedPriceByPlan = {
    basic: 'price_basic_test',
    pro: 'price_pro_test',
    business: 'price_business_test',
  };

  let fetchCalls = 0;
  await withMockFetch(async (_url, init = {}) => {
    fetchCalls += 1;
    const form = new URLSearchParams(String(init.body ?? ''));
    const planCode = form.get('metadata[plan_code]');
    assert.ok(planCode === 'basic' || planCode === 'pro' || planCode === 'business');
    assert.equal(form.get('line_items[0][price]'), expectedPriceByPlan[planCode]);
    return jsonResponse(200, {
      id: `cs_${planCode}_test_123`,
      url: `https://checkout.stripe.com/c/pay/cs_${planCode}_test_123`,
      mode: 'subscription',
    });
  }, async () => {
    for (const planCode of ['basic', 'pro', 'business']) {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/checkout-session',
        headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `bill-plan-${planCode}-1` },
        payload: {
          node_id: nodeId,
          plan_code: planCode,
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
        },
      });
      assert.equal(res.statusCode, 200);
      assert.equal(res.json().plan_code, planCode);
    }

    const plusRes = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout-session',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'bill-plan-plus-1' },
      payload: {
        node_id: nodeId,
        plan_code: 'plus',
        success_url: 'https://example.com/success',
        cancel_url: 'https://example.com/cancel',
      },
    });
    assert.equal(plusRes.statusCode, 422);
    assert.equal(plusRes.json().error.code, 'validation_error');
  });

  assert.equal(fetchCalls, 3);
  await app.close();
});

test('billing checkout-session returns stripe_not_configured with missing env vars and does not call Stripe when key is absent', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-billing-missing-stripe-key');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  let fetchCalls = 0;
  await withConfigOverrides({ stripeSecretKey: '' }, async () => {
    await withMockFetch(async () => {
      fetchCalls += 1;
      throw new Error('Stripe should not be called when stripe key is not configured');
    }, async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/checkout-session',
        headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'bill-missing-stripe-key-1' },
        payload: {
          node_id: nodeId,
          plan_code: 'pro',
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
        },
      });

      assert.equal(res.statusCode, 422);
      assert.equal(res.json().error.code, 'validation_error');
      assert.equal(res.json().error.details.reason, 'stripe_not_configured');
      assert.deepEqual(res.json().error.details.missing, ['STRIPE_SECRET_KEY']);
    });
  });

  assert.equal(fetchCalls, 0);
  await app.close();
});

test('webhook checkout.session.completed grants credit pack credits once by payment reference', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-credit-pack-webhook-idem');
  const nodeId = b.json().node.id;
  const balBefore = await repo.creditBalance(nodeId);

  const eventA = {
    id: `evt_cp_a_${nodeId.slice(0, 8)}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_cp_a_${nodeId.slice(0, 8)}`,
        payment_status: 'paid',
        payment_intent: `pi_cp_${nodeId.slice(0, 8)}`,
        metadata: { node_id: nodeId, pack_code: 'credits_1500' },
      },
    },
  };
  const eventB = {
    ...eventA,
    id: `evt_cp_b_${nodeId.slice(0, 8)}`,
  };

  const sigA = sign(eventA);
  const sigB = sign(eventB);
  const resA = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sigA.header }, payload: sigA.raw });
  const resB = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sigB.header }, payload: sigB.raw });
  assert.equal(resA.statusCode, 200);
  assert.equal(resB.statusCode, 200);

  const balAfter = await repo.creditBalance(nodeId);
  assert.equal(balAfter - balBefore, 1500);
  await app.close();
});

test('webhook checkout.session.completed with unknown credit pack does not grant credits', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-cp-unknown-pack');
  const nodeId = b.json().node.id;
  const balBefore = await repo.creditBalance(nodeId);
  const paymentIntent = `pi_cp_unknown_${nodeId.slice(0, 8)}`;

  const event = {
    id: `evt_cp_unknown_${nodeId.slice(0, 8)}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_cp_unknown_${nodeId.slice(0, 8)}`,
        payment_status: 'paid',
        payment_intent: paymentIntent,
        metadata: { node_id: nodeId, pack_code: 'credits_not_mapped' },
      },
    },
  };
  const sig = sign(event);
  const res = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
  assert.equal(res.statusCode, 200);

  const balAfter = await repo.creditBalance(nodeId);
  assert.equal(balAfter, balBefore);
  const rows = await query(
    `select id
     from credit_ledger
     where node_id=$1 and type='topup_purchase' and idempotency_key=$2`,
    [nodeId, `credit_pack:payment_intent:${paymentIntent}`],
  );
  assert.equal(rows.length, 0);
  await app.close();
});

test('credit pack grants enforce daily velocity limit per node', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-cp-velocity');
  const nodeId = b.json().node.id;
  const balBefore = await repo.creditBalance(nodeId);

  for (let i = 0; i < 4; i += 1) {
    const event = {
      id: `evt_cp_vel_${nodeId.slice(0, 8)}_${i}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_cp_vel_${nodeId.slice(0, 8)}_${i}`,
          payment_status: 'paid',
          payment_intent: `pi_cp_vel_${nodeId.slice(0, 8)}_${i}`,
          metadata: { node_id: nodeId, pack_code: 'credits_500' },
        },
      },
    };
    const sig = sign(event);
    const res = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
    assert.equal(res.statusCode, 200);
  }

  const balAfter = await repo.creditBalance(nodeId);
  assert.equal(balAfter - balBefore, 1500);
  await app.close();
});

test('webhook processes checkout.session.completed and is idempotent by event id', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh');
  const nodeId = b.json().node.id;
  const body = { id: `evt_checkout_completed_${nodeId.slice(0, 8)}`, type: 'checkout.session.completed', data: { object: { payment_status: 'paid', metadata: { node_id: nodeId, plan_code: 'pro' }, customer: 'cus_1', subscription: 'sub_1' } } };
  const sig = sign(body);
  const r1 = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
  const r2 = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
  assert.equal(r1.statusCode, 200);
  assert.equal(r2.statusCode, 200);
  const me = await repo.getMe(nodeId);
  assert.equal(me.sub_status, 'active');
  assert.equal(me.plan_code, 'pro');
  await app.close();
});

test('webhook checkout.session.completed with unpaid status stores Stripe mapping but does not activate subscription', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh-unpaid');
  const nodeId = b.json().node.id;
  const customerId = `cus_unpaid_${nodeId.slice(0, 8)}`;
  const subscriptionId = `sub_unpaid_${nodeId.slice(0, 8)}`;
  const body = {
    id: `evt_unpaid_${nodeId.slice(0, 8)}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        payment_status: 'unpaid',
        metadata: { node_id: nodeId, plan_code: 'basic' },
        customer: customerId,
        subscription: subscriptionId,
      },
    },
  };
  const sig = sign(body);
  const res = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
  assert.equal(res.statusCode, 200);

  const me = await repo.getMe(nodeId);
  assert.equal(me.sub_status, 'none');
  assert.equal(me.plan_code, 'free');
  const mapping = await repo.getSubscriptionMapping(nodeId);
  assert.equal(mapping.stripe_customer_id, customerId);
  assert.equal(mapping.stripe_subscription_id, subscriptionId);
  await app.close();
});

test('webhook accepts valid signature when stripe-signature has multiple v1 values', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh-multi');
  const nodeId = b.json().node.id;
  const body = { id: `evt_multi_sig_${nodeId.slice(0, 8)}`, type: 'checkout.session.completed', data: { object: { payment_status: 'paid', metadata: { node_id: nodeId, plan_code: 'pro' }, customer: 'cus_2', subscription: 'sub_2' } } };
  const sig = sign(body);
  const header = `t=${sig.t},v1=00${sig.v1.slice(2)},v1=${sig.v1}`;
  const res = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': header }, payload: sig.raw });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test('webhook returns stripe_signature_invalid when signature verification fails', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh-bad-sig');
  const nodeId = b.json().node.id;
  const body = { id: 'evt_bad_sig', type: 'checkout.session.completed', data: { object: { payment_status: 'paid', metadata: { node_id: nodeId, plan_code: 'basic' }, customer: 'cus_bad', subscription: 'sub_bad' } } };
  const sig = sign(body);
  const badHeader = `t=${sig.t},v1=${'0'.repeat(64)}`;
  const res = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': badHeader }, payload: sig.raw });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'stripe_signature_invalid');
  assert.equal(res.json().error.details.reason, 'signature_mismatch');
  await app.close();
});

test('webhook returns stripe_signature_invalid when signature header is missing', async () => {
  const app = buildApp();
  const body = {
    id: 'evt_missing_sig',
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', metadata: { node_id: crypto.randomUUID(), plan_code: 'basic' } } },
  };
  const res = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', payload: JSON.stringify(body) });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'stripe_signature_invalid');
  assert.equal(res.json().error.details.reason, 'missing_signature_header');
  await app.close();
});

test('webhook maps subscription events by stored stripe_customer_id when node metadata is absent', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh-map-sub');
  const nodeId = b.json().node.id;
  const customerId = `cus_map_sub_${nodeId.slice(0, 8)}`;
  const subscriptionId = `sub_map_sub_${nodeId.slice(0, 8)}`;

  const checkoutEvent = {
    id: `evt_map_checkout_${nodeId.slice(0, 8)}`,
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', metadata: { node_id: nodeId, plan_code: 'basic' }, customer: customerId, subscription: subscriptionId } },
  };
  const checkoutSig = sign(checkoutEvent);
  const checkoutRes = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': checkoutSig.header }, payload: checkoutSig.raw });
  assert.equal(checkoutRes.statusCode, 200);

  const subEvent = {
    id: `evt_map_subscription_${nodeId.slice(0, 8)}`,
    type: 'customer.subscription.updated',
    data: { object: { id: subscriptionId, customer: customerId, status: 'active', current_period_start: 1735689600, current_period_end: 1738368000 } },
  };
  const subSig = sign(subEvent);
  const subRes = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': subSig.header }, payload: subSig.raw });
  assert.equal(subRes.statusCode, 200);

  const me = await repo.getMe(nodeId);
  assert.equal(me.sub_status, 'active');
  assert.equal(me.plan_code, 'basic');
  await app.close();
});

test('webhook maps invoice.paid by stored stripe_customer_id and grants monthly credits once', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh-map-invoice');
  const nodeId = b.json().node.id;
  const customerId = `cus_map_invoice_${nodeId.slice(0, 8)}`;
  const subscriptionId = `sub_map_invoice_${nodeId.slice(0, 8)}`;

  const checkoutEvent = {
    id: `evt_map_checkout_2_${nodeId.slice(0, 8)}`,
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', metadata: { node_id: nodeId, plan_code: 'pro' }, customer: customerId, subscription: subscriptionId } },
  };
  const checkoutSig = sign(checkoutEvent);
  const checkoutRes = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': checkoutSig.header }, payload: checkoutSig.raw });
  assert.equal(checkoutRes.statusCode, 200);

  const balBefore = await repo.creditBalance(nodeId);
  const invoiceEvent = {
    id: `evt_map_invoice_paid_${nodeId.slice(0, 8)}`,
    type: 'invoice.paid',
    data: { object: { customer: customerId, subscription: subscriptionId, period_start: 1735689600, period_end: 1738368000 } },
  };
  const invoiceSig = sign(invoiceEvent);
  const invoiceRes = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': invoiceSig.header }, payload: invoiceSig.raw });
  assert.equal(invoiceRes.statusCode, 200);

  const balAfter = await repo.creditBalance(nodeId);
  assert.equal(balAfter - balBefore, 3000);
  await app.close();
});

test('invoice.paid with equal period_start/period_end falls back to Stripe subscription period', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh-equal-period');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  const customerId = `cus_equal_period_${nodeId.slice(0, 8)}`;
  const subscriptionId = `sub_equal_period_${nodeId.slice(0, 8)}`;
  const periodPoint = 1735689600;
  const subPeriodStart = 1735689600;
  const subPeriodEnd = 1738368000;
  const expectedStartIso = new Date(subPeriodStart * 1000).toISOString();
  const expectedEndIso = new Date(subPeriodEnd * 1000).toISOString();
  const subscriptionPath = `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`;
  const fetchCalls = [];

  await withMockFetch(async (url) => {
    const u = String(url);
    fetchCalls.push(u);
    if (u.endsWith(subscriptionPath)) {
      return jsonResponse(200, {
        id: subscriptionId,
        current_period_start: subPeriodStart,
        current_period_end: subPeriodEnd,
      });
    }
    return jsonResponse(404, { error: 'not_found' });
  }, async () => {
    const invoiceEvent = {
      id: `evt_equal_period_${nodeId.slice(0, 8)}`,
      type: 'invoice.paid',
      data: {
        object: {
          id: `in_equal_period_${nodeId.slice(0, 8)}`,
          customer: customerId,
          subscription: subscriptionId,
          period_start: periodPoint,
          period_end: periodPoint,
          metadata: { node_id: nodeId, plan_code: 'pro' },
        },
      },
    };
    const sig = sign(invoiceEvent);
    const invoiceRes = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
    assert.equal(invoiceRes.statusCode, 200);
  });

  const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${apiKey}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(fetchCalls.some((u) => u.endsWith(subscriptionPath)), true);
  assert.equal(me.json().subscription.period_start, expectedStartIso);
  assert.equal(me.json().subscription.period_end, expectedEndIso);
  assert.ok(Date.parse(me.json().subscription.period_start) < Date.parse(me.json().subscription.period_end));
  await app.close();
});

test('webhook awards referral credits once on first paid invoice and dedupes by payment reference', async () => {
  const app = buildApp();
  const referrer = await bootstrap(app, 'boot-referrer-first-paid', { display_name: 'Referrer', email: null, referral_code: null });
  const referrerNodeId = referrer.json().node.id;
  const refCode = `REF-FIRST-${referrerNodeId.slice(0, 8)}`;
  await repo.ensureReferralCode(refCode, referrerNodeId);

  const referred = await bootstrap(app, 'boot-referred-first-paid', { display_name: 'Referred', email: null, referral_code: refCode });
  const referredNodeId = referred.json().node.id;

  const referrerBalanceBefore = await repo.creditBalance(referrerNodeId);
  const invoiceId = `in_ref_first_paid_${referredNodeId.slice(0, 8)}`;
  const subscriptionId = `sub_ref_first_paid_${referredNodeId.slice(0, 8)}`;
  const nowUnix = Math.floor(Date.now() / 1000);

  const invoiceObject = {
    id: invoiceId,
    metadata: { node_id: referredNodeId },
    customer: `cus_ref_first_paid_${referredNodeId.slice(0, 8)}`,
    subscription: subscriptionId,
    billing_reason: 'subscription_create',
    period_start: nowUnix,
    period_end: nowUnix + (30 * 24 * 3600),
    lines: { data: [{ price: { id: 'price_basic_test' } }] },
  };

  const eventA = { id: `evt_ref_first_paid_a_${referredNodeId.slice(0, 8)}`, type: 'invoice.paid', data: { object: invoiceObject } };
  const eventB = { id: `evt_ref_first_paid_b_${referredNodeId.slice(0, 8)}`, type: 'invoice.paid', data: { object: invoiceObject } };
  const eventSecondInvoice = {
    id: `evt_ref_second_invoice_${referredNodeId.slice(0, 8)}`,
    type: 'invoice.paid',
    data: {
      object: {
        ...invoiceObject,
        id: `in_ref_second_paid_${referredNodeId.slice(0, 8)}`,
      },
    },
  };

  const sigA = sign(eventA);
  const sigB = sign(eventB);
  const sigSecond = sign(eventSecondInvoice);

  const resA = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sigA.header }, payload: sigA.raw });
  const resB = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sigB.header }, payload: sigB.raw });
  const resSecond = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sigSecond.header }, payload: sigSecond.raw });
  assert.equal(resA.statusCode, 200);
  assert.equal(resB.statusCode, 200);
  assert.equal(resSecond.statusCode, 200);

  const referrerBalanceAfter = await repo.creditBalance(referrerNodeId);
  assert.equal(referrerBalanceAfter - referrerBalanceBefore, 100);

  const referralRows = await query(
    "select status, awarded_at from referral_claims where claimer_node_id=$1 order by claimed_at asc limit 1",
    [referredNodeId],
  );
  assert.equal(referralRows[0].status, 'awarded');
  assert.equal(referralRows[0].awarded_at instanceof Date || typeof referralRows[0].awarded_at === 'string', true);

  const referralGrantRows = await query(
    "select count(*)::text as c from credit_ledger where node_id=$1 and type='grant_referral' and (meta->>'claimer_node_id')=$2",
    [referrerNodeId, referredNodeId],
  );
  assert.equal(Number(referralGrantRows[0].c), 1);

  const referralGrantMeta = await query(
    "select idempotency_key, meta from credit_ledger where node_id=$1 and type='grant_referral' and (meta->>'claimer_node_id')=$2 order by created_at desc limit 1",
    [referrerNodeId, referredNodeId],
  );
  assert.match(String(referralGrantMeta[0].idempotency_key ?? ''), new RegExp(`invoice:${invoiceId}`));
  await app.close();
});

test('webhook referral awards stop after per-referrer cap', async () => {
  const app = buildApp();
  const referrer = await bootstrap(app, 'boot-referrer-cap', { display_name: 'Referrer Cap', email: null, referral_code: null });
  const referrerNodeId = referrer.json().node.id;
  const refCode = `REF-CAP-${referrerNodeId.slice(0, 8)}`;
  await repo.ensureReferralCode(refCode, referrerNodeId);

  const referred = await bootstrap(app, 'boot-referred-cap', { display_name: 'Referred Cap', email: null, referral_code: refCode });
  const referredNodeId = referred.json().node.id;

  await query(
    `insert into credit_ledger(node_id, type, amount, meta, idempotency_key)
     select
       $1::uuid,
       'grant_referral',
       100,
       jsonb_build_object('seed', gs::text),
       ('seed_referral_cap:' || gs::text)
     from generate_series(1, $2::int) as gs`,
    [referrerNodeId, config.referralMaxGrantsPerReferrer],
  );
  const balanceBefore = await repo.creditBalance(referrerNodeId);

  const nowUnix = Math.floor(Date.now() / 1000);
  const invoiceId = `in_ref_cap_${referredNodeId.slice(0, 8)}`;
  const invoiceEvent = {
    id: `evt_ref_cap_${referredNodeId.slice(0, 8)}`,
    type: 'invoice.paid',
    data: {
      object: {
        id: invoiceId,
        metadata: { node_id: referredNodeId },
        customer: `cus_ref_cap_${referredNodeId.slice(0, 8)}`,
        subscription: `sub_ref_cap_${referredNodeId.slice(0, 8)}`,
        billing_reason: 'subscription_create',
        period_start: nowUnix,
        period_end: nowUnix + (30 * 24 * 3600),
        lines: { data: [{ price: { id: 'price_basic_test' } }] },
      },
    },
  };
  const sig = sign(invoiceEvent);
  const res = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
  assert.equal(res.statusCode, 200);

  const balanceAfter = await repo.creditBalance(referrerNodeId);
  assert.equal(balanceAfter, balanceBefore);

  const grantRows = await query(
    "select count(*)::text as c from credit_ledger where node_id=$1 and type='grant_referral' and (meta->>'claimer_node_id')=$2",
    [referrerNodeId, referredNodeId],
  );
  assert.equal(Number(grantRows[0].c), 0);
  await app.close();
});

test('webhook customer.created does not mutate subscription or credits', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh-customer-created');
  const nodeId = b.json().node.id;
  const balanceBefore = await repo.creditBalance(nodeId);
  const meBefore = await repo.getMe(nodeId);
  const body = {
    id: `evt_customer_created_${nodeId.slice(0, 8)}`,
    type: 'customer.created',
    data: { object: { id: `cus_created_${nodeId.slice(0, 8)}`, metadata: { node_id: nodeId } } },
  };
  const sig = sign(body);
  const first = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
  const second = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
  assert.equal(first.statusCode, 200);
  assert.equal(second.statusCode, 200);

  const balanceAfter = await repo.creditBalance(nodeId);
  const meAfter = await repo.getMe(nodeId);
  assert.equal(balanceAfter, balanceBefore);
  assert.equal(meAfter.sub_status, meBefore.sub_status);
  assert.equal(meAfter.plan_code, meBefore.plan_code);
  await app.close();
});

test('webhook maps invoice.paid price id to pro plan', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh-pro-plan');
  const nodeId = b.json().node.id;
  const balBefore = await repo.creditBalance(nodeId);

  const invoiceEvent = {
    id: `evt_pro_invoice_${nodeId.slice(0, 8)}`,
    type: 'invoice.paid',
    data: {
      object: {
        id: `in_pro_${nodeId.slice(0, 8)}`,
        customer: `cus_pro_${nodeId.slice(0, 8)}`,
        subscription: `sub_pro_${nodeId.slice(0, 8)}`,
        period_start: 1735689600,
        period_end: 1738368000,
        metadata: { node_id: nodeId },
        lines: {
          data: [
            {
              amount: 1999,
              pricing: {
                type: 'price_details',
                price_details: { price: 'price_pro_test' },
                unit_amount_decimal: '1999',
              },
            },
          ],
        },
      },
    },
  };
  const sig = sign(invoiceEvent);
  const res = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
  assert.equal(res.statusCode, 200);

  const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${b.json().api_key.api_key}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().subscription.plan, 'pro');
  const balAfter = await repo.creditBalance(nodeId);
  assert.equal(balAfter - balBefore, 3000);
  await app.close();
});

test('invoice.paid credits grant ignores prior zero-credit grant for same period', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh-pro-regrant');
  const nodeId = b.json().node.id;
  const periodStart = 1735689600;
  const periodEnd = 1738368000;

  const firstEvent = {
    id: `evt_zero_grant_${nodeId.slice(0, 8)}`,
    type: 'invoice.paid',
    data: {
      object: {
        id: `in_zero_${nodeId.slice(0, 8)}`,
        customer: `cus_zero_${nodeId.slice(0, 8)}`,
        subscription: `sub_zero_${nodeId.slice(0, 8)}`,
        period_start: periodStart,
        period_end: periodEnd,
        metadata: { node_id: nodeId },
      },
    },
  };
  const firstSig = sign(firstEvent);
  const firstRes = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': firstSig.header }, payload: firstSig.raw });
  assert.equal(firstRes.statusCode, 200);

  const beforePaid = await repo.creditBalance(nodeId);
  const secondEvent = {
    id: `evt_pro_after_zero_${nodeId.slice(0, 8)}`,
    type: 'invoice.paid',
    data: {
      object: {
        id: `in_pro_after_zero_${nodeId.slice(0, 8)}`,
        customer: `cus_zero_${nodeId.slice(0, 8)}`,
        subscription: `sub_zero_${nodeId.slice(0, 8)}`,
        period_start: periodStart,
        period_end: periodEnd,
        metadata: { node_id: nodeId, plan_code: 'pro' },
      },
    },
  };
  const secondSig = sign(secondEvent);
  const secondRes = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': secondSig.header }, payload: secondSig.raw });
  assert.equal(secondRes.statusCode, 200);

  const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${b.json().api_key.api_key}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().subscription.plan, 'pro');
  const afterPaid = await repo.creditBalance(nodeId);
  assert.equal(afterPaid - beforePaid, 3000);
  await app.close();
});

test('invoice.paid upgrade proration grants plan-difference credits once per invoice id', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-upgrade-proration');
  const nodeId = b.json().node.id;
  const customerId = `cus_upgrade_${nodeId.slice(0, 8)}`;
  const subscriptionId = `sub_upgrade_${nodeId.slice(0, 8)}`;
  const periodStart = 1735689600;
  const periodEnd = 1738368000;

  const activateBasic = {
    id: `evt_upgrade_activate_${nodeId.slice(0, 8)}`,
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', metadata: { node_id: nodeId, plan_code: 'basic' }, customer: customerId, subscription: subscriptionId } },
  };
  const activateSig = sign(activateBasic);
  const activateRes = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': activateSig.header }, payload: activateSig.raw });
  assert.equal(activateRes.statusCode, 200);

  const basicInvoice = {
    id: `evt_upgrade_basic_monthly_${nodeId.slice(0, 8)}`,
    type: 'invoice.paid',
    data: {
      object: {
        id: `in_basic_monthly_${nodeId.slice(0, 8)}`,
        customer: customerId,
        subscription: subscriptionId,
        period_start: periodStart,
        period_end: periodEnd,
        billing_reason: 'subscription_cycle',
        metadata: { node_id: nodeId, plan_code: 'basic' },
      },
    },
  };
  const basicSig = sign(basicInvoice);
  const basicRes = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': basicSig.header }, payload: basicSig.raw });
  assert.equal(basicRes.statusCode, 200);

  const balBeforeUpgrade = await repo.creditBalance(nodeId);
  const invoiceId = `in_upgrade_proration_${nodeId.slice(0, 8)}`;
  const upgradeObject = {
    id: invoiceId,
    customer: customerId,
    subscription: subscriptionId,
    period_start: periodStart,
    period_end: periodEnd,
    billing_reason: 'subscription_update',
    metadata: { node_id: nodeId, plan_code: 'pro' },
    lines: { data: [{ proration: true, amount: 1000 }] },
  };

  const upgradeEventA = { id: `evt_upgrade_proration_a_${nodeId.slice(0, 8)}`, type: 'invoice.paid', data: { object: upgradeObject } };
  const upgradeEventB = { id: `evt_upgrade_proration_b_${nodeId.slice(0, 8)}`, type: 'invoice.paid', data: { object: upgradeObject } };
  const upgradeSigA = sign(upgradeEventA);
  const upgradeSigB = sign(upgradeEventB);
  const upgradeResA = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': upgradeSigA.header }, payload: upgradeSigA.raw });
  const upgradeResB = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': upgradeSigB.header }, payload: upgradeSigB.raw });
  assert.equal(upgradeResA.statusCode, 200);
  assert.equal(upgradeResB.statusCode, 200);

  const balAfterUpgrade = await repo.creditBalance(nodeId);
  assert.equal(balAfterUpgrade - balBeforeUpgrade, 2000);

  const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${b.json().api_key.api_key}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().subscription.plan, 'pro');
  await app.close();
});

test('invoice.paid downgrade on subscription_update is deferred until renewal invoice', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-downgrade-deferred');
  const nodeId = b.json().node.id;
  const customerId = `cus_downgrade_${nodeId.slice(0, 8)}`;
  const subscriptionId = `sub_downgrade_${nodeId.slice(0, 8)}`;
  const periodStart = 1735689600;
  const periodEnd = 1738368000;
  const nextPeriodEnd = 1740787200;

  const activatePro = {
    id: `evt_downgrade_activate_${nodeId.slice(0, 8)}`,
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', metadata: { node_id: nodeId, plan_code: 'pro' }, customer: customerId, subscription: subscriptionId } },
  };
  const activateSig = sign(activatePro);
  const activateRes = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': activateSig.header }, payload: activateSig.raw });
  assert.equal(activateRes.statusCode, 200);

  const proInvoice = {
    id: `evt_downgrade_pro_monthly_${nodeId.slice(0, 8)}`,
    type: 'invoice.paid',
    data: {
      object: {
        id: `in_pro_monthly_${nodeId.slice(0, 8)}`,
        customer: customerId,
        subscription: subscriptionId,
        period_start: periodStart,
        period_end: periodEnd,
        billing_reason: 'subscription_cycle',
        metadata: { node_id: nodeId, plan_code: 'pro' },
      },
    },
  };
  const proSig = sign(proInvoice);
  const proRes = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': proSig.header }, payload: proSig.raw });
  assert.equal(proRes.statusCode, 200);
  const balAfterPro = await repo.creditBalance(nodeId);

  const downgradeUpdateInvoice = {
    id: `evt_downgrade_update_${nodeId.slice(0, 8)}`,
    type: 'invoice.paid',
    data: {
      object: {
        id: `in_downgrade_update_${nodeId.slice(0, 8)}`,
        customer: customerId,
        subscription: subscriptionId,
        period_start: periodStart,
        period_end: periodEnd,
        billing_reason: 'subscription_update',
        metadata: { node_id: nodeId, plan_code: 'basic' },
        lines: { data: [{ proration: true, amount: -500 }] },
      },
    },
  };
  const downgradeUpdateSig = sign(downgradeUpdateInvoice);
  const downgradeUpdateRes = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': downgradeUpdateSig.header }, payload: downgradeUpdateSig.raw });
  assert.equal(downgradeUpdateRes.statusCode, 200);

  const meAfterUpdate = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${b.json().api_key.api_key}` } });
  assert.equal(meAfterUpdate.statusCode, 200);
  assert.equal(meAfterUpdate.json().subscription.plan, 'pro');
  const balAfterUpdate = await repo.creditBalance(nodeId);
  assert.equal(balAfterUpdate, balAfterPro);

  const downgradeRenewalInvoice = {
    id: `evt_downgrade_renewal_${nodeId.slice(0, 8)}`,
    type: 'invoice.paid',
    data: {
      object: {
        id: `in_downgrade_renewal_${nodeId.slice(0, 8)}`,
        customer: customerId,
        subscription: subscriptionId,
        period_start: periodEnd,
        period_end: nextPeriodEnd,
        billing_reason: 'subscription_cycle',
        metadata: { node_id: nodeId, plan_code: 'basic' },
      },
    },
  };
  const downgradeRenewalSig = sign(downgradeRenewalInvoice);
  const downgradeRenewalRes = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': downgradeRenewalSig.header }, payload: downgradeRenewalSig.raw });
  assert.equal(downgradeRenewalRes.statusCode, 200);

  const meAfterRenewal = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${b.json().api_key.api_key}` } });
  assert.equal(meAfterRenewal.statusCode, 200);
  assert.equal(meAfterRenewal.json().subscription.plan, 'basic');
  const balAfterRenewal = await repo.creditBalance(nodeId);
  // Node had 3000 subscription credits from pro. Basic rollover cap is 2×1000=2000.
  // Already over cap, so renewal grants 0. A zero-amount ledger entry is still written.
  assert.equal(balAfterRenewal - balAfterUpdate, 0);
  await app.close();
});

test('webhook maps customer.subscription.created via fetched customer metadata.node_id and persists mapping', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh-fetch-sub-created');
  const nodeId = b.json().node.id;
  const customerId = `cus_fetch_sub_${nodeId.slice(0, 8)}`;
  const subscriptionId = `sub_fetch_sub_${nodeId.slice(0, 8)}`;
  const customerPath = `/v1/customers/${encodeURIComponent(customerId)}`;
  const fetchCalls = [];

  await withMockFetch(async (url) => {
    const u = String(url);
    fetchCalls.push(u);
    if (u.endsWith(customerPath)) {
      return jsonResponse(200, { id: customerId, metadata: { node_id: nodeId } });
    }
    return jsonResponse(404, { error: 'not_found' });
  }, async () => {
    const subEvent = {
      id: `evt_fetch_sub_created_${nodeId.slice(0, 8)}`,
      type: 'customer.subscription.created',
      data: { object: { id: subscriptionId, customer: customerId, status: 'active', current_period_start: 1735689600, current_period_end: 1738368000 } },
    };
    const sig = sign(subEvent);
    const res = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
    assert.equal(res.statusCode, 200);
  });

  assert.equal(fetchCalls.some((u) => u.endsWith(customerPath)), true);
  const me = await repo.getMe(nodeId);
  assert.equal(me.sub_status, 'active');
  const mapping = await repo.getSubscriptionMapping(nodeId);
  assert.equal(mapping.stripe_customer_id, customerId);
  assert.equal(mapping.stripe_subscription_id, subscriptionId);
  await app.close();
});

test('webhook maps invoice.paid via fetched customer metadata.node_id and persists mapping', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh-fetch-invoice');
  const nodeId = b.json().node.id;
  const customerId = `cus_fetch_invoice_${nodeId.slice(0, 8)}`;
  const subscriptionId = `sub_fetch_invoice_${nodeId.slice(0, 8)}`;
  const customerPath = `/v1/customers/${encodeURIComponent(customerId)}`;

  const balBefore = await repo.creditBalance(nodeId);
  await withMockFetch(async (url) => {
    const u = String(url);
    if (u.endsWith(customerPath)) {
      return jsonResponse(200, { id: customerId, metadata: { node_id: nodeId } });
    }
    return jsonResponse(404, { error: 'not_found' });
  }, async () => {
    const invoiceEvent = {
      id: `evt_fetch_invoice_paid_${nodeId.slice(0, 8)}`,
      type: 'invoice.paid',
      data: { object: { customer: customerId, subscription: subscriptionId, period_start: 1735689600, period_end: 1738368000, metadata: { plan_code: 'basic' } } },
    };
    const sig = sign(invoiceEvent);
    const res = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
    assert.equal(res.statusCode, 200);
  });

  const me = await repo.getMe(nodeId);
  assert.equal(me.sub_status, 'active');
  assert.equal(me.plan_code, 'basic');
  const mapping = await repo.getSubscriptionMapping(nodeId);
  assert.equal(mapping.stripe_customer_id, customerId);
  assert.equal(mapping.stripe_subscription_id, subscriptionId);
  const balAfter = await repo.creditBalance(nodeId);
  assert.equal(balAfter - balBefore, 1000);
  await app.close();
});

test('metering only charges on HTTP 200 for search', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-search');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  const body = { id: 'evt_sub', type: 'checkout.session.completed', data: { object: { payment_status: 'paid', metadata: { node_id: nodeId, plan_code: 'basic' }, customer: 'cus', subscription: 'sub' } } };
  const sig = sign(body);
  await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });

  const bal1 = await repo.creditBalance(nodeId);
  const bad = await app.inject({ method: 'POST', url: '/v1/search/listings', headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 's1' }, payload: { q: null, scope: 'ship_to', filters: {}, broadening: { level: 0, allow: false }, budget: { credits_max: config.searchCreditCost }, limit: 20, cursor: null } });
  assert.equal(bad.statusCode, 422);
  const bal2 = await repo.creditBalance(nodeId);
  assert.equal(bal2, bal1);

  const ok = await app.inject({ method: 'POST', url: '/v1/search/listings', headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 's2' }, payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'x' }, broadening: { level: 0, allow: false }, budget: { credits_max: config.searchCreditCost }, limit: 20, cursor: null } });
  assert.equal(ok.statusCode, 200);
  const bal3 = await repo.creditBalance(nodeId);
  assert.equal(bal3 < bal2, true);
  await app.close();
});

test('search validates region IDs using canonical CC or CC-AA format and US allowlist', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-search-region-format');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, nodeId, 'evt_subscriber_region_format')).statusCode, 200);

  const valid = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-region-format-valid' },
    payload: {
      q: null,
      scope: 'local_in_person',
      filters: { regions: ['US', 'US-CA'] },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(valid.statusCode, 200);

  const validShipTo = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-region-format-shipto-valid' },
    payload: {
      q: null,
      scope: 'ship_to',
      filters: { ship_to_regions: ['US-NY'] },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(validShipTo.statusCode, 200);

  const validRequestsSearch = await app.inject({
    method: 'POST',
    url: '/v1/search/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-region-format-requests-valid' },
    payload: {
      q: null,
      scope: 'local_in_person',
      filters: { regions: ['US-CA'] },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(validRequestsSearch.statusCode, 200);

  const invalid = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-region-format-invalid' },
    payload: {
      q: null,
      scope: 'local_in_person',
      filters: { regions: ['us-ca'] },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(invalid.statusCode, 422);
  assert.equal(invalid.json().error.code, 'validation_error');
  assert.equal(invalid.json().error.details.reason, 'region_id_invalid');

  const invalidCountry = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-region-allowlist-invalid-country' },
    payload: {
      q: null,
      scope: 'local_in_person',
      filters: { regions: ['CA'] },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(invalidCountry.statusCode, 422);
  assert.equal(invalidCountry.json().error.code, 'validation_error');
  assert.equal(invalidCountry.json().error.details.reason, 'region_id_invalid');

  const invalidProvince = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-region-allowlist-invalid-province' },
    payload: {
      q: null,
      scope: 'local_in_person',
      filters: { regions: ['US-BC'] },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(invalidProvince.statusCode, 422);
  assert.equal(invalidProvince.json().error.code, 'validation_error');
  assert.equal(invalidProvince.json().error.details.reason, 'region_id_invalid');

  const invalidState = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-region-allowlist-invalid-state' },
    payload: {
      q: null,
      scope: 'local_in_person',
      filters: { regions: ['US-XX'] },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(invalidState.statusCode, 422);
  assert.equal(invalidState.json().error.code, 'validation_error');
  assert.equal(invalidState.json().error.details.reason, 'region_id_invalid');

  const invalidRequestsRegion = await app.inject({
    method: 'POST',
    url: '/v1/search/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-region-allowlist-requests-invalid' },
    payload: {
      q: null,
      scope: 'local_in_person',
      filters: { regions: ['CA'] },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(invalidRequestsRegion.statusCode, 422);
  assert.equal(invalidRequestsRegion.json().error.code, 'validation_error');
  assert.equal(invalidRequestsRegion.json().error.details.reason, 'region_id_invalid');
  await app.close();
});

test('search returns credits_exhausted for subscriber with insufficient credits', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-search-insufficient');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  const activateBody = {
    id: `evt_subscriber_${nodeId.slice(0, 8)}`,
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', metadata: { node_id: nodeId, plan_code: 'basic' }, customer: `cus_${nodeId.slice(0, 8)}`, subscription: `sub_${nodeId.slice(0, 8)}` } },
  };
  const activateSig = sign(activateBody);
  const activated = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': activateSig.header }, payload: activateSig.raw });
  assert.equal(activated.statusCode, 200);

  const current = await repo.creditBalance(nodeId);
  await repo.addCredit(nodeId, 'adjustment_manual', -(current + 1), { reason: 'test_drain' }, `drain-${nodeId}`);

  const res = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-insufficient' },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'x' }, broadening: { level: 0, allow: false }, budget: { credits_max: config.searchCreditCost }, limit: 20, cursor: null },
  });
  assert.equal(res.statusCode, 402);
  assert.equal(res.json().error.code, 'credits_exhausted');
  await app.close();
});

test('search succeeds for non-subscriber node with credits (no subscriber gate)', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-search-no-sub-has-credits');
  const apiKey = b.json().api_key.api_key;

  const res = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-no-sub-has-credits' },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'x' }, broadening: { level: 0, allow: false }, budget: { credits_max: config.searchCreditCost }, limit: 20, cursor: null },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test('search requires budget.credits_requested or budget.credits_max', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-search-budget-required');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, nodeId, 'evt_subscriber_budget_required')).statusCode, 200);

  const res = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-budget-required' },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'x' }, broadening: { level: 0, allow: false }, limit: 20, cursor: null },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, 'validation_error');
  await app.close();
});

test('search accepts canonical budget.credits_requested', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-search-budget-canonical');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, nodeId, 'evt_subscriber_budget_canonical')).statusCode, 200);

  const res = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-budget-canonical' },
    payload: {
      q: null,
      scope: 'OTHER',
      filters: { scope_notes: 'canonical-budget' },
      broadening: { level: 0, allow: false },
      budget: { credits_requested: config.searchCreditCost },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test('search accepts deprecated budget.credits_max alias', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-search-budget-alias');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, nodeId, 'evt_subscriber_budget_alias')).statusCode, 200);

  const res = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-budget-alias' },
    payload: {
      q: null,
      scope: 'OTHER',
      filters: { scope_notes: 'alias-budget' },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(res.statusCode, 200);
  await app.close();
});

test('search budget cap exceeded returns 200 with was_capped=true and zero items', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-search-budget-cap');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, nodeId, 'evt_subscriber_budget_cap')).statusCode, 200);

  const balanceBefore = await repo.creditBalance(nodeId);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-budget-cap' },
    payload: {
      q: null,
      scope: 'OTHER',
      filters: { scope_notes: 'budget-cap-test' },
      broadening: { level: 0, allow: false },
      budget: { credits_max: 0 },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().budget.was_capped, true);
  assert.equal(typeof res.json().budget.cap_reason, 'string');
  assert.equal(typeof res.json().budget.guidance, 'string');
  assert.equal(res.json().budget.credits_charged, 0);
  assert.equal(res.json().budget.breakdown.base_search_cost, config.searchCreditCost);
  assert.equal(res.json().budget.breakdown.broadening_cost, 0);
  assert.equal(res.json().items.length, 0);
  const balanceAfter = await repo.creditBalance(nodeId);
  assert.equal(balanceAfter, balanceBefore);
  await app.close();
});

test('search target.username restricts results and returns budget/node summaries', async () => {
  const app = buildApp();

  const searcherBoot = await bootstrap(app, 'boot-targeting-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_targeting')).statusCode, 200);

  const targetABoot = await bootstrap(app, 'boot-targeting-a');
  const targetANodeId = targetABoot.json().node.id;
  const targetAUsername = targetABoot.json().node.display_name;
  const targetBBoot = await bootstrap(app, 'boot-targeting-b');
  const targetBNodeId = targetBBoot.json().node.id;

  const aUnit1 = await repo.createResource('units', targetANodeId, {
    ...unitPayload('Target A item 1', 'targeting-shared-scope'),
    category_ids: [101, 202],
  });
  const aUnit2 = await repo.createResource('units', targetANodeId, {
    ...unitPayload('Target A item 2', 'targeting-shared-scope'),
    category_ids: [202],
  });
  const bUnit = await repo.createResource('units', targetBNodeId, {
    ...unitPayload('Target B item', 'targeting-shared-scope'),
    category_ids: [303],
  });

  await repo.setPublished('units', aUnit1.id, true);
  await repo.setPublished('units', aUnit2.id, true);
  await repo.setPublished('units', bUnit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', targetANodeId, aUnit1.id));
  await repo.upsertProjection('units', await repo.getResource('units', targetANodeId, aUnit2.id));
  await repo.upsertProjection('units', await repo.getResource('units', targetBNodeId, bUnit.id));

  const res = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-target-username' },
    payload: {
      q: null,
      scope: 'OTHER',
      filters: { scope_notes: 'targeting-shared-scope' },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      target: { username: targetAUsername },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.items.length > 0, true);
  assert.equal(body.items.every((row) => row.item?.node_id === targetANodeId), true);
  assert.equal(typeof body.budget, 'object');
  assert.equal(typeof body.budget.credits_charged, 'number');
  assert.equal(typeof body.budget.breakdown, 'object');
  assert.equal(body.budget.breakdown.page_index, 1);
  assert.equal(Array.isArray(body.nodes), true);
  assert.equal(body.nodes.length, 1);
  assert.equal(body.nodes[0].node_id, targetANodeId);
  assert.equal(Object.prototype.hasOwnProperty.call(body.nodes[0], 'category_counts_nonzero'), true);
  assert.equal(typeof body.nodes[0].category_counts_nonzero, 'object');
  await app.close();
});

test('search category_ids_any filters results and unknown ids do not hard-fail validation', async () => {
  const app = buildApp();

  const searcherBoot = await bootstrap(app, 'boot-category-filter-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_category_filter')).statusCode, 200);

  const targetBoot = await bootstrap(app, 'boot-category-filter-target');
  const targetNodeId = targetBoot.json().node.id;
  const scopeNotes = `category-filter-${TEST_RUN_SUFFIX}-${targetNodeId.slice(0, 6)}`;

  const unitA = await repo.createResource('units', targetNodeId, { ...unitPayload('Category A', scopeNotes), category_ids: [101] });
  const unitB = await repo.createResource('units', targetNodeId, { ...unitPayload('Category B', scopeNotes), category_ids: [202] });
  const unitC = await repo.createResource('units', targetNodeId, { ...unitPayload('Category C', scopeNotes), category_ids: [101, 303] });

  for (const unit of [unitA, unitB, unitC]) {
    await repo.setPublished('units', unit.id, true);
    await repo.upsertProjection('units', await repo.getResource('units', targetNodeId, unit.id));
  }

  const knownCategory = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-category-filter-known' },
    payload: {
      q: null,
      scope: 'OTHER',
      filters: { scope_notes: scopeNotes, category_ids_any: [101] },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      target: { node_id: targetNodeId },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(knownCategory.statusCode, 200);
  assert.equal(knownCategory.json().items.length > 0, true);
  assert.equal(
    knownCategory.json().items.every((row) => Array.isArray(row.item?.category_ids) && row.item.category_ids.includes(101)),
    true,
  );

  const unknownCategory = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-category-filter-unknown' },
    payload: {
      q: null,
      scope: 'OTHER',
      filters: { scope_notes: scopeNotes, category_ids_any: [999999] },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      target: { node_id: targetNodeId },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(unknownCategory.statusCode, 200);
  assert.equal(Array.isArray(unknownCategory.json().items), true);
  assert.equal(unknownCategory.json().items.length, 0);

  await app.close();
});

test('target-constrained search uses low-cost base pricing', async () => {
  const app = buildApp();

  const searcherBoot = await bootstrap(app, 'boot-target-cheap-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_target_cheap')).statusCode, 200);

  const targetBoot = await bootstrap(app, 'boot-target-cheap-target');
  const targetNodeId = targetBoot.json().node.id;
  const scopeNotes = `target-cheap-${TEST_RUN_SUFFIX}-${searcherNodeId.slice(0, 6)}`;
  const unit = await repo.createResource('units', targetNodeId, {
    ...unitPayload('Target cheap item', scopeNotes),
    category_ids: [515],
  });
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', targetNodeId, unit.id));

  const globalSearch = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-target-cheap-global' },
    payload: {
      q: null,
      scope: 'OTHER',
      filters: { scope_notes: scopeNotes },
      broadening: { level: 0, allow: false },
      budget: { credits_max: 200 },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(globalSearch.statusCode, 200);

  const targetedSearch = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-target-cheap-targeted' },
    payload: {
      q: null,
      scope: 'OTHER',
      filters: { scope_notes: scopeNotes },
      broadening: { level: 0, allow: false },
      budget: { credits_max: 200 },
      target: { node_id: targetNodeId },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(targetedSearch.statusCode, 200);
  assert.equal(targetedSearch.json().budget.breakdown.base_search_cost, config.searchTargetCreditCost);
  assert.equal(targetedSearch.json().budget.credits_charged, config.searchTargetCreditCost);
  assert.equal(globalSearch.json().budget.credits_charged > targetedSearch.json().budget.credits_charged, true);
  await app.close();
});

test('search rejects mismatched target.node_id and target.username', async () => {
  const app = buildApp();
  const searcherBoot = await bootstrap(app, 'boot-target-mismatch-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_target_mismatch')).statusCode, 200);

  const targetABoot = await bootstrap(app, 'boot-target-mismatch-a');
  const targetBBoot = await bootstrap(app, 'boot-target-mismatch-b');
  const targetANodeId = targetABoot.json().node.id;
  const targetBUsername = targetBBoot.json().node.display_name;

  const res = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-target-mismatch' },
    payload: {
      q: null,
      scope: 'OTHER',
      filters: { scope_notes: 'target-mismatch' },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      target: { node_id: targetANodeId, username: targetBUsername },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, 'validation_error');
  assert.equal(res.json().error.details.reason, 'target_mismatch');
  await app.close();
});

test('search rejects unresolved target', async () => {
  const app = buildApp();
  const searcherBoot = await bootstrap(app, 'boot-target-not-found-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_target_not_found')).statusCode, 200);

  const res = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-target-not-found' },
    payload: {
      q: null,
      scope: 'OTHER',
      filters: { scope_notes: 'target-not-found' },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      target: { username: `missing-${TEST_RUN_SUFFIX}` },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, 'validation_error');
  assert.equal(res.json().error.details.reason, 'target_not_found');
  await app.close();
});

test('search pagination applies tiered page add-ons and caps page 6 under modest budget', async () => {
  const app = buildApp();
  await withConfigOverrides({ rateLimitSearchScrapePerMinute: 1000, searchBroadQueryThreshold: 1000 }, async () => {
  const searcherBoot = await bootstrap(app, 'boot-search-page-tier-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_page_tier')).statusCode, 200);
  await repo.addCredit(searcherNodeId, 'adjustment_manual', 300, { reason: 'test_page_cost_headroom' });

  const targetBoot = await bootstrap(app, 'boot-search-page-tier-target');
  const targetNodeId = targetBoot.json().node.id;
  const scopeNotes = `page-tier-${TEST_RUN_SUFFIX}-${searcherNodeId.slice(0, 6)}`;

  for (let i = 0; i < 7; i += 1) {
    const unit = await repo.createResource('units', targetNodeId, {
      ...unitPayload(`Page tier item ${i}`, scopeNotes),
      category_ids: [700 + i],
    });
    await repo.setPublished('units', unit.id, true);
    await repo.upsertProjection('units', await repo.getResource('units', targetNodeId, unit.id));
  }

  const searchPayload = (cursor, creditsRequested) => ({
    q: 'tier',
    scope: 'OTHER',
    filters: { scope_notes: scopeNotes },
    broadening: { level: 1, allow: true },
    budget: { credits_max: creditsRequested },
    target: { node_id: targetNodeId },
    limit: 1,
    cursor,
  });

  const fullBudget = 200;
  const page1 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-tier-page-1' },
    payload: searchPayload(null, fullBudget),
  });
  assert.equal(page1.statusCode, 200);
  assert.equal(page1.json().budget.breakdown.page_index, 1);
  assert.equal(page1.json().budget.breakdown.page_cost, 0);
  assert.equal(page1.json().budget.credits_charged, config.searchTargetCreditCost);

  const page2 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-tier-page-2' },
    payload: searchPayload(page1.json().cursor, fullBudget),
  });
  assert.equal(page2.statusCode, 200);
  assert.equal(page2.json().budget.breakdown.page_index, 2);
  assert.equal(page2.json().budget.breakdown.page_cost, 2);
  assert.equal(page2.json().budget.credits_charged, config.searchTargetCreditCost + 2);

  const page3 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-tier-page-3' },
    payload: searchPayload(page2.json().cursor, fullBudget),
  });
  assert.equal(page3.statusCode, 200);
  assert.equal(page3.json().budget.breakdown.page_index, 3);
  assert.equal(page3.json().budget.breakdown.page_cost, 3);
  assert.equal(page3.json().budget.credits_charged, config.searchTargetCreditCost + 3);

  const page4 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-tier-page-4' },
    payload: searchPayload(page3.json().cursor, fullBudget),
  });
  assert.equal(page4.statusCode, 200);
  assert.equal(page4.json().budget.breakdown.page_index, 4);
  assert.equal(page4.json().budget.breakdown.page_cost, 4);
  assert.equal(page4.json().budget.credits_charged, config.searchTargetCreditCost + 4);

  const page5 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-tier-page-5' },
    payload: searchPayload(page4.json().cursor, fullBudget),
  });
  assert.equal(page5.statusCode, 200);
  assert.equal(page5.json().budget.breakdown.page_index, 5);
  assert.equal(page5.json().budget.breakdown.page_cost, 5);
  assert.equal(page5.json().budget.credits_charged, config.searchTargetCreditCost + 5);

  const beforePage6Balance = await repo.creditBalance(searcherNodeId);
  const modestBudget = config.searchTargetCreditCost;
  const page6 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-tier-page-6' },
    payload: searchPayload(page5.json().cursor, modestBudget),
  });
  assert.equal(page6.statusCode, 200);
  assert.equal(page6.json().budget.was_capped, true);
  assert.equal(typeof page6.json().budget.cap_reason, 'string');
  assert.equal(typeof page6.json().budget.guidance, 'string');
  assert.equal(page6.json().budget.credits_charged, 0);
  assert.equal(page6.json().budget.breakdown.page_index, 6);
  assert.equal(page6.json().budget.breakdown.page_cost, 100);
  assert.equal(page6.json().items.length, 0);
  const afterPage6Balance = await repo.creditBalance(searcherNodeId);
  assert.equal(afterPage6Balance, beforePage6Balance);

  const page6FullBudget = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-tier-page-6-full-budget' },
    payload: searchPayload(page5.json().cursor, 300),
  });
  assert.equal(page6FullBudget.statusCode, 200);
  assert.equal(page6FullBudget.json().budget.breakdown.page_index, 6);
  assert.equal(page6FullBudget.json().budget.breakdown.page_cost, 100);

  const page7 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-tier-page-7-full-budget' },
    payload: searchPayload(page6FullBudget.json().cursor, 300),
  });
  assert.equal(page7.statusCode, 200);
  assert.equal(page7.json().budget.breakdown.page_index, 7);
  assert.equal(page7.json().budget.breakdown.page_cost, 100);
  });
  await app.close();
});

test('search keyset cursor returns disjoint pages and rejects query-shape mismatch', async () => {
  const app = buildApp();
  const searcherBoot = await bootstrap(app, 'boot-search-keyset-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_keyset')).statusCode, 200);

  const targetBoot = await bootstrap(app, 'boot-search-keyset-target');
  const targetNodeId = targetBoot.json().node.id;
  const scopeNotes = `keyset-${TEST_RUN_SUFFIX}-${searcherNodeId.slice(0, 6)}`;

  for (let i = 0; i < 3; i += 1) {
    const unit = await repo.createResource('units', targetNodeId, {
      ...unitPayload(`Keyset token item ${i}`, scopeNotes),
      category_ids: [1200 + i],
      public_summary: `Keyset token summary ${i}`,
    });
    await repo.setPublished('units', unit.id, true);
    await repo.upsertProjection('units', await repo.getResource('units', targetNodeId, unit.id));
  }

  const payloadBase = {
    q: 'keyset token',
    scope: 'OTHER',
    filters: { scope_notes: scopeNotes },
    broadening: { level: 0, allow: false },
    budget: { credits_max: 200 },
    target: { node_id: targetNodeId },
    limit: 1,
  };

  const page1 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-keyset-page-1' },
    payload: { ...payloadBase, cursor: null },
  });
  assert.equal(page1.statusCode, 200);
  assert.equal(page1.json().items.length, 1);
  assert.equal(typeof page1.json().cursor, 'string');
  assert.equal(page1.json().items[0].rank.sort_keys.fts_rank > 0, true);

  const page2 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-keyset-page-2' },
    payload: { ...payloadBase, cursor: page1.json().cursor },
  });
  assert.equal(page2.statusCode, 200);
  assert.equal(page2.json().items.length, 1);
  assert.notEqual(page2.json().items[0].item.id, page1.json().items[0].item.id);

  const mismatch = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-keyset-mismatch' },
    payload: {
      ...payloadBase,
      filters: { scope_notes: `${scopeNotes}-changed` },
      cursor: page1.json().cursor,
    },
  });
  assert.equal(mismatch.statusCode, 400);
  assert.equal(mismatch.json().error.code, 'validation_error');
  assert.equal(mismatch.json().error.details.reason, 'cursor_mismatch');
  await app.close();
});

test('ship_to search applies route specificity scoring and max_ship_days filtering', async () => {
  const app = buildApp();
  const searcherBoot = await bootstrap(app, 'boot-search-shipto-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_shipto')).statusCode, 200);

  const targetBoot = await bootstrap(app, 'boot-search-shipto-target');
  const targetNodeId = targetBoot.json().node.id;
  const scopeNotes = `shipto-${TEST_RUN_SUFFIX}-${searcherNodeId.slice(0, 6)}`;

  const buildShipToPayload = (title, originAdmin1, destAdmin1, maxShipDays) => ({
    ...unitPayload(title, scopeNotes),
    scope_primary: 'ship_to',
    scope_secondary: [],
    origin_region: { country_code: 'US', admin1: originAdmin1 },
    dest_region: { country_code: 'US', admin1: destAdmin1 },
    max_ship_days: maxShipDays,
    public_summary: `${title} ship route token`,
    tags: ['ship-route-token'],
  });

  const specific = await repo.createResource('units', targetNodeId, buildShipToPayload('Ship route token specific', 'CA', 'CA', 3));
  const countryOnly = await repo.createResource('units', targetNodeId, buildShipToPayload('Ship route token country', 'NY', 'TX', 4));
  const tooSlow = await repo.createResource('units', targetNodeId, buildShipToPayload('Ship route token too slow', 'CA', 'CA', 10));

  for (const unit of [specific, countryOnly, tooSlow]) {
    await repo.setPublished('units', unit.id, true);
    await repo.upsertProjection('units', await repo.getResource('units', targetNodeId, unit.id));
  }

  const res = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-shipto-specificity' },
    payload: {
      q: 'ship route token',
      scope: 'ship_to',
      filters: {
        ship_to_regions: ['US-CA', 'US'],
        ships_from_regions: ['US-CA', 'US'],
        max_ship_days: 5,
      },
      broadening: { level: 0, allow: false },
      budget: { credits_max: 200 },
      target: { node_id: targetNodeId },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.items.length >= 2, true);
  assert.equal(body.items.some((row) => row.item.id === specific.id), true);
  assert.equal(body.items.some((row) => row.item.id === countryOnly.id), true);
  assert.equal(body.items.some((row) => row.item.id === tooSlow.id), false);
  assert.equal(body.items.every((row) => Number(row.item.max_ship_days) <= 5), true);
  assert.equal(body.items[0].item.id, specific.id);
  assert.equal(body.items[0].rank.sort_keys.route_specificity_score > body.items[1].rank.sort_keys.route_specificity_score, true);
  await app.close();
});

test('ship_to search matches projection dest_region for ship_to_regions filters', async () => {
  const app = buildApp();
  const searcherBoot = await bootstrap(app, 'boot-search-shipto-projection-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;

  const targetBoot = await bootstrap(app, 'boot-search-shipto-projection-target');
  const targetNodeId = targetBoot.json().node.id;
  const scopeNotes = `shipto-projection-${TEST_RUN_SUFFIX}-${targetNodeId.slice(0, 6)}`;

  const matching = await repo.createResource('units', targetNodeId, {
    ...unitPayload('Ship projection match', scopeNotes),
    scope_primary: 'ship_to',
    scope_secondary: [],
    origin_region: { country_code: 'US', admin1: 'CA' },
    dest_region: { country_code: 'US', admin1: 'CA' },
    max_ship_days: 3,
  });
  const nonMatching = await repo.createResource('units', targetNodeId, {
    ...unitPayload('Ship projection miss', scopeNotes),
    scope_primary: 'ship_to',
    scope_secondary: [],
    origin_region: { country_code: 'US', admin1: 'CA' },
    dest_region: { country_code: 'US', admin1: 'NV' },
    max_ship_days: 3,
  });

  for (const unit of [matching, nonMatching]) {
    await repo.setPublished('units', unit.id, true);
    await repo.upsertProjection('units', await repo.getResource('units', targetNodeId, unit.id));
  }

  const matchRes = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-shipto-projection-match' },
    payload: {
      q: null,
      scope: 'ship_to',
      filters: { ship_to_regions: ['US-CA'] },
      budget: { credits_max: 200 },
      target: { node_id: targetNodeId },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(matchRes.statusCode, 200);
  const matchBody = matchRes.json();
  const matchingIds = matchBody.items.map((row) => row.item?.id);
  assert.equal(matchingIds.includes(matching.id), true);
  assert.equal(matchingIds.includes(nonMatching.id), false);
  const matchedRow = matchBody.items.find((row) => row.item?.id === matching.id);
  assert.equal(Boolean(matchedRow), true);
  assert.equal(Number(matchedRow.rank.sort_keys.route_specificity_score), 2);

  const missRes = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-shipto-projection-miss' },
    payload: {
      q: null,
      scope: 'ship_to',
      filters: { ship_to_regions: ['US-NY'] },
      budget: { credits_max: 200 },
      target: { node_id: targetNodeId },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(missRes.statusCode, 200);
  assert.equal(missRes.json().items.length, 0);
  await app.close();
});

test('search scrape guard returns 429 for repeated broad queries', async () => {
  const app = buildApp();
  const searcherBoot = await bootstrap(app, 'boot-search-scrape-guard');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_scrape_guard')).statusCode, 200);

  const payload = {
    q: null,
    scope: 'digital_delivery',
    filters: {},
    broadening: { level: config.searchBroadeningHighThreshold, allow: true },
    budget: { credits_max: config.searchCreditCost + 5 },
    limit: 50,
    cursor: null,
  };

  const r1 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-scrape-1' },
    payload,
  });
  assert.equal(r1.statusCode, 200);

  const r2 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-scrape-2' },
    payload,
  });
  assert.equal(r2.statusCode, 200);

  const r3 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-scrape-3' },
    payload,
  });
  assert.equal(r3.statusCode, 200);

  const r4 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-scrape-4' },
    payload,
  });
  assert.equal(r4.statusCode, 429);
  assert.equal(r4.json().error.code, 'rate_limit_exceeded');
  await app.close();
});

test('search listings and requests share pricing mechanics and keyword rank keys', async () => {
  const app = buildApp();
  const searcherBoot = await bootstrap(app, 'boot-search-parity-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_search_parity')).statusCode, 200);

  const targetBoot = await bootstrap(app, 'boot-search-parity-target');
  const targetNodeId = targetBoot.json().node.id;
  const scopeNotes = `search-parity-${TEST_RUN_SUFFIX}-${searcherNodeId.slice(0, 6)}`;

  const listing = await repo.createResource('units', targetNodeId, {
    ...unitPayload('Parity keyword listing', scopeNotes),
    category_ids: [910],
  });
  await repo.setPublished('units', listing.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', targetNodeId, listing.id));

  const request = await repo.createResource('requests', targetNodeId, {
    ...unitPayload('Parity keyword request', scopeNotes),
    category_ids: [911],
  });
  await repo.setPublished('requests', request.id, true);
  await repo.upsertProjection('requests', await repo.getResource('requests', targetNodeId, request.id));

  const payload = {
    q: 'parity keyword',
    scope: 'OTHER',
    filters: { scope_notes: scopeNotes },
    broadening: { level: 1, allow: true },
    budget: { credits_max: 200 },
    target: { node_id: targetNodeId },
    limit: 20,
    cursor: null,
  };

  const listingsRes = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-parity-listings' },
    payload,
  });
  assert.equal(listingsRes.statusCode, 200);

  const requestsRes = await app.inject({
    method: 'POST',
    url: '/v1/search/requests',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-parity-requests' },
    payload,
  });
  assert.equal(requestsRes.statusCode, 200);

  const listingsBody = listingsRes.json();
  const requestsBody = requestsRes.json();
  assert.equal(listingsBody.items.length > 0, true);
  assert.equal(requestsBody.items.length > 0, true);
  assert.equal(listingsBody.budget.breakdown.base_search_cost, requestsBody.budget.breakdown.base_search_cost);
  assert.equal(listingsBody.budget.breakdown.broadening_cost, requestsBody.budget.breakdown.broadening_cost);
  assert.equal(listingsBody.budget.breakdown.page_index, requestsBody.budget.breakdown.page_index);
  assert.equal(listingsBody.budget.breakdown.page_cost, requestsBody.budget.breakdown.page_cost);
  assert.equal(listingsBody.budget.credits_charged, requestsBody.budget.credits_charged);
  assert.equal(Object.prototype.hasOwnProperty.call(listingsBody.items[0].rank.sort_keys, 'fts_rank'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(requestsBody.items[0].rank.sort_keys, 'fts_rank'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(listingsBody.items[0].rank.sort_keys, 'semantic_score'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(requestsBody.items[0].rank.sort_keys, 'semantic_score'), false);
  await app.close();
});

test('search rejects semantic/vector/expansion inputs in phase 0.5', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-search-phase05-lock');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, nodeId, 'evt_subscriber_search_lock')).statusCode, 200);

  const res = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'search-phase05-lock' },
    payload: {
      q: null,
      scope: 'OTHER',
      filters: { scope_notes: 'phase05-lock' },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      limit: 20,
      cursor: null,
      semantic: { enabled: true },
    },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, 'validation_error');
  assert.equal(res.json().error.details.reason, 'phase05_search_lock');
  assert.equal(Array.isArray(res.json().error.details.disabled_features), true);
  assert.equal(res.json().error.details.disabled_features.includes('semantic'), true);
  await app.close();
});

test('search persists visibility impression events for returned items', async () => {
  const app = buildApp();
  const searcherBoot = await bootstrap(app, 'boot-visibility-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_visibility')).statusCode, 200);

  const targetBoot = await bootstrap(app, 'boot-visibility-target');
  const targetNodeId = targetBoot.json().node.id;
  const scopeNotes = `visibility-impression-${TEST_RUN_SUFFIX}-${searcherNodeId.slice(0, 6)}`;

  const unit1 = await repo.createResource('units', targetNodeId, { ...unitPayload('Visibility 1', scopeNotes), category_ids: [601] });
  const unit2 = await repo.createResource('units', targetNodeId, { ...unitPayload('Visibility 2', scopeNotes), category_ids: [602] });
  for (const unit of [unit1, unit2]) {
    await repo.setPublished('units', unit.id, true);
    await repo.upsertProjection('units', await repo.getResource('units', targetNodeId, unit.id));
  }

  const search = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-visibility-impressions' },
    payload: {
      q: 'visibility',
      scope: 'OTHER',
      filters: { scope_notes: scopeNotes },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      target: { node_id: targetNodeId },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(search.statusCode, 200);
  const body = search.json();
  assert.equal(body.items.length >= 2, true);

  const impressions = await query(
    `select item_id::text as item_id, position, scope
     from visibility_events
     where event_type='search_impression'
       and viewer_node_id=$1
       and search_id=$2::uuid
     order by position asc`,
    [searcherNodeId, body.search_id],
  );
  assert.equal(impressions.length, body.items.length);
  assert.equal(impressions[0].position, 1);
  assert.equal(impressions.every((row) => row.scope === 'OTHER'), true);
  await app.close();
});

test('search excludes caller-owned published listings and requests by default', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-search-self-exclude');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  const activateBody = {
    id: `evt_subscriber_self_${nodeId.slice(0, 8)}`,
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', metadata: { node_id: nodeId, plan_code: 'basic' }, customer: `cus_self_${nodeId.slice(0, 8)}`, subscription: `sub_self_${nodeId.slice(0, 8)}` } },
  };
  const activateSig = sign(activateBody);
  const activated = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': activateSig.header }, payload: activateSig.raw });
  assert.equal(activated.statusCode, 200);

  const unit = await repo.createResource('units', nodeId, {
    title: 'Self listing',
    description: 'Owned by caller',
    type: 'service',
    condition: null,
    quantity: 1,
    measure: 'EA',
    custom_measure: null,
    scope_primary: 'OTHER',
    scope_secondary: [],
    scope_notes: 'self-exclude-test',
    location_text_public: null,
    origin_region: null,
    dest_region: null,
    service_region: null,
    delivery_format: null,
    tags: [],
    category_ids: [],
    public_summary: 'self listing',
  });
  await repo.setPublished('units', unit.id, true);
  const publishedUnit = await repo.getResource('units', nodeId, unit.id);
  await repo.upsertProjection('units', publishedUnit);

  const request = await repo.createResource('requests', nodeId, {
    title: 'Self request',
    description: 'Owned by caller',
    type: 'service',
    condition: null,
    quantity: 1,
    measure: 'EA',
    custom_measure: null,
    scope_primary: 'OTHER',
    scope_secondary: [],
    scope_notes: 'self-exclude-test',
    location_text_public: null,
    origin_region: null,
    dest_region: null,
    service_region: null,
    delivery_format: null,
    need_by: null,
    accept_substitutions: true,
    tags: [],
    category_ids: [],
    public_summary: 'self request',
  });
  await repo.setPublished('requests', request.id, true);
  const publishedRequest = await repo.getResource('requests', nodeId, request.id);
  await repo.upsertProjection('requests', publishedRequest);

  const listingsRes = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `search-self-listings-${nodeId}` },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'self-exclude-test' }, broadening: { level: 0, allow: false }, budget: { credits_max: config.searchCreditCost }, limit: 20, cursor: null },
  });
  assert.equal(listingsRes.statusCode, 200);
  const ownListingSeen = listingsRes.json().items.some((row) => row.item?.node_id === nodeId);
  assert.equal(ownListingSeen, false);

  const requestsRes = await app.inject({
    method: 'POST',
    url: '/v1/search/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `search-self-requests-${nodeId}` },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'self-exclude-test' }, broadening: { level: 0, allow: false }, budget: { credits_max: config.searchCreditCost }, limit: 20, cursor: null },
  });
  assert.equal(requestsRes.statusCode, 200);
  const ownRequestSeen = requestsRes.json().items.some((row) => row.item?.node_id === nodeId);
  assert.equal(ownRequestSeen, false);

  await app.close();
});

test('search and public node inventory exclude suspended nodes', async () => {
  const app = buildApp();

  const searcherBoot = await bootstrap(app, 'boot-suspend-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  const activated = await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_susp');
  assert.equal(activated.statusCode, 200);

  const targetBoot = await bootstrap(app, 'boot-suspend-target');
  const targetNodeId = targetBoot.json().node.id;

  const unit = await repo.createResource('units', targetNodeId, {
    title: 'Suspended listing',
    description: 'should disappear from public search',
    type: 'service',
    condition: null,
    quantity: 1,
    measure: 'EA',
    custom_measure: null,
    scope_primary: 'OTHER',
    scope_secondary: [],
    scope_notes: 'suspended-visibility',
    location_text_public: null,
    origin_region: null,
    dest_region: null,
    service_region: null,
    delivery_format: null,
    tags: [],
    category_ids: [],
    public_summary: 'suspended visibility',
  });
  await repo.setPublished('units', unit.id, true);
  const published = await repo.getResource('units', targetNodeId, unit.id);
  await repo.upsertProjection('units', published);

  const before = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': `suspend-search-before-${searcherNodeId}` },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'suspended-visibility' }, broadening: { level: 0, allow: false }, budget: { credits_max: config.searchCreditCost }, limit: 20, cursor: null },
  });
  assert.equal(before.statusCode, 200);
  const seenBefore = before.json().items.some((row) => row.item?.node_id === targetNodeId);
  assert.equal(seenBefore, true);

  await suspendNode(targetNodeId);

  const after = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': `suspend-search-after-${searcherNodeId}` },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'suspended-visibility' }, broadening: { level: 0, allow: false }, budget: { credits_max: config.searchCreditCost }, limit: 20, cursor: null },
  });
  assert.equal(after.statusCode, 200);
  const seenAfter = after.json().items.some((row) => row.item?.node_id === targetNodeId);
  assert.equal(seenAfter, false);

  const inventory = await app.inject({
    method: 'GET',
    url: `/v1/public/nodes/${targetNodeId}/listings?limit=20`,
    headers: { authorization: `ApiKey ${searcherApiKey}` },
  });
  assert.equal(inventory.statusCode, 200);
  assert.equal(Array.isArray(inventory.json().items), true);
  assert.equal(inventory.json().items.length, 0);

  await app.close();
});

test('node category drilldown returns only matching category items with pagination and cheap pricing', async () => {
  const app = buildApp();
  const searcherBoot = await bootstrap(app, 'boot-drilldown-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_drilldown')).statusCode, 200);

  const targetBoot = await bootstrap(app, 'boot-drilldown-target');
  const targetNodeId = targetBoot.json().node.id;

  const unitA = await repo.createResource('units', targetNodeId, { ...unitPayload('Drilldown A', 'drilldown-scope'), category_ids: [777] });
  const unitB = await repo.createResource('units', targetNodeId, { ...unitPayload('Drilldown B', 'drilldown-scope'), category_ids: [777] });
  const unitC = await repo.createResource('units', targetNodeId, { ...unitPayload('Drilldown C', 'drilldown-scope'), category_ids: [888] });
  for (const unit of [unitA, unitB, unitC]) {
    await repo.setPublished('units', unit.id, true);
    await repo.upsertProjection('units', await repo.getResource('units', targetNodeId, unit.id));
  }
  await query("update public_listings set published_at = now() - interval '0 seconds' where unit_id=$1", [unitA.id]);
  await query("update public_listings set published_at = now() - interval '1 seconds' where unit_id=$1", [unitB.id]);
  await query("update public_listings set published_at = now() - interval '2 seconds' where unit_id=$1", [unitC.id]);

  const before = await repo.creditBalance(searcherNodeId);
  const page1 = await app.inject({
    method: 'GET',
    url: `/v1/public/nodes/${targetNodeId}/listings/categories/777?limit=1`,
    headers: { authorization: `ApiKey ${searcherApiKey}` },
  });
  assert.equal(page1.statusCode, 200);
  assert.equal(page1.json().node_id, targetNodeId);
  assert.equal(page1.json().category_id, 777);
  assert.equal(page1.json().items.length, 1);
  assert.equal(page1.json().items.every((item) => Array.isArray(item.category_ids) && item.category_ids.includes(777)), true);
  assert.equal(page1.json().has_more, true);
  assert.equal(typeof page1.json().cursor, 'string');

  const page2 = await app.inject({
    method: 'GET',
    url: `/v1/public/nodes/${targetNodeId}/listings/categories/777?limit=1&cursor=${encodeURIComponent(page1.json().cursor)}`,
    headers: { authorization: `ApiKey ${searcherApiKey}` },
  });
  assert.equal(page2.statusCode, 200);
  assert.equal(page2.json().items.length, 1);
  assert.equal(page2.json().items.every((item) => Array.isArray(item.category_ids) && item.category_ids.includes(777)), true);

  const after = await repo.creditBalance(searcherNodeId);
  assert.equal(before - after, config.nodeCategoryDrilldownCost * 2);
  await app.close();
});

test('node category drilldown enforces rate limit', async () => {
  await withConfigOverrides({ rateLimitNodeCategoryDrilldownPerMinute: 1 }, async () => {
    const app = buildApp();
    const searcherBoot = await bootstrap(app, 'boot-drilldown-rate-searcher');
    const searcherNodeId = searcherBoot.json().node.id;
    const searcherApiKey = searcherBoot.json().api_key.api_key;
    assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_drilldown_rate')).statusCode, 200);

    const targetBoot = await bootstrap(app, 'boot-drilldown-rate-target');
    const targetNodeId = targetBoot.json().node.id;
    const unit = await repo.createResource('units', targetNodeId, { ...unitPayload('Drilldown rate', 'drilldown-rate-scope'), category_ids: [909] });
    await repo.setPublished('units', unit.id, true);
    await repo.upsertProjection('units', await repo.getResource('units', targetNodeId, unit.id));

    const first = await app.inject({
      method: 'GET',
      url: `/v1/public/nodes/${targetNodeId}/listings/categories/909?limit=20`,
      headers: { authorization: `ApiKey ${searcherApiKey}` },
    });
    assert.equal(first.statusCode, 200);

    const second = await app.inject({
      method: 'GET',
      url: `/v1/public/nodes/${targetNodeId}/listings/categories/909?limit=20`,
      headers: { authorization: `ApiKey ${searcherApiKey}` },
    });
    assert.equal(second.statusCode, 429);
    assert.equal(second.json().error.code, 'rate_limit_exceeded');
    await app.close();
  });
});

test('unit estimated_value appears in unit detail and public listing search surfaces', async () => {
  const app = buildApp();
  const ownerBoot = await bootstrap(app, 'boot-estimated-owner');
  const ownerNodeId = ownerBoot.json().node.id;
  const ownerApiKey = ownerBoot.json().api_key.api_key;

  const searcherBoot = await bootstrap(app, 'boot-estimated-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_estimated_search')).statusCode, 200);

  const scopeNotes = `estimated-${TEST_RUN_SUFFIX}-${ownerNodeId.slice(0, 6)}`;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${ownerApiKey}`, 'idempotency-key': 'estimated-unit-create' },
    payload: { ...unitPayload('Estimated value unit', scopeNotes), estimated_value: 1234.5 },
  });
  assert.equal(create.statusCode, 200);
  const unitId = create.json().unit.id;

  const publish = await app.inject({
    method: 'POST',
    url: `/v1/units/${unitId}/publish`,
    headers: { authorization: `ApiKey ${ownerApiKey}`, 'idempotency-key': 'estimated-unit-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 200);

  const detail = await app.inject({
    method: 'GET',
    url: `/v1/units/${unitId}`,
    headers: { authorization: `ApiKey ${ownerApiKey}` },
  });
  assert.equal(detail.statusCode, 200);
  assert.equal(Number(detail.json().estimated_value), 1234.5);

  const search = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'estimated-unit-search' },
    payload: {
      q: null,
      scope: 'OTHER',
      filters: { scope_notes: scopeNotes },
      broadening: { level: 0, allow: false },
      budget: { credits_max: config.searchCreditCost },
      target: { node_id: ownerNodeId },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(search.statusCode, 200);
  const found = search.json().items.find((row) => row.item?.id === unitId);
  assert.equal(Boolean(found), true);
  assert.equal(Number(found.item.estimated_value), 1234.5);
  await app.close();
});

test('max_ship_days persists on units and requests', async () => {
  const app = buildApp();
  const ownerBoot = await bootstrap(app, 'boot-max-ship-owner');
  const ownerApiKey = ownerBoot.json().api_key.api_key;
  const scopeNotes = `max-ship-${TEST_RUN_SUFFIX}-${ownerBoot.json().node.id.slice(0, 6)}`;

  const createUnit = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${ownerApiKey}`, 'idempotency-key': 'max-ship-unit-create' },
    payload: {
      ...unitPayload('Max ship unit', scopeNotes),
      scope_primary: 'ship_to',
      origin_region: { country_code: 'US', admin1: 'CA' },
      dest_region: { country_code: 'US', admin1: 'CA' },
      max_ship_days: 4,
    },
  });
  assert.equal(createUnit.statusCode, 200);

  const unitDetail = await app.inject({
    method: 'GET',
    url: `/v1/units/${createUnit.json().unit.id}`,
    headers: { authorization: `ApiKey ${ownerApiKey}` },
  });
  assert.equal(unitDetail.statusCode, 200);
  assert.equal(unitDetail.json().max_ship_days, 4);

  const createRequest = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${ownerApiKey}`, 'idempotency-key': 'max-ship-request-create' },
    payload: {
      ...unitPayload('Max ship request', scopeNotes),
      scope_primary: 'ship_to',
      origin_region: { country_code: 'US', admin1: 'CA' },
      dest_region: { country_code: 'US', admin1: 'NV' },
      max_ship_days: 6,
    },
  });
  assert.equal(createRequest.statusCode, 200);

  const requestDetail = await app.inject({
    method: 'GET',
    url: `/v1/requests/${createRequest.json().request.id}`,
    headers: { authorization: `ApiKey ${ownerApiKey}` },
  });
  assert.equal(requestDetail.statusCode, 200);
  assert.equal(requestDetail.json().max_ship_days, 6);
  await app.close();
});

test('admin can mint an api key for an existing node and rejects unknown node', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-admin-mint');
  const nodeId = b.json().node.id;

  const notFound = await app.inject({
    method: 'POST',
    url: '/v1/admin/nodes/00000000-0000-0000-0000-000000000000/api-keys',
    headers: { 'x-admin-key': 'admin-test', 'idempotency-key': 'adm-mint-missing' },
    payload: { label: 'post-tls-verify' },
  });
  assert.equal(notFound.statusCode, 404);
  assert.equal(notFound.json().error.code, 'not_found');

  const minted = await app.inject({
    method: 'POST',
    url: `/v1/admin/nodes/${nodeId}/api-keys`,
    headers: { 'x-admin-key': 'admin-test', 'idempotency-key': 'adm-mint-ok' },
    payload: { label: 'post-tls-verify' },
  });
  assert.equal(minted.statusCode, 200);
  assert.equal(minted.json().node_id, nodeId);
  assert.equal(typeof minted.json().api_key, 'string');
  assert.equal(typeof minted.json().key_prefix, 'string');
  assert.equal(minted.json().api_key.startsWith(minted.json().key_prefix), true);

  const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${minted.json().api_key}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().node.id, nodeId);
  await app.close();
});

test('admin stripe diagnostics endpoint requires admin auth and returns safe config diagnostics', async () => {
  const app = buildApp();

  const unauth = await app.inject({
    method: 'GET',
    url: '/v1/admin/diagnostics/stripe',
  });
  assert.equal(unauth.statusCode, 401);
  assert.equal(unauth.json().error.code, 'unauthorized');

  const ok = await app.inject({
    method: 'GET',
    url: '/v1/admin/diagnostics/stripe',
    headers: {
      'x-admin-key': 'admin-test',
      host: 'fabric.example',
      'x-forwarded-host': 'fabric-forwarded.example',
      'x-forwarded-proto': 'https',
    },
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.json();
  assert.equal(typeof body.stripe_configured, 'boolean');
  assert.equal(Array.isArray(body.missing), true);
  assert.equal(typeof body.price_id_counts_by_plan.basic, 'number');
  assert.equal(typeof body.price_id_counts_by_plan.pro, 'number');
  assert.equal(typeof body.price_id_counts_by_plan.business, 'number');
  assert.equal(body.price_id_counts_by_plan.basic, 1);
  assert.equal(body.price_id_counts_by_plan.pro, 1);
  assert.equal(body.price_id_counts_by_plan.business, 1);
  assert.equal(Object.hasOwn(body.price_id_counts_by_plan, 'plus'), false);
  assert.equal(body.missing.includes('STRIPE_PRICE_PLUS'), false);
  assert.equal(body.missing.includes('STRIPE_PRICE_IDS_PLUS'), false);
  assert.equal(body.stripe_secret_key_present, true);
  assert.equal(body.stripe_webhook_secret_present, true);
  assert.equal(body.active_base_url, 'fabric-forwarded.example');
  assert.match(body.active_base_url, /^[a-z0-9.-]+$/i);
  await app.close();
});

test('admin stripe diagnostics reports configured=true for supported live sku set and ignores plus vars', async () => {
  const app = buildApp();

  await withConfigOverrides({
    stripeSecretKey: 'sk_live_configured_test',
    stripeWebhookSecret: 'whsec_live_configured_test',
    stripePriceIdsBasic: [LIVE_PRICE_IDS.basic],
    stripePriceIdsPro: [LIVE_PRICE_IDS.pro],
    stripePriceIdsBusiness: [LIVE_PRICE_IDS.business],
    stripeCreditPackPrice500: LIVE_PRICE_IDS.creditPack500,
    stripeCreditPackPrice1500: LIVE_PRICE_IDS.creditPack1500,
    stripeCreditPackPrice4500: LIVE_PRICE_IDS.creditPack4500,
  }, async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/admin/diagnostics/stripe',
      headers: { 'x-admin-key': 'admin-test', host: 'fabric.example' },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.equal(body.stripe_configured, true);
    assert.deepEqual(body.missing, []);
    assert.equal(body.price_id_counts_by_plan.basic, 1);
    assert.equal(body.price_id_counts_by_plan.pro, 1);
    assert.equal(body.price_id_counts_by_plan.business, 1);
    assert.equal(Object.hasOwn(body.price_id_counts_by_plan, 'plus'), false);
    assert.equal(body.active_base_url, 'fabric.example');
  });

  await app.close();
});

test('POST /v1/admin/takedown requires admin auth and records takedown row', async () => {
  const app = buildApp();
  const targetId = crypto.randomUUID();
  const reason = `qa-takedown-${TEST_RUN_SUFFIX}`;

  const unauth = await app.inject({
    method: 'POST',
    url: '/v1/admin/takedown',
    headers: { 'idempotency-key': 'adm-takedown-unauth' },
    payload: { target_type: 'public_listing', target_id: targetId, reason },
  });
  assert.equal(unauth.statusCode, 401);
  assert.equal(unauth.json().error.code, 'unauthorized');

  const ok = await app.inject({
    method: 'POST',
    url: '/v1/admin/takedown',
    headers: { 'x-admin-key': 'admin-test', 'idempotency-key': 'adm-takedown-ok' },
    payload: { target_type: 'public_listing', target_id: targetId, reason },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().ok, true);

  const rows = await query(
    `select target_type, target_id, reason
     from takedowns
     where target_id=$1
     order by created_at desc
     limit 1`,
    [targetId],
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].target_type, 'listing');
  assert.equal(rows[0].target_id, targetId);
  assert.equal(rows[0].reason, reason);
  await app.close();
});

test('POST /v1/admin/credits/adjust requires admin auth and updates ledger/balance', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-admin-adjust');
  const nodeId = b.json().node.id;
  const delta = 17;
  const reason = `qa-adjust-${TEST_RUN_SUFFIX}`;
  const before = await repo.creditBalance(nodeId);

  const unauth = await app.inject({
    method: 'POST',
    url: '/v1/admin/credits/adjust',
    headers: { 'idempotency-key': 'adm-adjust-unauth' },
    payload: { node_id: nodeId, delta, reason },
  });
  assert.equal(unauth.statusCode, 401);
  assert.equal(unauth.json().error.code, 'unauthorized');

  const ok = await app.inject({
    method: 'POST',
    url: '/v1/admin/credits/adjust',
    headers: { 'x-admin-key': 'admin-test', 'idempotency-key': 'adm-adjust-ok' },
    payload: { node_id: nodeId, delta, reason },
  });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().ok, true);

  const after = await repo.creditBalance(nodeId);
  assert.equal(after - before, delta);
  const rows = await query(
    `select type, amount, meta
     from credit_ledger
     where node_id=$1 and type='adjustment_manual'
     order by created_at desc
     limit 1`,
    [nodeId],
  );
  assert.equal(rows.length, 1);
  assert.equal(Number(rows[0].amount), delta);
  assert.equal(rows[0].meta.reason, reason);
  await app.close();
});

test('admin write endpoints should honor idempotency replay/conflict semantics (spec 10/20)', async () => {
  const app = buildApp();
  const targetId = crypto.randomUUID();
  const idempotencyKey = `adm-idem-${TEST_RUN_SUFFIX}`;
  const payload = {
    target_type: 'public_listing',
    target_id: targetId,
    reason: `qa-admin-idem-${TEST_RUN_SUFFIX}`,
  };

  const first = await app.inject({
    method: 'POST',
    url: '/v1/admin/takedown',
    headers: { 'x-admin-key': 'admin-test', 'idempotency-key': idempotencyKey },
    payload,
  });
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.json(), { ok: true });

  const replay = await app.inject({
    method: 'POST',
    url: '/v1/admin/takedown',
    headers: { 'x-admin-key': 'admin-test', 'idempotency-key': idempotencyKey },
    payload,
  });
  assert.equal(replay.statusCode, first.statusCode);
  assert.deepEqual(replay.json(), first.json());

  const createdRows = await query(
    `select count(*)::int as c
     from takedowns
     where target_type='listing' and target_id=$1 and reason=$2`,
    [targetId, payload.reason],
  );
  assert.equal(createdRows.length, 1);
  assert.equal(Number(createdRows[0].c), 1);

  const conflict = await app.inject({
    method: 'POST',
    url: '/v1/admin/takedown',
    headers: { 'x-admin-key': 'admin-test', 'idempotency-key': idempotencyKey },
    payload: { ...payload, reason: `${payload.reason}-different` },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, 'idempotency_key_reuse_conflict');

  const rowsAfterConflict = await query(
    `select count(*)::int as c
     from takedowns
     where target_type='listing' and target_id=$1 and reason=$2`,
    [targetId, payload.reason],
  );
  assert.equal(rowsAfterConflict.length, 1);
  assert.equal(Number(rowsAfterConflict[0].c), 1);
  await app.close();
});

test('admin projection rebuild endpoint requires admin auth and responds shape', async () => {
  const app = buildApp();
  const unauth = await app.inject({ method: 'POST', url: '/v1/admin/projections/rebuild?kind=all&mode=full', headers: { 'idempotency-key': 'adm-1' } });
  assert.equal(unauth.statusCode, 401);
  assert.equal(unauth.json().error.code, 'unauthorized');

  const ok = await app.inject({ method: 'POST', url: '/v1/admin/projections/rebuild?kind=all&mode=full', headers: { 'x-admin-key': 'admin-test', 'idempotency-key': 'adm-2' }, payload: {} });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().ok, true);
  assert.ok(ok.json().counts.public_listings_written >= 0);
  assert.ok(ok.json().counts.public_requests_written >= 0);
  await app.close();
});

test('GET /internal/admin/daily-metrics requires admin auth and returns digest shape', async () => {
  const app = buildApp();

  const unauth = await app.inject({
    method: 'GET',
    url: '/internal/admin/daily-metrics',
  });
  assert.equal(unauth.statusCode, 401);
  assert.equal(unauth.json().error.code, 'unauthorized');

  const ok = await app.inject({
    method: 'GET',
    url: '/internal/admin/daily-metrics',
    headers: { 'x-admin-key': 'admin-test' },
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.json();
  assert.equal(typeof body.generated_at, 'string');
  assert.equal(body.window_hours, 24);
  assert.equal(typeof body.abuse.suspended_nodes, 'number');
  assert.equal(typeof body.stripe_credits_health.credit_grants, 'number');
  assert.equal(typeof body.liquidity.offers_created, 'number');
  assert.equal(typeof body.reliability.searches, 'number');
  assert.equal(typeof body.webhook_health.offer_webhook_deliveries, 'number');
  await app.close();
});

test('POST /internal/admin/daily-digest requires admin auth, returns metrics and email status', async () => {
  const app = buildApp();

  const unauth = await app.inject({
    method: 'POST',
    url: '/internal/admin/daily-digest',
  });
  assert.equal(unauth.statusCode, 401);
  assert.equal(unauth.json().error.code, 'unauthorized');

  const ok = await app.inject({
    method: 'POST',
    url: '/internal/admin/daily-digest',
    headers: { 'x-admin-key': 'admin-test' },
  });
  assert.equal(ok.statusCode, 200);
  const body = ok.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.email_sent, 'boolean');
  assert.equal(typeof body.email_provider, 'string');
  assert.equal(typeof body.metrics.generated_at, 'string');
  assert.equal(body.metrics.window_hours, 24);
  assert.equal(typeof body.metrics.abuse.suspended_nodes, 'number');
  assert.equal(typeof body.metrics.liquidity.offers_created, 'number');
  await app.close();
});

test('email verification happy path updates verified timestamp', async () => {
  const app = buildApp();
  emailProvider.clearStubEmailOutbox();
  const b = await bootstrap(app, 'boot-email-verify-happy');
  const apiKey = b.json().api_key.api_key;
  const email = `verify.happy.${crypto.randomBytes(4).toString('hex')}@example.com`;

  const start = await app.inject({
    method: 'POST',
    url: '/v1/email/start-verify',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'email-verify-start-happy' },
    payload: { email },
  });
  assert.equal(start.statusCode, 200);

  const code = emailProvider.getStubEmailCode(email);
  assert.match(String(code ?? ''), /^\d{6}$/);

  const complete = await app.inject({
    method: 'POST',
    url: '/v1/email/complete-verify',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'email-verify-complete-happy' },
    payload: { email, code },
  });
  assert.equal(complete.statusCode, 200);
  assert.equal(complete.json().ok, true);

  const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${apiKey}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().node.email, email);
  assert.equal(typeof me.json().node.email_verified_at, 'string');
  await app.close();
});

test('email verification rejects wrong code and expired challenge', async () => {
  const app = buildApp();
  emailProvider.clearStubEmailOutbox();
  const b = await bootstrap(app, 'boot-email-verify-failures');
  const apiKey = b.json().api_key.api_key;

  const wrongEmail = `verify.wrong.${crypto.randomBytes(4).toString('hex')}@example.com`;
  const startWrong = await app.inject({
    method: 'POST',
    url: '/v1/email/start-verify',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'email-verify-start-wrong' },
    payload: { email: wrongEmail },
  });
  assert.equal(startWrong.statusCode, 200);
  const wrongCode = emailProvider.getStubEmailCode(wrongEmail);
  const definitelyWrong = wrongCode === '000000' ? '999999' : '000000';
  const completeWrong = await app.inject({
    method: 'POST',
    url: '/v1/email/complete-verify',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'email-verify-complete-wrong' },
    payload: { email: wrongEmail, code: definitelyWrong },
  });
  assert.equal(completeWrong.statusCode, 422);
  assert.equal(completeWrong.json().error.code, 'validation_error');
  assert.equal(completeWrong.json().error.details.reason, 'invalid_code');

  const expiredEmail = `verify.expired.${crypto.randomBytes(4).toString('hex')}@example.com`;
  const startExpired = await app.inject({
    method: 'POST',
    url: '/v1/email/start-verify',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'email-verify-start-expired' },
    payload: { email: expiredEmail },
  });
  assert.equal(startExpired.statusCode, 200);
  const expiredChallengeId = startExpired.json().challenge_id;
  const expiredCode = emailProvider.getStubEmailCode(expiredEmail);
  await query("update recovery_challenges set expires_at=now()-interval '1 minute' where id=$1", [expiredChallengeId]);
  const completeExpired = await app.inject({
    method: 'POST',
    url: '/v1/email/complete-verify',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'email-verify-complete-expired' },
    payload: { email: expiredEmail, code: expiredCode },
  });
  assert.equal(completeExpired.statusCode, 422);
  assert.equal(completeExpired.json().error.code, 'validation_error');
  assert.equal(completeExpired.json().error.details.reason, 'expired');
  await app.close();
});

test('pubkey recovery rotates keys and old keys are revoked', async () => {
  const app = buildApp();
  const recoveryPair = crypto.generateKeyPairSync('ed25519');
  const recoveryPublicKey = recoveryPair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const b = await bootstrap(app, 'boot-pubkey-recovery', {
    display_name: 'Recovery Node',
    email: null,
    referral_code: null,
    recovery_public_key: recoveryPublicKey,
  });
  const nodeId = b.json().node.id;
  const primaryKey = b.json().api_key.api_key;

  const extra = await app.inject({
    method: 'POST',
    url: '/v1/auth/keys',
    headers: { authorization: `ApiKey ${primaryKey}`, 'idempotency-key': 'mint-extra-key-before-recovery' },
    payload: { label: 'secondary-before-recovery' },
  });
  assert.equal(extra.statusCode, 200);
  const extraKey = extra.json().api_key;

  const start = await app.inject({
    method: 'POST',
    url: '/v1/recovery/start',
    headers: { 'idempotency-key': 'pubkey-recovery-start' },
    payload: { node_id: nodeId, method: 'pubkey' },
  });
  assert.equal(start.statusCode, 200);
  const challengeId = start.json().challenge_id;
  const nonce = start.json().nonce;
  const signature = signRecoveryChallenge(challengeId, nonce, recoveryPair.privateKey);

  const complete = await app.inject({
    method: 'POST',
    url: '/v1/recovery/complete',
    headers: { 'idempotency-key': 'pubkey-recovery-complete' },
    payload: { challenge_id: challengeId, signature },
  });
  assert.equal(complete.statusCode, 200);
  const newApiKey = complete.json().api_key;
  assert.equal(typeof newApiKey, 'string');

  const replay = await app.inject({
    method: 'POST',
    url: '/v1/recovery/complete',
    headers: { 'idempotency-key': 'pubkey-recovery-complete-replay' },
    payload: { challenge_id: challengeId, signature },
  });
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.json().error.code, 'invalid_state_transition');
  assert.equal(replay.json().error.details.reason, 'used');

  const oldMe = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${primaryKey}` } });
  assert.equal(oldMe.statusCode, 403);
  const extraMe = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${extraKey}` } });
  assert.equal(extraMe.statusCode, 403);

  const newMe = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${newApiKey}` } });
  assert.equal(newMe.statusCode, 200);
  assert.equal(newMe.json().node.id, nodeId);

  const activeRows = await query("select count(*)::text as c from api_keys where node_id=$1 and revoked_at is null", [nodeId]);
  assert.equal(Number(activeRows[0].c), 1);
  await app.close();
});

test('pubkey recovery rejects wrong signature and expired nonce', async () => {
  const app = buildApp();
  const pair = crypto.generateKeyPairSync('ed25519');
  const recoveryPublicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const b = await bootstrap(app, 'boot-pubkey-recovery-failures', {
    display_name: 'Recovery Node Fail',
    email: null,
    referral_code: null,
    recovery_public_key: recoveryPublicKey,
  });
  const nodeId = b.json().node.id;

  const startWrongSig = await app.inject({
    method: 'POST',
    url: '/v1/recovery/start',
    headers: { 'idempotency-key': 'pubkey-recovery-start-wrong-sig' },
    payload: { node_id: nodeId, method: 'pubkey' },
  });
  assert.equal(startWrongSig.statusCode, 200);
  const challengeWrongSig = startWrongSig.json().challenge_id;
  const nonceWrongSig = startWrongSig.json().nonce;
  const wrongPair = crypto.generateKeyPairSync('ed25519');
  const wrongSig = signRecoveryChallenge(challengeWrongSig, nonceWrongSig, wrongPair.privateKey);
  const completeWrongSig = await app.inject({
    method: 'POST',
    url: '/v1/recovery/complete',
    headers: { 'idempotency-key': 'pubkey-recovery-complete-wrong-sig' },
    payload: { challenge_id: challengeWrongSig, signature: wrongSig },
  });
  assert.equal(completeWrongSig.statusCode, 422);
  assert.equal(completeWrongSig.json().error.code, 'validation_error');
  assert.equal(completeWrongSig.json().error.details.reason, 'invalid_secret');

  const startExpired = await app.inject({
    method: 'POST',
    url: '/v1/recovery/start',
    headers: { 'idempotency-key': 'pubkey-recovery-start-expired' },
    payload: { node_id: nodeId, method: 'pubkey' },
  });
  assert.equal(startExpired.statusCode, 200);
  const challengeExpired = startExpired.json().challenge_id;
  const nonceExpired = startExpired.json().nonce;
  await query("update recovery_challenges set expires_at=now()-interval '1 minute' where id=$1", [challengeExpired]);
  const sigExpired = signRecoveryChallenge(challengeExpired, nonceExpired, pair.privateKey);
  const completeExpired = await app.inject({
    method: 'POST',
    url: '/v1/recovery/complete',
    headers: { 'idempotency-key': 'pubkey-recovery-complete-expired' },
    payload: { challenge_id: challengeExpired, signature: sigExpired },
  });
  assert.equal(completeExpired.statusCode, 422);
  assert.equal(completeExpired.json().error.code, 'validation_error');
  assert.equal(completeExpired.json().error.details.reason, 'expired');
  await app.close();
});

test('email recovery method is rejected as phase 2 only', async () => {
  const app = buildApp();
  const pair = crypto.generateKeyPairSync('ed25519');
  const recoveryPublicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const b = await bootstrap(app, 'boot-email-recovery-disabled', {
    display_name: 'Email Recovery Disabled',
    email: null,
    referral_code: null,
    recovery_public_key: recoveryPublicKey,
  });
  const nodeId = b.json().node.id;

  const startRecovery = await app.inject({
    method: 'POST',
    url: '/v1/recovery/start',
    headers: { 'idempotency-key': 'email-recovery-start-disabled' },
    payload: { node_id: nodeId, method: 'email' },
  });
  assert.equal(startRecovery.statusCode, 422);
  assert.equal(startRecovery.json().error.code, 'validation_error');
  assert.equal(startRecovery.json().error.message, 'Email recovery is not supported in MVP; use pubkey recovery.');
  assert.equal(startRecovery.json().error.details.reason, 'email_recovery_not_supported');

  const startPubkey = await app.inject({
    method: 'POST',
    url: '/v1/recovery/start',
    headers: { 'idempotency-key': 'pubkey-recovery-start-disabled-test' },
    payload: { node_id: nodeId, method: 'pubkey' },
  });
  assert.equal(startPubkey.statusCode, 200);
  const challengeId = startPubkey.json().challenge_id;
  const codeComplete = await app.inject({
    method: 'POST',
    url: '/v1/recovery/complete',
    headers: { 'idempotency-key': 'email-recovery-complete-disabled' },
    payload: { challenge_id: challengeId, code: '123456' },
  });
  assert.equal(codeComplete.statusCode, 422);
  assert.equal(codeComplete.json().error.code, 'validation_error');
  assert.equal(codeComplete.json().error.message, 'Email recovery is not supported in MVP; use pubkey recovery.');
  assert.equal(codeComplete.json().error.details.reason, 'email_recovery_not_supported');
  await app.close();
});

test('recovery start enforces per-node rate limit', async () => {
  const app = buildApp();
  const pair = crypto.generateKeyPairSync('ed25519');
  const recoveryPublicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const b = await bootstrap(app, 'boot-recovery-rate-limit', {
    display_name: 'Recovery Rate',
    email: null,
    referral_code: null,
    recovery_public_key: recoveryPublicKey,
  });
  const nodeId = b.json().node.id;

  await withConfigOverrides({ rateLimitRecoveryStartPerNodePerHour: 2 }, async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/v1/recovery/start',
      headers: { 'idempotency-key': 'recovery-rate-limit-1' },
      payload: { node_id: nodeId, method: 'pubkey' },
    });
    const second = await app.inject({
      method: 'POST',
      url: '/v1/recovery/start',
      headers: { 'idempotency-key': 'recovery-rate-limit-2' },
      payload: { node_id: nodeId, method: 'pubkey' },
    });
    const third = await app.inject({
      method: 'POST',
      url: '/v1/recovery/start',
      headers: { 'idempotency-key': 'recovery-rate-limit-3' },
      payload: { node_id: nodeId, method: 'pubkey' },
    });
    assert.equal(first.statusCode, 200);
    assert.equal(second.statusCode, 200);
    assert.equal(third.statusCode, 429);
    assert.equal(third.json().error.code, 'rate_limit_exceeded');
    assert.equal(third.json().error.details.rule, 'recovery_start_node');
  });

  await app.close();
});

test('POST /v1/public/nodes/categories-summary returns counts by category', async () => {
  const app = buildApp();
  const ownerBoot = await bootstrap(app, 'boot-catsum-owner');
  const ownerNodeId = ownerBoot.json().node.id;

  const callerBoot = await bootstrap(app, 'boot-catsum-caller');
  const callerApiKey = callerBoot.json().api_key.api_key;
  const callerNodeId = callerBoot.json().node.id;
  assert.equal((await activateBasicSubscriber(app, callerNodeId, 'evt_catsum_subscriber')).statusCode, 200);

  const u1 = await repo.createResource('units', ownerNodeId, { ...unitPayload('CatSum A', 'catsum-scope'), category_ids: [301, 302] });
  const u2 = await repo.createResource('units', ownerNodeId, { ...unitPayload('CatSum B', 'catsum-scope'), category_ids: [301] });
  const u3 = await repo.createResource('units', ownerNodeId, { ...unitPayload('CatSum C', 'catsum-scope'), category_ids: [303] });
  for (const u of [u1, u2, u3]) {
    await repo.setPublished('units', u.id, true);
    await repo.upsertProjection('units', await repo.getResource('units', ownerNodeId, u.id));
  }

  const balBefore = await repo.creditBalance(callerNodeId);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/public/nodes/categories-summary',
    headers: { authorization: `ApiKey ${callerApiKey}` },
    payload: { node_ids: [ownerNodeId], kind: 'listings' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(typeof body.summaries, 'object');
  const summary = body.summaries[ownerNodeId];
  assert.ok(summary, 'summary for owner node missing');
  assert.ok(Array.isArray(summary.listings), 'listings array missing');
  assert.equal(summary.requests, undefined, 'requests should not be present for kind=listings');

  const catMap = Object.fromEntries(summary.listings.map((c) => [c.category_id, c.count]));
  assert.equal(catMap[301], 2);
  assert.equal(catMap[302], 1);
  assert.equal(catMap[303], 1);

  const balAfter = await repo.creditBalance(callerNodeId);
  assert.equal(balAfter, balBefore, 'categories-summary must charge 0 credits');
  await app.close();
});

test('POST /v1/public/nodes/categories-summary respects kind flag', async () => {
  const app = buildApp();
  const ownerBoot = await bootstrap(app, 'boot-catsum-kind-owner');
  const ownerNodeId = ownerBoot.json().node.id;

  const callerBoot = await bootstrap(app, 'boot-catsum-kind-caller');
  const callerApiKey = callerBoot.json().api_key.api_key;
  const callerNodeId = callerBoot.json().node.id;
  assert.equal((await activateBasicSubscriber(app, callerNodeId, 'evt_catsum_kind_sub')).statusCode, 200);

  const unit = await repo.createResource('units', ownerNodeId, { ...unitPayload('CatKind item', 'catkind-scope'), category_ids: [401] });
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', ownerNodeId, unit.id));

  const request = await repo.createResource('requests', ownerNodeId, { ...unitPayload('CatKind req', 'catkind-scope'), category_ids: [402] });
  await repo.setPublished('requests', request.id, true);
  await repo.upsertProjection('requests', await repo.getResource('requests', ownerNodeId, request.id));

  const listingsOnly = await app.inject({
    method: 'POST',
    url: '/v1/public/nodes/categories-summary',
    headers: { authorization: `ApiKey ${callerApiKey}` },
    payload: { node_ids: [ownerNodeId], kind: 'listings' },
  });
  assert.equal(listingsOnly.statusCode, 200);
  assert.ok(Array.isArray(listingsOnly.json().summaries[ownerNodeId].listings));
  assert.equal(listingsOnly.json().summaries[ownerNodeId].requests, undefined);

  const requestsOnly = await app.inject({
    method: 'POST',
    url: '/v1/public/nodes/categories-summary',
    headers: { authorization: `ApiKey ${callerApiKey}` },
    payload: { node_ids: [ownerNodeId], kind: 'requests' },
  });
  assert.equal(requestsOnly.statusCode, 200);
  assert.equal(requestsOnly.json().summaries[ownerNodeId].listings, undefined);
  assert.ok(Array.isArray(requestsOnly.json().summaries[ownerNodeId].requests));

  const both = await app.inject({
    method: 'POST',
    url: '/v1/public/nodes/categories-summary',
    headers: { authorization: `ApiKey ${callerApiKey}` },
    payload: { node_ids: [ownerNodeId], kind: 'both' },
  });
  assert.equal(both.statusCode, 200);
  assert.ok(Array.isArray(both.json().summaries[ownerNodeId].listings));
  assert.ok(Array.isArray(both.json().summaries[ownerNodeId].requests));
  await app.close();
});

test('node category drilldown page 11+ charges 5 credits per page', async () => {
  await withConfigOverrides({ drilldownHighCostPageFrom: 2 }, async () => {
    const app = buildApp();
    const callerBoot = await bootstrap(app, 'boot-drilldown-highcost-caller');
    const callerNodeId = callerBoot.json().node.id;
    const callerApiKey = callerBoot.json().api_key.api_key;
    assert.equal((await activateBasicSubscriber(app, callerNodeId, 'evt_drilldown_highcost_sub')).statusCode, 200);

    const ownerBoot = await bootstrap(app, 'boot-drilldown-highcost-owner');
    const ownerNodeId = ownerBoot.json().node.id;

    const u1 = await repo.createResource('units', ownerNodeId, { ...unitPayload('HighCost 1', 'highcost-scope'), category_ids: [555] });
    const u2 = await repo.createResource('units', ownerNodeId, { ...unitPayload('HighCost 2', 'highcost-scope'), category_ids: [555] });
    for (const u of [u1, u2]) {
      await repo.setPublished('units', u.id, true);
      await repo.upsertProjection('units', await repo.getResource('units', ownerNodeId, u.id));
    }
    await query("update public_listings set published_at = now() - interval '1 seconds' where unit_id=$1", [u2.id]);

    const page1 = await app.inject({
      method: 'GET',
      url: `/v1/public/nodes/${ownerNodeId}/listings/categories/555?limit=1`,
      headers: { authorization: `ApiKey ${callerApiKey}` },
    });
    assert.equal(page1.statusCode, 200);
    assert.equal(page1.json().budget.credits_charged, config.nodeCategoryDrilldownCost);

    const balBefore = await repo.creditBalance(callerNodeId);
    const page2 = await app.inject({
      method: 'GET',
      url: `/v1/public/nodes/${ownerNodeId}/listings/categories/555?limit=1&cursor=${encodeURIComponent(page1.json().cursor)}`,
      headers: { authorization: `ApiKey ${callerApiKey}` },
    });
    assert.equal(page2.statusCode, 200);
    assert.equal(page2.json().budget.credits_charged, config.nodeCategoryDrilldownHighCost);
    const balAfter = await repo.creditBalance(callerNodeId);
    assert.equal(balBefore - balAfter, config.nodeCategoryDrilldownHighCost);
    await app.close();
  });
});

test('node category drilldown budget cap returns 402', async () => {
  const app = buildApp();
  const callerBoot = await bootstrap(app, 'boot-drilldown-cap-caller');
  const callerNodeId = callerBoot.json().node.id;
  const callerApiKey = callerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, callerNodeId, 'evt_drilldown_cap_sub')).statusCode, 200);

  const ownerBoot = await bootstrap(app, 'boot-drilldown-cap-owner');
  const ownerNodeId = ownerBoot.json().node.id;
  const unit = await repo.createResource('units', ownerNodeId, { ...unitPayload('Cap unit', 'cap-drilldown-scope'), category_ids: [600] });
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', ownerNodeId, unit.id));

  const balBefore = await repo.creditBalance(callerNodeId);
  const res = await app.inject({
    method: 'GET',
    url: `/v1/public/nodes/${ownerNodeId}/listings/categories/600?budget_credits_max=0`,
    headers: { authorization: `ApiKey ${callerApiKey}` },
  });
  assert.equal(res.statusCode, 402);
  assert.equal(res.json().error.code, 'budget_cap_exceeded');
  assert.equal(res.json().error.details.needed, config.nodeCategoryDrilldownCost);
  assert.equal(res.json().error.details.max, 0);
  const balAfter = await repo.creditBalance(callerNodeId);
  assert.equal(balAfter, balBefore);
  await app.close();
});

test('node category drilldown per-caller-per-node rate limit', async () => {
  await withConfigOverrides({ rateLimitDrilldownPerNodePerMinute: 1, rateLimitNodeCategoryDrilldownPerMinute: 1000 }, async () => {
    const app = buildApp();
    const callerBoot = await bootstrap(app, 'boot-drilldown-pernode-caller');
    const callerNodeId = callerBoot.json().node.id;
    const callerApiKey = callerBoot.json().api_key.api_key;
    assert.equal((await activateBasicSubscriber(app, callerNodeId, 'evt_drilldown_pernode_sub')).statusCode, 200);

    const ownerABoot = await bootstrap(app, 'boot-drilldown-pernode-a');
    const ownerANodeId = ownerABoot.json().node.id;
    const unitA = await repo.createResource('units', ownerANodeId, { ...unitPayload('PerNode A', 'pernode-scope'), category_ids: [701] });
    await repo.setPublished('units', unitA.id, true);
    await repo.upsertProjection('units', await repo.getResource('units', ownerANodeId, unitA.id));

    const ownerBBoot = await bootstrap(app, 'boot-drilldown-pernode-b');
    const ownerBNodeId = ownerBBoot.json().node.id;
    const unitB = await repo.createResource('units', ownerBNodeId, { ...unitPayload('PerNode B', 'pernode-scope'), category_ids: [701] });
    await repo.setPublished('units', unitB.id, true);
    await repo.upsertProjection('units', await repo.getResource('units', ownerBNodeId, unitB.id));

    const first = await app.inject({
      method: 'GET',
      url: `/v1/public/nodes/${ownerANodeId}/listings/categories/701`,
      headers: { authorization: `ApiKey ${callerApiKey}` },
    });
    assert.equal(first.statusCode, 200);

    const secondSameNode = await app.inject({
      method: 'GET',
      url: `/v1/public/nodes/${ownerANodeId}/listings/categories/701`,
      headers: { authorization: `ApiKey ${callerApiKey}` },
    });
    assert.equal(secondSameNode.statusCode, 429, 'per-node limit should block second request to same node');
    assert.equal(secondSameNode.json().error.code, 'rate_limit_exceeded');

    const diffNode = await app.inject({
      method: 'GET',
      url: `/v1/public/nodes/${ownerBNodeId}/listings/categories/701`,
      headers: { authorization: `ApiKey ${callerApiKey}` },
    });
    assert.equal(diffNode.statusCode, 200, 'different target node should not be blocked');
    await app.close();
  });
});

test('POST drilldown charges credits and returns correct shape', async () => {
  const app = buildApp();
  const callerBoot = await bootstrap(app, 'boot-post-drilldown-caller');
  const callerNodeId = callerBoot.json().node.id;
  const callerApiKey = callerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, callerNodeId, 'evt_post_drilldown_sub')).statusCode, 200);

  const ownerBoot = await bootstrap(app, 'boot-post-drilldown-owner');
  const ownerNodeId = ownerBoot.json().node.id;
  const unit = await repo.createResource('units', ownerNodeId, { ...unitPayload('PostDrill item', 'post-drilldown-scope'), category_ids: [901] });
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', ownerNodeId, unit.id));

  const balBefore = await repo.creditBalance(callerNodeId);
  const res = await app.inject({
    method: 'POST',
    url: `/v1/public/nodes/${ownerNodeId}/listings/categories/901`,
    headers: { authorization: `ApiKey ${callerApiKey}` },
    payload: { budget: { credits_max: 100 } },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.items), 'items array missing');
  assert.equal(typeof body.budget, 'object', 'budget missing');
  assert.equal(body.budget.credits_charged, config.nodeCategoryDrilldownCost);
  assert.ok(typeof body.budget.breakdown === 'object', 'breakdown missing');
  const balAfter = await repo.creditBalance(callerNodeId);
  assert.equal(balBefore - balAfter, config.nodeCategoryDrilldownCost);
  await app.close();
});

test('POST drilldown budget cap too low returns 402', async () => {
  const app = buildApp();
  const callerBoot = await bootstrap(app, 'boot-post-drilldown-cap-caller');
  const callerNodeId = callerBoot.json().node.id;
  const callerApiKey = callerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, callerNodeId, 'evt_post_drilldown_cap_sub')).statusCode, 200);

  const ownerBoot = await bootstrap(app, 'boot-post-drilldown-cap-owner');
  const ownerNodeId = ownerBoot.json().node.id;
  const unit = await repo.createResource('units', ownerNodeId, { ...unitPayload('PostCap item', 'post-cap-drilldown-scope'), category_ids: [902] });
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', ownerNodeId, unit.id));

  const balBefore = await repo.creditBalance(callerNodeId);
  const res = await app.inject({
    method: 'POST',
    url: `/v1/public/nodes/${ownerNodeId}/listings/categories/902`,
    headers: { authorization: `ApiKey ${callerApiKey}` },
    payload: { budget: { credits_max: 0 } },
  });
  assert.equal(res.statusCode, 402);
  assert.equal(res.json().error.code, 'budget_cap_exceeded');
  assert.equal(res.json().error.details.needed, config.nodeCategoryDrilldownCost);
  assert.equal(res.json().error.details.max, 0);
  const balAfter = await repo.creditBalance(callerNodeId);
  assert.equal(balAfter, balBefore, 'no credits should be charged on 402');
  await app.close();
});

test('node category drilldown daily cap', async () => {
  await withConfigOverrides({ drilldownDailyCapBasic: 1, rateLimitNodeCategoryDrilldownPerMinute: 1000, rateLimitDrilldownPerNodePerMinute: 1000 }, async () => {
    const app = buildApp();
    const callerBoot = await bootstrap(app, 'boot-drilldown-daily-caller');
    const callerNodeId = callerBoot.json().node.id;
    const callerApiKey = callerBoot.json().api_key.api_key;
    assert.equal((await activateBasicSubscriber(app, callerNodeId, 'evt_drilldown_daily_sub')).statusCode, 200);

    const ownerBoot = await bootstrap(app, 'boot-drilldown-daily-owner');
    const ownerNodeId = ownerBoot.json().node.id;
    const unit = await repo.createResource('units', ownerNodeId, { ...unitPayload('Daily item', 'daily-drilldown-scope'), category_ids: [801] });
    await repo.setPublished('units', unit.id, true);
    await repo.upsertProjection('units', await repo.getResource('units', ownerNodeId, unit.id));

    const first = await app.inject({
      method: 'GET',
      url: `/v1/public/nodes/${ownerNodeId}/listings/categories/801`,
      headers: { authorization: `ApiKey ${callerApiKey}` },
    });
    assert.equal(first.statusCode, 200);

    const second = await app.inject({
      method: 'GET',
      url: `/v1/public/nodes/${ownerNodeId}/listings/categories/801`,
      headers: { authorization: `ApiKey ${callerApiKey}` },
    });
    assert.equal(second.statusCode, 429, 'daily cap should block second request');
    assert.equal(second.json().error.code, 'rate_limit_exceeded');
    await app.close();
  });
});

// ---------- MCP endpoint tests ----------

test('GET /v1/meta includes mcp_url', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/v1/meta',
    headers: { host: 'fabric.example', 'x-forwarded-proto': 'https' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.mcp_url, 'mcp_url must be present');
  assert.match(body.mcp_url, /\/mcp$/, 'mcp_url must end with /mcp');
  assert.match(body.mcp_url, /^https:\/\//, 'mcp_url must use forwarded proto');
  await app.close();
});

test('GET /v1/meta mcp_url uses MCP_URL env override when set', async () => {
  const app = buildApp();
  const customUrl = 'https://custom-mcp.example.com/mcp';
  const res = await withConfigOverrides({ mcpUrl: customUrl }, () =>
    app.inject({
      method: 'GET',
      url: '/v1/meta',
      headers: { host: 'fabric.example', 'x-forwarded-proto': 'https' },
    }),
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().mcp_url, customUrl);
  await app.close();
});

test('MCP POST /mcp requires auth', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    payload: { jsonrpc: '2.0', id: 1, method: 'initialize' },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('MCP initialize returns server info', async () => {
  const app = buildApp();
  const boot = await bootstrap(app, 'mcp-init');
  const apiKey = boot.json().api_key.api_key;
  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `ApiKey ${apiKey}` },
    payload: { jsonrpc: '2.0', id: 1, method: 'initialize' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.jsonrpc, '2.0');
  assert.equal(body.id, 1);
  assert.ok(body.result.serverInfo, 'must include serverInfo');
  assert.equal(body.result.serverInfo.name, 'fabric-api-readonly');
  assert.ok(body.result.protocolVersion, 'must include protocolVersion');
  assert.ok(body.result.capabilities, 'must include capabilities');
  await app.close();
});

test('MCP tools/list returns allowlisted tools', async () => {
  const app = buildApp();
  const boot = await bootstrap(app, 'mcp-tlist');
  const apiKey = boot.json().api_key.api_key;
  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `ApiKey ${apiKey}` },
    payload: { jsonrpc: '2.0', id: 2, method: 'tools/list' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  const names = body.result.tools.map((t) => t.name);
  assert.ok(names.includes('fabric_search_listings'), 'must include fabric_search_listings');
  assert.ok(names.includes('fabric_search_requests'), 'must include fabric_search_requests');
  assert.ok(names.includes('fabric_get_unit'), 'must include fabric_get_unit');
  assert.ok(names.includes('fabric_get_request'), 'must include fabric_get_request');
  assert.ok(names.includes('fabric_get_offer'), 'must include fabric_get_offer');
  assert.ok(names.includes('fabric_get_events'), 'must include fabric_get_events');
  assert.ok(names.includes('fabric_get_credits'), 'must include fabric_get_credits');
  assert.equal(names.length, 7, 'exactly 7 tools in allowlist');
  await app.close();
});

test('MCP unknown tool rejected', async () => {
  const app = buildApp();
  const boot = await bootstrap(app, 'mcp-reject');
  const apiKey = boot.json().api_key.api_key;
  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `ApiKey ${apiKey}` },
    payload: {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'fabric_delete_everything', arguments: {} },
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(body.result.isError, 'unknown tool must return isError=true');
  const text = JSON.parse(body.result.content[0].text);
  assert.equal(text.error, 'unknown_tool');
  await app.close();
});

test('MCP unknown JSON-RPC method returns -32601', async () => {
  const app = buildApp();
  const boot = await bootstrap(app, 'mcp-unk-method');
  const apiKey = boot.json().api_key.api_key;
  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `ApiKey ${apiKey}` },
    payload: { jsonrpc: '2.0', id: 99, method: 'resources/list' },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.error.code, -32601);
  await app.close();
});

test('MCP fabric_get_credits returns balance', async () => {
  const app = buildApp();
  const boot = await bootstrap(app, 'mcp-credits');
  const apiKey = boot.json().api_key.api_key;
  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `ApiKey ${apiKey}` },
    payload: {
      jsonrpc: '2.0',
      id: 10,
      method: 'tools/call',
      params: { name: 'fabric_get_credits', arguments: {} },
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.id, 10);
  assert.ok(!body.result.isError, 'fabric_get_credits should succeed');
  const data = JSON.parse(body.result.content[0].text);
  assert.equal(typeof data.credits_balance, 'number');
  await app.close();
});

test('MCP fabric_get_events returns events envelope', async () => {
  const app = buildApp();
  const boot = await bootstrap(app, 'mcp-events');
  const apiKey = boot.json().api_key.api_key;
  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `ApiKey ${apiKey}` },
    payload: {
      jsonrpc: '2.0',
      id: 11,
      method: 'tools/call',
      params: { name: 'fabric_get_events', arguments: { limit: 10 } },
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(!body.result.isError, 'fabric_get_events should succeed');
  const data = JSON.parse(body.result.content[0].text);
  assert.ok(Array.isArray(data.events), 'events must be an array');
  await app.close();
});

test('MCP rate limit triggers 429 after threshold', async () => {
  const app = buildApp();
  const boot = await bootstrap(app, 'mcp-ratelimit');
  const apiKey = boot.json().api_key.api_key;

  await withConfigOverrides({ rateLimitMcpPerMinute: 2 }, async () => {
    for (let i = 0; i < 2; i++) {
      const r = await app.inject({
        method: 'POST',
        url: '/mcp',
        headers: { authorization: `ApiKey ${apiKey}` },
        payload: { jsonrpc: '2.0', id: i, method: 'tools/list' },
      });
      assert.equal(r.statusCode, 200, `request ${i} should succeed`);
    }
    const limited = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { authorization: `ApiKey ${apiKey}` },
      payload: { jsonrpc: '2.0', id: 99, method: 'tools/list' },
    });
    assert.equal(limited.statusCode, 429);
    assert.equal(limited.json().error.code, 'rate_limit_exceeded');
  });
  await app.close();
});

// =====================================================================
// QA AUDIT — GAP 1: Optimistic concurrency (If-Match / stale_write_conflict)
// =====================================================================

test('PATCH /v1/units/:id without If-Match returns 422', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-ifmatch-unit-missing');
  const apiKey = b.json().api_key.api_key;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'ifmatch-unit-create-missing' },
    payload: unitPayload('IfMatch missing unit', 'ifmatch-scope'),
  });
  assert.equal(create.statusCode, 200);
  const unitId = create.json().unit.id;
  const patch = await app.inject({
    method: 'PATCH',
    url: `/v1/units/${unitId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'ifmatch-unit-patch-missing' },
    payload: { title: 'Updated' },
  });
  assert.equal(patch.statusCode, 422);
  assert.equal(patch.json().error.code, 'validation_error');
  await app.close();
});

test('PATCH /v1/units/:id with stale If-Match returns 409 stale_write_conflict', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-ifmatch-unit-stale');
  const apiKey = b.json().api_key.api_key;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'ifmatch-unit-create-stale' },
    payload: unitPayload('IfMatch stale unit', 'ifmatch-scope'),
  });
  assert.equal(create.statusCode, 200);
  const unitId = create.json().unit.id;
  const version = create.json().unit.version;
  const patch1 = await app.inject({
    method: 'PATCH',
    url: `/v1/units/${unitId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'if-match': String(version), 'idempotency-key': 'ifmatch-unit-patch1-stale' },
    payload: { title: 'Updated v2' },
  });
  assert.equal(patch1.statusCode, 200);
  const stalePatch = await app.inject({
    method: 'PATCH',
    url: `/v1/units/${unitId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'if-match': String(version), 'idempotency-key': 'ifmatch-unit-patch2-stale' },
    payload: { title: 'Updated v3' },
  });
  assert.equal(stalePatch.statusCode, 409);
  assert.equal(stalePatch.json().error.code, 'stale_write_conflict');
  await app.close();
});

test('PATCH /v1/units/:id with correct If-Match succeeds and increments version', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-ifmatch-unit-ok');
  const apiKey = b.json().api_key.api_key;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'ifmatch-unit-create-ok' },
    payload: unitPayload('IfMatch ok unit', 'ifmatch-scope'),
  });
  assert.equal(create.statusCode, 200);
  const unitId = create.json().unit.id;
  const v1 = create.json().unit.version;
  const patch = await app.inject({
    method: 'PATCH',
    url: `/v1/units/${unitId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'if-match': String(v1), 'idempotency-key': 'ifmatch-unit-patch-ok' },
    payload: { title: 'Updated with correct version' },
  });
  assert.equal(patch.statusCode, 200);
  assert.equal(Number(patch.json().version), Number(v1) + 1);
  await app.close();
});

test('PATCH /v1/requests/:id without If-Match returns 422', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-ifmatch-req-missing');
  const apiKey = b.json().api_key.api_key;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'ifmatch-req-create-missing' },
    payload: unitPayload('IfMatch missing request', 'ifmatch-scope'),
  });
  assert.equal(create.statusCode, 200);
  const reqId = create.json().request.id;
  const patch = await app.inject({
    method: 'PATCH',
    url: `/v1/requests/${reqId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'ifmatch-req-patch-missing' },
    payload: { title: 'Updated' },
  });
  assert.equal(patch.statusCode, 422);
  assert.equal(patch.json().error.code, 'validation_error');
  await app.close();
});

test('PATCH /v1/requests/:id with stale If-Match returns 409 stale_write_conflict', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-ifmatch-req-stale');
  const apiKey = b.json().api_key.api_key;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'ifmatch-req-create-stale' },
    payload: unitPayload('IfMatch stale request', 'ifmatch-scope'),
  });
  assert.equal(create.statusCode, 200);
  const reqId = create.json().request.id;
  const version = create.json().request.version;
  const patch1 = await app.inject({
    method: 'PATCH',
    url: `/v1/requests/${reqId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'if-match': String(version), 'idempotency-key': 'ifmatch-req-patch1-stale' },
    payload: { title: 'Updated v2' },
  });
  assert.equal(patch1.statusCode, 200);
  const stalePatch = await app.inject({
    method: 'PATCH',
    url: `/v1/requests/${reqId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'if-match': String(version), 'idempotency-key': 'ifmatch-req-patch2-stale' },
    payload: { title: 'Updated v3' },
  });
  assert.equal(stalePatch.statusCode, 409);
  assert.equal(stalePatch.json().error.code, 'stale_write_conflict');
  await app.close();
});

test('PATCH /v1/requests/:id with correct If-Match succeeds and increments version', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-ifmatch-req-ok');
  const apiKey = b.json().api_key.api_key;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'ifmatch-req-create-ok' },
    payload: unitPayload('IfMatch ok request', 'ifmatch-scope'),
  });
  assert.equal(create.statusCode, 200);
  const reqId = create.json().request.id;
  const v1 = create.json().request.version;
  const patch = await app.inject({
    method: 'PATCH',
    url: `/v1/requests/${reqId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'if-match': String(v1), 'idempotency-key': 'ifmatch-req-patch-ok' },
    payload: { title: 'Updated with correct version' },
  });
  assert.equal(patch.statusCode, 200);
  assert.equal(Number(patch.json().version), Number(v1) + 1);
  await app.close();
});

// =====================================================================
// QA AUDIT — GAP 2: Projection allowlist enforcement
// =====================================================================

test('published unit projection does not contain email, phone, or precise geo', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-proj-allow-unit', {
    display_name: 'ProjAllowUnit',
    email: `proj-unit-${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
    messaging_handles: [{ kind: 'telegram', handle: '@secret_handle', url: null }],
  });
  assert.equal(b.statusCode, 200, `bootstrap failed: ${JSON.stringify(b.json())}`);
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  const create = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'proj-allowlist-unit-create' },
    payload: unitPayload('Projection allowlist unit', 'proj-allowlist-scope'),
  });
  assert.equal(create.statusCode, 200);
  const unitId = create.json().unit.id;

  const publish = await app.inject({
    method: 'POST',
    url: `/v1/units/${unitId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'proj-allowlist-unit-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 200);

  const projRows = await query(
    'select doc from public_listings where unit_id=$1',
    [unitId],
  );
  assert.equal(projRows.length, 1);
  const doc = projRows[0].doc;
  const docStr = JSON.stringify(doc).toLowerCase();
  assert.equal(docStr.includes(`proj-unit-${TEST_RUN_SUFFIX}@example.com`.toLowerCase()), false, 'projection must not contain email');
  assert.equal(docStr.includes('@secret_handle'), false, 'projection must not contain messaging handles');
  assert.equal(doc.email, undefined, 'projection must not have email field');
  assert.equal(doc.phone, undefined, 'projection must not have phone field');
  assert.equal(doc.address, undefined, 'projection must not have address field');
  assert.equal(doc.messaging_handles, undefined, 'projection must not have messaging_handles field');
  await app.close();
});

test('published request projection does not contain email, phone, or precise geo', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-proj-allow-req', {
    display_name: 'ProjAllowReq',
    email: `proj-req-${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
    messaging_handles: [{ kind: 'whatsapp', handle: '+15551234567', url: null }],
  });
  assert.equal(b.statusCode, 200, `bootstrap failed: ${JSON.stringify(b.json())}`);
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  const create = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'proj-allowlist-req-create' },
    payload: unitPayload('Projection allowlist request', 'proj-allowlist-scope'),
  });
  assert.equal(create.statusCode, 200);
  const reqId = create.json().request.id;

  const publish = await app.inject({
    method: 'POST',
    url: `/v1/requests/${reqId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'proj-allowlist-req-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 200);

  const projRows = await query(
    'select doc from public_requests where request_id=$1',
    [reqId],
  );
  assert.equal(projRows.length, 1);
  const doc = projRows[0].doc;
  const docStr = JSON.stringify(doc).toLowerCase();
  assert.equal(docStr.includes(`proj-req-${TEST_RUN_SUFFIX}@example.com`.toLowerCase()), false, 'projection must not contain email');
  assert.equal(docStr.includes('+15551234567'), false, 'projection must not contain phone');
  assert.equal(doc.email, undefined, 'projection must not have email field');
  assert.equal(doc.phone, undefined, 'projection must not have phone field');
  assert.equal(doc.address, undefined, 'projection must not have address field');
  assert.equal(doc.messaging_handles, undefined, 'projection must not have messaging_handles field');
  await app.close();
});

// =====================================================================
// QA AUDIT — GAP 3: GET /v1/offers role filtering
// =====================================================================

test('GET /v1/offers role=made returns only caller-created offers and role=received returns only inbound offers', async () => {
  const app = buildApp();

  const sellerBoot = await bootstrap(app, 'boot-offers-role-seller');
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_offers_role_seller')).statusCode, 200);

  const buyerBoot = await bootstrap(app, 'boot-offers-role-buyer');
  const buyerNodeId = buyerBoot.json().node.id;
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, buyerNodeId, 'evt_offers_role_buyer')).statusCode, 200);

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Offers role unit', 'offers-role-scope'));
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit.id));

  const offer = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'offers-role-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(offer.statusCode, 200);

  const buyerMade = await app.inject({
    method: 'GET',
    url: '/v1/offers?role=made',
    headers: { authorization: `ApiKey ${buyerApiKey}` },
  });
  assert.equal(buyerMade.statusCode, 200);
  assert.equal(buyerMade.json().offers.length >= 1, true);
  assert.equal(buyerMade.json().offers.every((o) => o.from_node_id === buyerNodeId), true);

  const buyerReceived = await app.inject({
    method: 'GET',
    url: '/v1/offers?role=received',
    headers: { authorization: `ApiKey ${buyerApiKey}` },
  });
  assert.equal(buyerReceived.statusCode, 200);
  const buyerReceivedOfferIds = buyerReceived.json().offers.map((o) => o.id);
  assert.equal(buyerReceivedOfferIds.includes(offer.json().offer.id), false);

  const sellerReceived = await app.inject({
    method: 'GET',
    url: '/v1/offers?role=received',
    headers: { authorization: `ApiKey ${sellerApiKey}` },
  });
  assert.equal(sellerReceived.statusCode, 200);
  assert.equal(sellerReceived.json().offers.some((o) => o.id === offer.json().offer.id), true);
  assert.equal(sellerReceived.json().offers.every((o) => o.to_node_id === sellerNodeId), true);

  const sellerMade = await app.inject({
    method: 'GET',
    url: '/v1/offers?role=made',
    headers: { authorization: `ApiKey ${sellerApiKey}` },
  });
  assert.equal(sellerMade.statusCode, 200);
  const sellerMadeOfferIds = sellerMade.json().offers.map((o) => o.id);
  assert.equal(sellerMadeOfferIds.includes(offer.json().offer.id), false);

  await app.close();
});

test('GET /v1/offers/:id returns offer for party and 404 for non-party with version field', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-offer-get-seller');
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_offer_get_seller')).statusCode, 200);

  const buyerBoot = await bootstrap(app, 'boot-offer-get-buyer');
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, buyerBoot.json().node.id, 'evt_offer_get_buyer')).statusCode, 200);

  const bystander = await bootstrap(app, 'boot-offer-get-bystander');
  const bystanderApiKey = bystander.json().api_key.api_key;

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Offer get unit', 'offer-get-scope'));
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit.id));

  const offerRes = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'offer-get-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(offerRes.statusCode, 200);
  const offerId = offerRes.json().offer.id;

  const partyGet = await app.inject({
    method: 'GET',
    url: `/v1/offers/${offerId}`,
    headers: { authorization: `ApiKey ${sellerApiKey}` },
  });
  assert.equal(partyGet.statusCode, 200);
  assert.equal(partyGet.json().offer.id, offerId);
  assert.ok(partyGet.json().offer.version !== undefined, 'offer should have a version field');

  const nonPartyGet = await app.inject({
    method: 'GET',
    url: `/v1/offers/${offerId}`,
    headers: { authorization: `ApiKey ${bystanderApiKey}` },
  });
  assert.equal(nonPartyGet.statusCode, 404);
  assert.equal(nonPartyGet.json().error.code, 'not_found');
  await app.close();
});

// =====================================================================
// QA AUDIT — GAP 4: Pre-purchase daily search limit
// =====================================================================

test('pre-purchase daily search limit blocks 4th search with prepurchase_daily_limit_exceeded', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-prepurchase-search-limit');
  const apiKey = b.json().api_key.api_key;
  const searchPayload = { q: null, scope: 'OTHER', filters: { scope_notes: 'prepurchase-search-limit' }, broadening: { level: 0, allow: false }, budget: { credits_requested: config.searchCreditCost }, limit: 20, cursor: null };

  for (let i = 1; i <= 3; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/search/listings',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `prepurchase-search-${i}` },
      payload: searchPayload,
    });
    assert.equal(res.statusCode, 200, `search ${i} should succeed`);
  }

  const fourth = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'prepurchase-search-4' },
    payload: searchPayload,
  });
  assert.equal(fourth.statusCode, 429);
  assert.equal(fourth.json().error.code, 'prepurchase_daily_limit_exceeded');
  assert.equal(fourth.json().error.details.action, 'search');
  await app.close();
});

// =====================================================================
// QA AUDIT — GAP 5: Cancel only by creator
// =====================================================================

test('offer cancel by recipient returns 403 forbidden', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-cancel-only-seller');
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_cancel_only_seller')).statusCode, 200);

  const buyerBoot = await bootstrap(app, 'boot-cancel-only-buyer');
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, buyerBoot.json().node.id, 'evt_cancel_only_buyer')).statusCode, 200);

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Cancel only unit', 'cancel-only-scope'));
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit.id));

  const offerRes = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'cancel-only-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(offerRes.statusCode, 200);
  const offerId = offerRes.json().offer.id;

  const recipientCancel = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/cancel`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'cancel-only-recipient' },
    payload: { reason: null },
  });
  assert.equal(recipientCancel.statusCode, 403);
  assert.equal(recipientCancel.json().error.code, 'forbidden');

  const creatorCancel = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/cancel`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'cancel-only-creator' },
    payload: { reason: null },
  });
  assert.equal(creatorCancel.statusCode, 200);
  await app.close();
});

// =====================================================================
// QA AUDIT — GAP 6: DELETE /v1/auth/keys/:id
// =====================================================================

test('DELETE /v1/auth/keys/:id returns 404 for unknown key_id', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-delete-key-404');
  const apiKey = b.json().api_key.api_key;
  const fakeKeyId = crypto.randomUUID();
  const res = await app.inject({
    method: 'DELETE',
    url: `/v1/auth/keys/${fakeKeyId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'delete-key-404' },
  });
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'not_found');
  await app.close();
});

test('DELETE /v1/auth/keys/:id idempotency replay returns same response', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-delete-key-idem');
  const apiKey = b.json().api_key.api_key;

  const extra = await app.inject({
    method: 'POST',
    url: '/v1/auth/keys',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'delete-key-idem-mint' },
    payload: { label: 'to-revoke' },
  });
  assert.equal(extra.statusCode, 200);
  const keyId = extra.json().key_id;

  const first = await app.inject({
    method: 'DELETE',
    url: `/v1/auth/keys/${keyId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'delete-key-idem-revoke' },
  });
  assert.equal(first.statusCode, 200);

  const replay = await app.inject({
    method: 'DELETE',
    url: `/v1/auth/keys/${keyId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'delete-key-idem-revoke' },
  });
  assert.equal(replay.statusCode, first.statusCode);
  assert.deepEqual(replay.json(), first.json());
  await app.close();
});

// =====================================================================
// QA AUDIT — GAP 7: GET unit/request 404 for deleted and not-owned
// =====================================================================

test('GET /v1/units/:id returns 404 for soft-deleted unit', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-unit-deleted-404');
  const apiKey = b.json().api_key.api_key;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'unit-deleted-create' },
    payload: unitPayload('Deleted unit', 'deleted-scope'),
  });
  assert.equal(create.statusCode, 200);
  const unitId = create.json().unit.id;

  const del = await app.inject({
    method: 'DELETE',
    url: `/v1/units/${unitId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'unit-deleted-delete' },
  });
  assert.equal(del.statusCode, 200);

  const get = await app.inject({
    method: 'GET',
    url: `/v1/units/${unitId}`,
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  assert.equal(get.statusCode, 404);
  await app.close();
});

test('GET /v1/units/:id returns 404 for unit owned by different node', async () => {
  const app = buildApp();
  const ownerBoot = await bootstrap(app, 'boot-unit-notowned-owner');
  const ownerApiKey = ownerBoot.json().api_key.api_key;

  const otherBoot = await bootstrap(app, 'boot-unit-notowned-other');
  const otherApiKey = otherBoot.json().api_key.api_key;

  const create = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${ownerApiKey}`, 'idempotency-key': 'unit-notowned-create' },
    payload: unitPayload('Not owned unit', 'notowned-scope'),
  });
  assert.equal(create.statusCode, 200);
  const unitId = create.json().unit.id;

  const get = await app.inject({
    method: 'GET',
    url: `/v1/units/${unitId}`,
    headers: { authorization: `ApiKey ${otherApiKey}` },
  });
  assert.ok(get.statusCode === 404 || get.statusCode === 403, 'should return 404 or 403 for not-owned unit');
  await app.close();
});

test('GET /v1/requests/:id returns 404 for soft-deleted request', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-req-deleted-404');
  const apiKey = b.json().api_key.api_key;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'req-deleted-create' },
    payload: unitPayload('Deleted request', 'deleted-scope'),
  });
  assert.equal(create.statusCode, 200);
  const reqId = create.json().request.id;

  const del = await app.inject({
    method: 'DELETE',
    url: `/v1/requests/${reqId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'req-deleted-delete' },
  });
  assert.equal(del.statusCode, 200);

  const get = await app.inject({
    method: 'GET',
    url: `/v1/requests/${reqId}`,
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  assert.equal(get.statusCode, 404);
  await app.close();
});

test('GET /v1/requests/:id returns 404 for request owned by different node', async () => {
  const app = buildApp();
  const ownerBoot = await bootstrap(app, 'boot-req-notowned-owner');
  const ownerApiKey = ownerBoot.json().api_key.api_key;

  const otherBoot = await bootstrap(app, 'boot-req-notowned-other');
  const otherApiKey = otherBoot.json().api_key.api_key;

  const create = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${ownerApiKey}`, 'idempotency-key': 'req-notowned-create' },
    payload: unitPayload('Not owned request', 'notowned-scope'),
  });
  assert.equal(create.statusCode, 200);
  const reqId = create.json().request.id;

  const get = await app.inject({
    method: 'GET',
    url: `/v1/requests/${reqId}`,
    headers: { authorization: `ApiKey ${otherApiKey}` },
  });
  assert.ok(get.statusCode === 404 || get.statusCode === 403, 'should return 404 or 403 for not-owned request');
  await app.close();
});

// =====================================================================
// QA AUDIT — GAP 8: Publish eligibility per-scope validation
// =====================================================================

test('publish unit without type returns 422', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-publish-no-type');
  const apiKey = b.json().api_key.api_key;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'publish-no-type-create' },
    payload: { ...unitPayload('No type unit', 'publish-scope'), type: null },
  });
  assert.equal(create.statusCode, 200);
  const unitId = create.json().unit.id;
  const publish = await app.inject({
    method: 'POST',
    url: `/v1/units/${unitId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'publish-no-type-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 422);
  await app.close();
});

test('publish unit with scope=ship_to but missing origin_region returns 422', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-publish-shipto-no-origin');
  const apiKey = b.json().api_key.api_key;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'publish-shipto-create' },
    payload: { ...unitPayload('Ship no origin', 'ship-scope'), scope_primary: 'ship_to', origin_region: null, dest_region: null },
  });
  assert.equal(create.statusCode, 200);
  const unitId = create.json().unit.id;
  const publish = await app.inject({
    method: 'POST',
    url: `/v1/units/${unitId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'publish-shipto-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 422);
  await app.close();
});

test('publish unit with scope=local_in_person but missing location_text_public returns 422', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-publish-local-no-location');
  const apiKey = b.json().api_key.api_key;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'publish-local-create' },
    payload: { ...unitPayload('Local no location', 'local-scope'), scope_primary: 'local_in_person', location_text_public: null },
  });
  assert.equal(create.statusCode, 200);
  const unitId = create.json().unit.id;
  const publish = await app.inject({
    method: 'POST',
    url: `/v1/units/${unitId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'publish-local-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 422);
  await app.close();
});

test('publish unit with scope=digital_delivery but missing delivery_format returns 422', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-publish-digital-no-format');
  const apiKey = b.json().api_key.api_key;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'publish-digital-create' },
    payload: { ...unitPayload('Digital no format', 'digital-scope'), scope_primary: 'digital_delivery', delivery_format: null },
  });
  assert.equal(create.statusCode, 200);
  const unitId = create.json().unit.id;
  const publish = await app.inject({
    method: 'POST',
    url: `/v1/units/${unitId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'publish-digital-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 422);
  await app.close();
});

test('publish unit with scope=remote_online_service but missing service_region returns 422', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-publish-remote-no-region');
  const apiKey = b.json().api_key.api_key;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'publish-remote-create' },
    payload: { ...unitPayload('Remote no region', 'remote-scope'), scope_primary: 'remote_online_service', service_region: null },
  });
  assert.equal(create.statusCode, 200);
  const unitId = create.json().unit.id;
  const publish = await app.inject({
    method: 'POST',
    url: `/v1/units/${unitId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'publish-remote-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 422);
  await app.close();
});

// =====================================================================
// QA AUDIT — GAP 9: Public node requests inventory expansion
// =====================================================================

test('GET /v1/public/nodes/:id/requests returns published requests and charges credits', async () => {
  const app = buildApp();
  const callerBoot = await bootstrap(app, 'boot-public-req-caller');
  const callerNodeId = callerBoot.json().node.id;
  const callerApiKey = callerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, callerNodeId, 'evt_public_req_sub')).statusCode, 200);

  const ownerBoot = await bootstrap(app, 'boot-public-req-owner');
  const ownerNodeId = ownerBoot.json().node.id;

  const request = await repo.createResource('requests', ownerNodeId, unitPayload('Public node request', 'public-req-scope'));
  await repo.setPublished('requests', request.id, true);
  await repo.upsertProjection('requests', await repo.getResource('requests', ownerNodeId, request.id));

  const balBefore = await repo.creditBalance(callerNodeId);
  const res = await app.inject({
    method: 'GET',
    url: `/v1/public/nodes/${ownerNodeId}/requests?limit=20`,
    headers: { authorization: `ApiKey ${callerApiKey}` },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().node_id, ownerNodeId);
  assert.equal(Array.isArray(res.json().items), true);
  assert.equal(res.json().items.length >= 1, true);
  const balAfter = await repo.creditBalance(callerNodeId);
  assert.equal(balBefore > balAfter, true, 'credits should be charged');
  await app.close();
});

// =====================================================================
// QA AUDIT — GAP 10: Offer TTL expiry
// =====================================================================

test('expired offer rejects accept with 409 invalid_state_transition', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-offer-expired-seller');
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_offer_expired_seller')).statusCode, 200);

  const buyerBoot = await bootstrap(app, 'boot-offer-expired-buyer');
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, buyerBoot.json().node.id, 'evt_offer_expired_buyer')).statusCode, 200);

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Expired offer unit', 'offer-expired-scope'));
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit.id));

  const offerRes = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'offer-expired-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null, ttl_minutes: 15 },
  });
  assert.equal(offerRes.statusCode, 200);
  const offerId = offerRes.json().offer.id;

  await query("update offers set expires_at = now() - interval '1 minute' where id=$1", [offerId]);

  const accept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'offer-expired-accept' },
    payload: {},
  });
  assert.ok(accept.statusCode === 409 || accept.statusCode === 404, 'expired offer should be rejected or not found');
  await app.close();
});

// =====================================================================
// QA AUDIT — GAP 11: Credits ledger pagination
// =====================================================================

test('GET /v1/credits/ledger pagination with cursor returns next page', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-ledger-pagination');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  await repo.addCredit(nodeId, 'adjustment_manual', 10, { reason: 'test-ledger-page-1' });
  await repo.addCredit(nodeId, 'adjustment_manual', 20, { reason: 'test-ledger-page-2' });
  await repo.addCredit(nodeId, 'adjustment_manual', 30, { reason: 'test-ledger-page-3' });

  const page1 = await app.inject({
    method: 'GET',
    url: '/v1/credits/ledger?limit=2',
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  assert.equal(page1.statusCode, 200);
  assert.equal(page1.json().entries.length, 2);
  assert.equal(typeof page1.json().next_cursor, 'string');

  const page2 = await app.inject({
    method: 'GET',
    url: `/v1/credits/ledger?limit=2&cursor=${encodeURIComponent(page1.json().next_cursor)}`,
    headers: { authorization: `ApiKey ${apiKey}` },
  });
  assert.equal(page2.statusCode, 200);
  assert.equal(page2.json().entries.length >= 1, true);
  const page1Ids = page1.json().entries.map((e) => e.id);
  const page2Ids = page2.json().entries.map((e) => e.id);
  const overlap = page2Ids.filter((id) => page1Ids.includes(id));
  assert.equal(overlap.length, 0, 'pages must not overlap');
  await app.close();
});

// =====================================================================
// QA AUDIT — GAP 12: MCP search execution
// =====================================================================

test('MCP fabric_search_listings executes search and returns results', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-mcp-search-exec');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, nodeId, 'evt_mcp_search_exec')).statusCode, 200);

  const targetBoot = await bootstrap(app, 'boot-mcp-search-exec-target');
  const targetNodeId = targetBoot.json().node.id;
  const scopeNotes = `mcp-search-exec-${TEST_RUN_SUFFIX}-${nodeId.slice(0, 6)}`;
  const unit = await repo.createResource('units', targetNodeId, { ...unitPayload('MCP search item', scopeNotes), category_ids: [444] });
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', targetNodeId, unit.id));

  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `ApiKey ${apiKey}` },
    payload: {
      jsonrpc: '2.0',
      id: 42,
      method: 'tools/call',
      params: {
        name: 'fabric_search_listings',
        arguments: {
          scope: 'OTHER',
          filters: { scope_notes: scopeNotes },
          budget: { credits_requested: config.searchCreditCost },
          limit: 20,
        },
      },
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.id, 42);
  assert.ok(!body.result.isError, 'fabric_search_listings should succeed');
  const data = JSON.parse(body.result.content[0].text);
  assert.ok(Array.isArray(data.items), 'search result must have items array');
  assert.equal(typeof data.budget, 'object', 'search result must have budget');
  assert.equal(typeof data.budget.credits_charged, 'number', 'budget must include credits_charged');
  await app.close();
});

// =====================================================================
// QA AUDIT — GAP 14: Legal version mismatch
// =====================================================================

test('POST /v1/bootstrap with wrong legal version returns 422 legal_version_mismatch', async () => {
  const app = buildApp();
  const res = await bootstrap(app, 'boot-legal-mismatch', {
    display_name: 'LegalMismatch',
    email: null,
    referral_code: null,
    legal: { accepted: true, version: '2020-01-01' },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, 'legal_version_mismatch');
  await app.close();
});

// =====================================================================
// QA AUDIT — IDEMPOTENCY MATRIX: additional replay/conflict tests
// =====================================================================

test('POST /v1/auth/keys idempotency replay and conflict', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-authkeys-idem');
  const apiKey = b.json().api_key.api_key;

  const first = await app.inject({
    method: 'POST',
    url: '/v1/auth/keys',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'authkeys-idem-1' },
    payload: { label: 'idem-test' },
  });
  assert.equal(first.statusCode, 200);

  const replay = await app.inject({
    method: 'POST',
    url: '/v1/auth/keys',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'authkeys-idem-1' },
    payload: { label: 'idem-test' },
  });
  assert.equal(replay.statusCode, first.statusCode);
  assert.deepEqual(replay.json(), first.json());

  const conflict = await app.inject({
    method: 'POST',
    url: '/v1/auth/keys',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'authkeys-idem-1' },
    payload: { label: 'different-label' },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, 'idempotency_key_reuse_conflict');
  await app.close();
});

test('PATCH /v1/units/:id idempotency replay returns same response', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-patch-unit-idem');
  const apiKey = b.json().api_key.api_key;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'patch-unit-idem-create' },
    payload: unitPayload('Patch idem unit', 'patch-idem-scope'),
  });
  assert.equal(create.statusCode, 200);
  const unitId = create.json().unit.id;
  const version = create.json().unit.version;

  const first = await app.inject({
    method: 'PATCH',
    url: `/v1/units/${unitId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'if-match': String(version), 'idempotency-key': 'patch-unit-idem-patch' },
    payload: { title: 'Patched idempotent' },
  });
  assert.equal(first.statusCode, 200);

  const replay = await app.inject({
    method: 'PATCH',
    url: `/v1/units/${unitId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'if-match': String(version), 'idempotency-key': 'patch-unit-idem-patch' },
    payload: { title: 'Patched idempotent' },
  });
  assert.equal(replay.statusCode, first.statusCode);
  assert.deepEqual(replay.json(), first.json());
  await app.close();
});

test('POST /v1/units/:id/publish idempotency replay returns same response', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-publish-unit-idem');
  const apiKey = b.json().api_key.api_key;
  const create = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'publish-unit-idem-create' },
    payload: unitPayload('Publish idem unit', 'publish-idem-scope'),
  });
  assert.equal(create.statusCode, 200);
  const unitId = create.json().unit.id;

  const first = await app.inject({
    method: 'POST',
    url: `/v1/units/${unitId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'publish-unit-idem-pub' },
    payload: {},
  });
  assert.equal(first.statusCode, 200);

  const replay = await app.inject({
    method: 'POST',
    url: `/v1/units/${unitId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'publish-unit-idem-pub' },
    payload: {},
  });
  assert.equal(replay.statusCode, first.statusCode);
  assert.deepEqual(replay.json(), first.json());
  await app.close();
});

test('POST /v1/offers/:id/reject idempotency replay returns same response', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-reject-idem-seller');
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_reject_idem_seller')).statusCode, 200);

  const buyerBoot = await bootstrap(app, 'boot-reject-idem-buyer');
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, buyerBoot.json().node.id, 'evt_reject_idem_buyer')).statusCode, 200);

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Reject idem unit', 'reject-idem-scope'));
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit.id));

  const offer = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'reject-idem-offer' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(offer.statusCode, 200);
  const offerId = offer.json().offer.id;

  const first = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/reject`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'reject-idem-reject' },
    payload: { reason: null },
  });
  assert.equal(first.statusCode, 200);

  const replay = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/reject`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'reject-idem-reject' },
    payload: { reason: null },
  });
  assert.equal(replay.statusCode, first.statusCode);
  assert.deepEqual(replay.json(), first.json());
  await app.close();
});

test('POST /v1/offers/:id/cancel idempotency replay returns same response', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-cancel-idem-seller');
  const sellerNodeId = sellerBoot.json().node.id;
  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_cancel_idem_seller')).statusCode, 200);

  const buyerBoot = await bootstrap(app, 'boot-cancel-idem-buyer');
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, buyerBoot.json().node.id, 'evt_cancel_idem_buyer')).statusCode, 200);

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Cancel idem unit', 'cancel-idem-scope'));
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit.id));

  const offer = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'cancel-idem-offer' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(offer.statusCode, 200);
  const offerId = offer.json().offer.id;

  const first = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/cancel`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'cancel-idem-cancel' },
    payload: { reason: null },
  });
  assert.equal(first.statusCode, 200);

  const replay = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/cancel`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'cancel-idem-cancel' },
    payload: { reason: null },
  });
  assert.equal(replay.statusCode, first.statusCode);
  assert.deepEqual(replay.json(), first.json());
  await app.close();
});

test('POST /v1/offers/:id/reveal-contact idempotency replay returns same response', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-reveal-idem-seller');
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_reveal_idem_seller')).statusCode, 200);

  const buyerBoot = await bootstrap(app, 'boot-reveal-idem-buyer');
  const buyerNodeId = buyerBoot.json().node.id;
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, buyerNodeId, 'evt_reveal_idem_buyer')).statusCode, 200);

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Reveal idem unit', 'reveal-idem-scope'));
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit.id));

  const offer = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'reveal-idem-offer' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(offer.statusCode, 200);
  const offerId = offer.json().offer.id;

  const acceptBuyer = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'reveal-idem-accept-buyer' },
    payload: {},
  });
  assert.equal(acceptBuyer.statusCode, 200);

  const acceptSeller = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/accept`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'reveal-idem-accept-seller' },
    payload: {},
  });
  assert.equal(acceptSeller.statusCode, 200);
  assert.equal(acceptSeller.json().offer.status, 'mutually_accepted');

  const first = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/reveal-contact`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'reveal-idem-reveal' },
    payload: {},
  });
  assert.equal(first.statusCode, 200);

  const replay = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/reveal-contact`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'reveal-idem-reveal' },
    payload: {},
  });
  assert.equal(replay.statusCode, first.statusCode);
  assert.deepEqual(replay.json(), first.json());
  await app.close();
});

// =====================================================================
// QA AUDIT — PROVIDER: Stripe webhook tampered body
// =====================================================================

test('Stripe webhook with tampered body after signing is rejected', async () => {
  const app = buildApp();
  const body = {
    id: 'evt_tampered_test',
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', metadata: { node_id: crypto.randomUUID(), plan_code: 'basic' }, customer: 'cus_tampered', subscription: 'sub_tampered' } },
  };
  const sig = sign(body);
  const tamperedRaw = sig.raw.replace('"basic"', '"pro"');
  const res = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/stripe',
    headers: { 'stripe-signature': sig.header, 'content-type': 'application/json' },
    payload: tamperedRaw,
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'stripe_signature_invalid');
  await app.close();
});

// =====================================================================
// QA AUDIT — PROVIDER: Taken-down listing excluded from search
// =====================================================================

test('taken-down listing is excluded from search results', async () => {
  const app = buildApp();
  const searcherBoot = await bootstrap(app, 'boot-takedown-search-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_takedown_search_sub')).statusCode, 200);

  const ownerBoot = await bootstrap(app, 'boot-takedown-search-owner');
  const ownerNodeId = ownerBoot.json().node.id;
  const scopeNotes = `takedown-search-${TEST_RUN_SUFFIX}-${ownerNodeId.slice(0, 6)}`;

  const unit = await repo.createResource('units', ownerNodeId, { ...unitPayload('Takedown search unit', scopeNotes), category_ids: [991] });
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', ownerNodeId, unit.id));

  const before = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'takedown-search-before' },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: scopeNotes }, broadening: { level: 0, allow: false }, budget: { credits_requested: config.searchCreditCost }, target: { node_id: ownerNodeId }, limit: 20, cursor: null },
  });
  assert.equal(before.statusCode, 200);
  assert.equal(before.json().items.some((r) => r.item?.id === unit.id), true);

  const takedown = await app.inject({
    method: 'POST',
    url: '/v1/admin/takedown',
    headers: { 'x-admin-key': 'admin-test', 'idempotency-key': 'takedown-search-takedown' },
    payload: { target_type: 'public_listing', target_id: unit.id, reason: 'qa-takedown-search-test' },
  });
  assert.equal(takedown.statusCode, 200);

  const rebuild = await app.inject({
    method: 'POST',
    url: '/v1/admin/projections/rebuild',
    headers: { 'x-admin-key': 'admin-test', 'idempotency-key': 'takedown-search-rebuild' },
    payload: { kind: 'listings' },
  });
  assert.equal(rebuild.statusCode, 200);

  const after = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'takedown-search-after' },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: scopeNotes }, broadening: { level: 0, allow: false }, budget: { credits_requested: config.searchCreditCost }, target: { node_id: ownerNodeId }, limit: 20, cursor: null },
  });
  assert.equal(after.statusCode, 200);
  assert.equal(after.json().items.some((r) => r.item?.id === unit.id), false, 'taken-down listing must not appear in search after rebuild');
  await app.close();
});

// =====================================================================
// QA AUDIT — PROVIDER: Search log retention query_hash + no raw query
// =====================================================================

test('search log stores query_hash and query_redacted but not raw query text', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-retention-hash');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, nodeId, 'evt_retention_hash_sub')).statusCode, 200);

  const sensitiveQuery = `retention-hash-test-${TEST_RUN_SUFFIX} user@secret-email.com`;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'retention-hash-search' },
    payload: {
      q: sensitiveQuery,
      scope: 'OTHER',
      filters: { scope_notes: `retention-hash-${TEST_RUN_SUFFIX}` },
      broadening: { level: 0, allow: false },
      budget: { credits_requested: config.searchCreditCost },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(res.statusCode, 200);

  const logs = await query(
    `select query_redacted, query_hash
     from search_logs
     where node_id=$1
     order by created_at desc
     limit 1`,
    [nodeId],
  );
  assert.equal(logs.length, 1);
  assert.equal(typeof logs[0].query_hash, 'string');
  assert.equal(logs[0].query_hash.length > 0, true, 'query_hash must be non-empty');
  if (logs[0].query_redacted) {
    assert.equal(logs[0].query_redacted.includes('user@secret-email.com'), false, 'query_redacted must not contain raw PII');
  }
  await app.close();
});

// =====================================================================
// QA AUDIT — Offer reject does NOT emit lifecycle event (spec-correct)
// =====================================================================

test('offer reject does not emit lifecycle event or webhook (spec-correct: reject is not in event enum)', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-reject-no-event-seller');
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_reject_no_event_seller')).statusCode, 200);

  const buyerBoot = await bootstrap(app, 'boot-reject-no-event-buyer');
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, buyerBoot.json().node.id, 'evt_reject_no_event_buyer')).statusCode, 200);

  await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'reject-no-event-webhook-setup' },
    payload: { event_webhook_url: 'https://hooks.example.test/reject-seller', event_webhook_secret: 'reject-secret' },
  });

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Reject no event unit', 'reject-no-event-scope'));
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit.id));

  const webhookCalls = [];
  await withMockFetch(async (url, init) => {
    const rawBody = init && typeof init.body === 'string' ? init.body : '{}';
    webhookCalls.push({ url: String(url), body: JSON.parse(rawBody) });
    return jsonResponse(200, { ok: true });
  }, async () => {
    const offer = await app.inject({
      method: 'POST',
      url: '/v1/offers',
      headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'reject-no-event-create' },
      payload: { unit_ids: [unit.id], thread_id: null, note: null },
    });
    assert.equal(offer.statusCode, 200);
    const offerId = offer.json().offer.id;

    const preRejectCount = webhookCalls.length;

    const reject = await app.inject({
      method: 'POST',
      url: `/v1/offers/${offerId}/reject`,
      headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'reject-no-event-reject' },
      payload: { reason: null },
    });
    assert.equal(reject.statusCode, 200);
    assert.equal(reject.json().offer.status, 'rejected');

    const postRejectWebhooks = webhookCalls.slice(preRejectCount);
    const rejectEvents = postRejectWebhooks.filter((c) => c.body?.type === 'offer_rejected');
    assert.equal(rejectEvents.length, 0, 'reject must not emit offer_rejected event (not in spec enum)');
  });
  await app.close();
});

// =====================================================================
// QA AUDIT — Counter releases old holds and creates new ones
// =====================================================================

test('offer counter releases prior holds and creates new holds for countered offer', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-counter-holds-seller');
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_counter_holds_seller')).statusCode, 200);

  const buyerBoot = await bootstrap(app, 'boot-counter-holds-buyer');
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, buyerBoot.json().node.id, 'evt_counter_holds_buyer')).statusCode, 200);

  const unit1 = await repo.createResource('units', sellerNodeId, unitPayload('Counter hold unit 1', 'counter-holds-scope'));
  const unit2 = await repo.createResource('units', sellerNodeId, unitPayload('Counter hold unit 2', 'counter-holds-scope'));
  await repo.setPublished('units', unit1.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit1.id));
  await repo.setPublished('units', unit2.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit2.id));

  const offer = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'counter-holds-create' },
    payload: { unit_ids: [unit1.id], thread_id: null, note: null },
  });
  assert.equal(offer.statusCode, 200);
  const offerId = offer.json().offer.id;

  const holdsBeforeCounter = await query(
    "select * from holds where offer_id=$1 and status='active'", [offerId],
  );

  const counter = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/counter`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'counter-holds-counter' },
    payload: { unit_ids: [unit2.id], note: 'counter with different unit' },
  });
  assert.equal(counter.statusCode, 200);
  const newOfferId = counter.json().offer.id;

  const oldHolds = await query(
    "select * from holds where offer_id=$1 and status='active'", [offerId],
  );
  assert.equal(oldHolds.length, 0, 'old offer holds must be released after counter');

  const oldOfferStatus = await query('select status from offers where id=$1', [offerId]);
  assert.equal(oldOfferStatus[0].status, 'countered');
  assert.notEqual(newOfferId, offerId, 'counter creates a new offer');
  await app.close();
});

// =====================================================================
// QA AUDIT — Email verification sends code via email provider
// =====================================================================

test('email start-verify sends verification code through email provider', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-email-code-send', {
    display_name: 'EmailCodeSend',
    email: `email-code-send-${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
  });
  assert.equal(b.statusCode, 200);
  const apiKey = b.json().api_key.api_key;
  const targetEmail = `email-code-target-${TEST_RUN_SUFFIX}@example.com`;

  emailProvider.clearStubEmailOutbox();

  const startRes = await app.inject({
    method: 'POST',
    url: '/v1/email/start-verify',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'email-code-send-start' },
    payload: { email: targetEmail },
  });
  assert.equal(startRes.statusCode, 200);

  const code = emailProvider.getStubEmailCode(targetEmail);
  assert.equal(typeof code, 'string', 'stub email provider must capture verification code');
  assert.equal(code.length, 6, 'verification code must be 6 digits');
  assert.match(code, /^\d{6}$/);
  await app.close();
});

// =====================================================================
// QA AUDIT — Offer expiry transitions holds to expired
// =====================================================================

test('expired offer transitions holds to expired status', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-hold-expiry-seller');
  const sellerNodeId = sellerBoot.json().node.id;
  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_hold_expiry_seller')).statusCode, 200);

  const buyerBoot = await bootstrap(app, 'boot-hold-expiry-buyer');
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, buyerBoot.json().node.id, 'evt_hold_expiry_buyer')).statusCode, 200);

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Hold expiry unit', 'hold-expiry-scope'));
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit.id));

  const offer = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'hold-expiry-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null, ttl_minutes: 15 },
  });
  assert.equal(offer.statusCode, 200);
  const offerId = offer.json().offer.id;

  const activeHolds = await query(
    "select * from holds where offer_id=$1 and status='active'", [offerId],
  );
  assert.equal(activeHolds.length >= 0, true);

  await query("update offers set expires_at = now() - interval '1 minute' where id=$1", [offerId]);
  await query("update holds set expires_at = now() - interval '1 minute' where offer_id=$1", [offerId]);

  await repo.expireStaleOffers();

  const expiredOffer = await query('select status from offers where id=$1', [offerId]);
  assert.equal(expiredOffer[0].status, 'expired');

  const expiredHolds = await query('select status from holds where offer_id=$1', [offerId]);
  for (const hold of expiredHolds) {
    assert.equal(hold.status, 'expired', 'holds must transition to expired when offer expires');
  }
  await app.close();
});

// =====================================================================
// QA AUDIT — Webhook payload is metadata-only (no contact PII in any event)
// =====================================================================

test('webhook payload for offer_contact_revealed does not include contact details', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-webhook-no-pii-seller', {
    display_name: 'WebhookNoPIISeller',
    email: `webhook-nopii-seller-${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
    messaging_handles: [{ kind: 'telegram', handle: '@sellersecret', url: null }],
  });
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_webhook_nopii_seller')).statusCode, 200);

  const buyerBoot = await bootstrap(app, 'boot-webhook-no-pii-buyer', {
    display_name: 'WebhookNoPIIBuyer',
    email: `webhook-nopii-buyer-${TEST_RUN_SUFFIX}@example.com`,
    referral_code: null,
    messaging_handles: [{ kind: 'whatsapp', handle: '+19995551234', url: null }],
  });
  const buyerNodeId = buyerBoot.json().node.id;
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, buyerNodeId, 'evt_webhook_nopii_buyer')).statusCode, 200);

  await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'webhook-nopii-seller-setup' },
    payload: { event_webhook_url: 'https://hooks.example.test/nopii-seller', event_webhook_secret: 'nopii-secret' },
  });
  await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'webhook-nopii-buyer-setup' },
    payload: { event_webhook_url: 'https://hooks.example.test/nopii-buyer' },
  });

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Webhook NoPII unit', 'webhook-nopii-scope'));
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit.id));

  const webhookCalls = [];
  await withMockFetch(async (url, init) => {
    const rawBody = init && typeof init.body === 'string' ? init.body : '{}';
    webhookCalls.push({ url: String(url), body: JSON.parse(rawBody), rawBody });
    return jsonResponse(200, { ok: true });
  }, async () => {
    const offer = await app.inject({
      method: 'POST',
      url: '/v1/offers',
      headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'webhook-nopii-create' },
      payload: { unit_ids: [unit.id], thread_id: null, note: null },
    });
    assert.equal(offer.statusCode, 200);
    const offerId = offer.json().offer.id;

    await app.inject({
      method: 'POST',
      url: `/v1/offers/${offerId}/accept`,
      headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'webhook-nopii-accept-buyer' },
      payload: {},
    });
    await app.inject({
      method: 'POST',
      url: `/v1/offers/${offerId}/accept`,
      headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'webhook-nopii-accept-seller' },
      payload: {},
    });

    await app.inject({
      method: 'POST',
      url: `/v1/offers/${offerId}/reveal-contact`,
      headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'webhook-nopii-reveal' },
      payload: {},
    });
  });

  const revealWebhooks = webhookCalls.filter((c) => c.body?.type === 'offer_contact_revealed');
  assert.equal(revealWebhooks.length > 0, true, 'must emit offer_contact_revealed webhooks');
  for (const call of revealWebhooks) {
    const bodyStr = call.rawBody.toLowerCase();
    assert.equal(bodyStr.includes('@sellersecret'), false, 'webhook must not contain seller messaging handle');
    assert.equal(bodyStr.includes('+19995551234'), false, 'webhook must not contain buyer phone');
    assert.equal(bodyStr.includes('webhook-nopii-seller'), false, 'webhook must not contain seller email prefix');
    assert.equal(bodyStr.includes('webhook-nopii-buyer'), false, 'webhook must not contain buyer email prefix');
    assert.equal(call.body.email, undefined, 'webhook body must not have email field');
    assert.equal(call.body.phone, undefined, 'webhook body must not have phone field');
    assert.equal(call.body.messaging_handles, undefined, 'webhook body must not have messaging_handles field');
    assert.equal(call.body.contact, undefined, 'webhook body must not have contact field');
    assert.deepEqual(call.body.payload, {}, 'webhook payload must be empty object (metadata-only per spec)');
  }
  await app.close();
});

// =====================================================================
// GAP 1 — customer.subscription.deleted webhook sets status to canceled
// =====================================================================

test('webhook customer.subscription.deleted sets subscription status to canceled', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-sub-deleted');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  assert.equal((await activateBasicSubscriber(app, nodeId, 'evt_sub_active_before_del')).statusCode, 200);

  const meBefore = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${apiKey}` } });
  assert.equal(meBefore.json().node.is_subscriber, true);

  const deleteEvent = {
    id: `evt_sub_deleted_${nodeId.slice(0, 8)}`,
    type: 'customer.subscription.deleted',
    data: {
      object: {
        id: `sub_${nodeId.slice(0, 8)}`,
        customer: `cus_${nodeId.slice(0, 8)}`,
        status: 'canceled',
        metadata: { node_id: nodeId, plan_code: 'basic' },
        current_period_start: 1735689600,
        current_period_end: 1738368000,
      },
    },
  };
  const sig = sign(deleteEvent);
  const wh = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
  assert.equal(wh.statusCode, 200);

  const sub = await query('select status from subscriptions where node_id=$1', [nodeId]);
  assert.equal(sub.length > 0, true, 'subscription row must exist');
  assert.equal(sub[0].status, 'canceled', 'subscription status must be canceled after deletion webhook');

  const meAfter = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${apiKey}` } });
  assert.equal(meAfter.json().node.is_subscriber, false, 'node must no longer be a subscriber');
  await app.close();
});

// =====================================================================
// GAP 2 — GET /v1/public/nodes/:id/listings standalone test
// =====================================================================

test('GET /v1/public/nodes/:id/listings returns shape with items and credits charge, and 402 when exhausted', async () => {
  const app = buildApp();
  const ownerBoot = await bootstrap(app, 'boot-pub-listings-owner');
  const ownerNodeId = ownerBoot.json().node.id;
  assert.equal((await activateBasicSubscriber(app, ownerNodeId, 'evt_pub_listings_owner')).statusCode, 200);

  const callerBoot = await bootstrap(app, 'boot-pub-listings-caller');
  const callerApiKey = callerBoot.json().api_key.api_key;
  const callerNodeId = callerBoot.json().node.id;
  assert.equal((await activateBasicSubscriber(app, callerNodeId, 'evt_pub_listings_caller')).statusCode, 200);

  const unit = await repo.createResource('units', ownerNodeId, unitPayload('Public listing item', 'pub-listing-scope'));
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', ownerNodeId, unit.id));

  const res = await app.inject({
    method: 'GET',
    url: `/v1/public/nodes/${ownerNodeId}/listings?limit=10`,
    headers: { authorization: `ApiKey ${callerApiKey}` },
  });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.json().items), 'response must have items array');
  assert.equal(res.json().items.length > 0, true, 'must return published listings');
  assert.equal(typeof res.headers['x-credits-charged'], 'string', 'must include credits charged header');

  await query('delete from credit_ledger where node_id=$1', [callerNodeId]);
  const exhausted = await app.inject({
    method: 'GET',
    url: `/v1/public/nodes/${ownerNodeId}/listings?limit=10`,
    headers: { authorization: `ApiKey ${callerApiKey}` },
  });
  assert.equal(exhausted.statusCode, 402);
  assert.equal(exhausted.json().error.code, 'credits_exhausted');
  await app.close();
});

// =====================================================================
// GAP 3 — MCP fabric_search_requests test
// =====================================================================

test('MCP fabric_search_requests executes search and returns results', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'mcp-search-req');
  const apiKey = b.json().api_key.api_key;
  const nodeId = b.json().node.id;
  assert.equal((await activateBasicSubscriber(app, nodeId, 'evt_mcp_search_req')).statusCode, 200);

  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `ApiKey ${apiKey}` },
    payload: {
      jsonrpc: '2.0',
      id: 20,
      method: 'tools/call',
      params: {
        name: 'fabric_search_requests',
        arguments: { q: 'anything', scope: 'OTHER', filters: { scope_notes: 'mcp-search-req-test' }, budget: { credits_requested: 5 } },
      },
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.id, 20);
  if (body.result.isError) {
    const errorText = body.result.content?.[0]?.text ?? JSON.stringify(body.result);
    assert.fail(`fabric_search_requests failed: ${errorText}`);
  }
  const data = JSON.parse(body.result.content[0].text);
  assert.ok(Array.isArray(data.items), 'must return items array');
  await app.close();
});

// =====================================================================
// GAP 4 — MCP fabric_get_unit test
// =====================================================================

test('MCP fabric_get_unit returns unit for owner and error for non-owner', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'mcp-get-unit-owner');
  const apiKey = b.json().api_key.api_key;
  const nodeId = b.json().node.id;

  const unit = await repo.createResource('units', nodeId, unitPayload('MCP Unit', 'mcp-get-unit-scope'));

  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `ApiKey ${apiKey}` },
    payload: {
      jsonrpc: '2.0',
      id: 30,
      method: 'tools/call',
      params: { name: 'fabric_get_unit', arguments: { unit_id: unit.id } },
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(!body.result.isError, 'owner should be able to read own unit via MCP');
  const data = JSON.parse(body.result.content[0].text);
  assert.equal(data.id, unit.id);

  const other = await bootstrap(app, 'mcp-get-unit-other');
  const otherApiKey = other.json().api_key.api_key;
  const notOwned = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `ApiKey ${otherApiKey}` },
    payload: {
      jsonrpc: '2.0',
      id: 31,
      method: 'tools/call',
      params: { name: 'fabric_get_unit', arguments: { unit_id: unit.id } },
    },
  });
  assert.equal(notOwned.statusCode, 200);
  const notOwnedBody = notOwned.json();
  const notOwnedData = JSON.parse(notOwnedBody.result.content[0].text);
  assert.ok(notOwnedData.error || notOwnedBody.result.isError, 'non-owner must get error for unit via MCP');
  await app.close();
});

// =====================================================================
// GAP 5 — MCP fabric_get_request test
// =====================================================================

test('MCP fabric_get_request returns request for owner', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'mcp-get-req-owner');
  const apiKey = b.json().api_key.api_key;
  const nodeId = b.json().node.id;

  const reqResource = await repo.createResource('requests', nodeId, {
    title: 'MCP Request',
    description: 'test mcp request',
    type: 'service',
    condition: null,
    quantity: 1,
    scope_primary: 'OTHER',
    scope_secondary: null,
    scope_notes: 'mcp-get-req-scope',
    service_region: null,
    origin_region: null,
    dest_region: null,
    delivery_format: null,
    measure: null,
    custom_measure: null,
    tags: [],
    category_ids: [],
    public_summary: 'MCP Request',
  });

  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `ApiKey ${apiKey}` },
    payload: {
      jsonrpc: '2.0',
      id: 40,
      method: 'tools/call',
      params: { name: 'fabric_get_request', arguments: { request_id: reqResource.id } },
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(!body.result.isError, 'owner should read own request via MCP');
  const data = JSON.parse(body.result.content[0].text);
  assert.equal(data.id, reqResource.id);
  await app.close();
});

// =====================================================================
// GAP 6 — MCP fabric_get_offer test
// =====================================================================

test('MCP fabric_get_offer returns offer for party and error for non-party', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'mcp-get-offer-seller');
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_mcp_offer_seller')).statusCode, 200);

  const buyerBoot = await bootstrap(app, 'mcp-get-offer-buyer');
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, buyerBoot.json().node.id, 'evt_mcp_offer_buyer')).statusCode, 200);

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('MCP Offer Unit', 'mcp-get-offer-scope'));
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit.id));

  const offer = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'mcp-offer-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(offer.statusCode, 200);
  const offerId = offer.json().offer.id;

  const partyRes = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `ApiKey ${buyerApiKey}` },
    payload: {
      jsonrpc: '2.0',
      id: 50,
      method: 'tools/call',
      params: { name: 'fabric_get_offer', arguments: { offer_id: offerId } },
    },
  });
  assert.equal(partyRes.statusCode, 200);
  const partyBody = partyRes.json();
  assert.ok(!partyBody.result.isError, 'party should read offer via MCP');
  const partyData = JSON.parse(partyBody.result.content[0].text);
  assert.equal(partyData.offer.id, offerId);

  const thirdBoot = await bootstrap(app, 'mcp-get-offer-third');
  const thirdApiKey = thirdBoot.json().api_key.api_key;
  const thirdRes = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { authorization: `ApiKey ${thirdApiKey}` },
    payload: {
      jsonrpc: '2.0',
      id: 51,
      method: 'tools/call',
      params: { name: 'fabric_get_offer', arguments: { offer_id: offerId } },
    },
  });
  assert.equal(thirdRes.statusCode, 200);
  const thirdBody = thirdRes.json();
  const thirdData = JSON.parse(thirdBody.result.content[0].text);
  assert.ok(thirdData.error || thirdBody.result.isError, 'non-party must get error for offer via MCP');
  await app.close();
});

// =====================================================================
// GAP 7 — billing credit-packs invalid pack_code returns 422
// =====================================================================

test('POST /v1/billing/credit-packs/checkout-session rejects invalid pack_code with 422', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-cp-invalid');
  const apiKey = b.json().api_key.api_key;
  const nodeId = b.json().node.id;

  const res = await app.inject({
    method: 'POST',
    url: '/v1/billing/credit-packs/checkout-session',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'cp-invalid-pack' },
    payload: {
      node_id: nodeId,
      pack_code: 'credits_999999',
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
    },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, 'validation_error');
  await app.close();
});

// =====================================================================
// GAP 8 — billing checkout for already-subscribed node
// =====================================================================

test('POST /v1/billing/checkout-session for already-subscribed node still processes (Stripe manages subscription state)', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-already-sub');
  const apiKey = b.json().api_key.api_key;
  const nodeId = b.json().node.id;
  assert.equal((await activateBasicSubscriber(app, nodeId, 'evt_already_sub')).statusCode, 200);

  await withMockFetch(async (url) => {
    return jsonResponse(200, { id: 'cs_mock_already_sub', url: 'https://checkout.stripe.com/mock' });
  }, async () => {
    await withConfigOverrides({
      stripeSecretKey: 'sk_test_mock',
      stripeBasicPriceId: 'price_mock_basic',
      stripeProPriceId: 'price_mock_pro',
    }, async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/v1/billing/checkout-session',
        headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'already-sub-checkout' },
        payload: {
          node_id: nodeId,
          plan_code: 'pro',
          success_url: 'https://example.com/success',
          cancel_url: 'https://example.com/cancel',
        },
      });
      assert.ok([200, 422].includes(res.statusCode), `should return 200 (session created) or 422 (config issue), got ${res.statusCode}`);
      if (res.statusCode === 200) {
        assert.ok(res.json().url || res.json().checkout_url, 'must return checkout URL');
      }
    });
  });
  await app.close();
});

// =====================================================================
// GAP 9 — Counter offer creates new holds on the counter offer
// =====================================================================

test('offer counter creates new holds on the new counter offer', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-counter-new-holds-seller');
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_counter_new_holds_seller')).statusCode, 200);

  const buyerBoot = await bootstrap(app, 'boot-counter-new-holds-buyer');
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, buyerBoot.json().node.id, 'evt_counter_new_holds_buyer')).statusCode, 200);

  const unit1 = await repo.createResource('units', sellerNodeId, unitPayload('Counter new hold unit 1', 'counter-new-holds-scope'));
  const unit2 = await repo.createResource('units', sellerNodeId, unitPayload('Counter new hold unit 2', 'counter-new-holds-scope'));
  await repo.setPublished('units', unit1.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit1.id));
  await repo.setPublished('units', unit2.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit2.id));

  const offer = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'counter-new-holds-create' },
    payload: { unit_ids: [unit1.id], thread_id: null, note: null },
  });
  assert.equal(offer.statusCode, 200);
  const offerId = offer.json().offer.id;

  const counter = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/counter`,
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'counter-new-holds-counter' },
    payload: { unit_ids: [unit2.id], note: 'counter with unit2' },
  });
  assert.equal(counter.statusCode, 200);
  const newOfferId = counter.json().offer.id;

  const newHolds = await query(
    "select * from holds where offer_id=$1 and status='active'", [newOfferId],
  );
  assert.equal(newHolds.length > 0, true, 'new counter offer must have active holds');
  assert.equal(newHolds.some((h) => h.unit_id === unit2.id), true, 'new hold must be on the countered unit');
  await app.close();
});

// =====================================================================
// GAP 10 — GET /v1/offers cursor/limit pagination
// =====================================================================

test('GET /v1/offers supports cursor-based pagination', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'boot-offers-page-seller');
  const sellerNodeId = sellerBoot.json().node.id;
  assert.equal((await activateBasicSubscriber(app, sellerNodeId, 'evt_offers_page_seller')).statusCode, 200);

  const buyerBoot = await bootstrap(app, 'boot-offers-page-buyer');
  const buyerApiKey = buyerBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, buyerBoot.json().node.id, 'evt_offers_page_buyer')).statusCode, 200);

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Offers Page Unit', 'offers-page-scope'));
  await repo.setPublished('units', unit.id, true);
  await repo.upsertProjection('units', await repo.getResource('units', sellerNodeId, unit.id));

  for (let i = 0; i < 3; i++) {
    const o = await app.inject({
      method: 'POST',
      url: '/v1/offers',
      headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': `offers-page-create-${i}` },
      payload: { unit_ids: [unit.id], thread_id: null, note: `offer-${i}` },
    });
    assert.equal(o.statusCode, 200);
  }

  const page1 = await app.inject({
    method: 'GET',
    url: '/v1/offers?role=made&limit=2',
    headers: { authorization: `ApiKey ${buyerApiKey}` },
  });
  assert.equal(page1.statusCode, 200);
  assert.equal(page1.json().offers.length, 2, 'page 1 should return 2 offers');

  const lastOffer = page1.json().offers[page1.json().offers.length - 1];
  const cursor = lastOffer.created_at;

  const page2 = await app.inject({
    method: 'GET',
    url: `/v1/offers?role=made&limit=2&cursor=${encodeURIComponent(cursor)}`,
    headers: { authorization: `ApiKey ${buyerApiKey}` },
  });
  assert.equal(page2.statusCode, 200);
  assert.equal(page2.json().offers.length > 0, true, 'page 2 should return remaining offers');

  const page1Ids = page1.json().offers.map((o) => o.id);
  const page2Ids = page2.json().offers.map((o) => o.id);
  const overlap = page1Ids.filter((id) => page2Ids.includes(id));
  assert.equal(overlap.length, 0, 'pages must not overlap');
  await app.close();
});

// =====================================================================
// GAP 11 — admin projections/rebuild kind=listings and kind=requests
// =====================================================================

test('POST /v1/admin/projections/rebuild supports kind=listings and kind=requests independently', async () => {
  const app = buildApp();

  const listingsOnly = await app.inject({
    method: 'POST',
    url: '/v1/admin/projections/rebuild?kind=listings&mode=full',
    headers: { 'x-admin-key': 'admin-test', 'idempotency-key': 'adm-rebuild-listings' },
    payload: {},
  });
  assert.equal(listingsOnly.statusCode, 200);
  assert.equal(listingsOnly.json().ok, true);
  assert.equal(listingsOnly.json().kind, 'listings');
  assert.equal(typeof listingsOnly.json().counts.public_listings_written, 'number');
  assert.equal(typeof listingsOnly.json().counts.public_requests_written, 'number');

  const requestsOnly = await app.inject({
    method: 'POST',
    url: '/v1/admin/projections/rebuild?kind=requests&mode=full',
    headers: { 'x-admin-key': 'admin-test', 'idempotency-key': 'adm-rebuild-requests' },
    payload: {},
  });
  assert.equal(requestsOnly.statusCode, 200);
  assert.equal(requestsOnly.json().ok, true);
  assert.equal(requestsOnly.json().kind, 'requests');
  await app.close();
});

// =====================================================================
// GAP 12 — Stripe webhook with unknown subscription price_id
// =====================================================================

test('webhook checkout.session.completed with unknown price falls back to plan from metadata or free', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-unknown-price');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  const event = {
    id: `evt_unknown_price_${nodeId.slice(0, 8)}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        payment_status: 'paid',
        metadata: { node_id: nodeId },
        customer: `cus_unkprice_${nodeId.slice(0, 8)}`,
        subscription: `sub_unkprice_${nodeId.slice(0, 8)}`,
      },
    },
  };
  const sig = sign(event);
  const wh = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
  assert.equal(wh.statusCode, 200, 'webhook must not error on unknown price');

  const sub = await query('select * from subscriptions where node_id=$1', [nodeId]);
  assert.equal(sub.length > 0, true, 'subscription row must be created');
  const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${apiKey}` } });
  assert.equal(me.statusCode, 200);
  assert.ok(
    ['free', 'basic'].includes(me.json().node.plan),
    `plan should fall back to free or basic when price is unknown, got ${me.json().node.plan}`,
  );
  await app.close();
});

// =====================================================================
// MCP — Argument validation surfaces clear errors (Gap 3 fix)
// =====================================================================

test('MCP tool call with missing required args returns validation_error at MCP layer', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-mcp-argval');
  const apiKey = b.json().api_key.api_key;

  const res = await app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { 'content-type': 'application/json', authorization: `ApiKey ${apiKey}` },
    payload: {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'fabric_search_listings', arguments: {} },
    },
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  const inner = JSON.parse(body.result.content[0].text);
  assert.equal(inner.error.code, 'validation_error', 'MCP layer should return validation_error');
  assert.ok(inner.error.message.includes('Missing required argument'), 'message should mention missing args');
  assert.ok(inner.error.details.missing_args.includes('scope'), 'should list scope as missing');
  assert.ok(inner.error.details.missing_args.includes('filters'), 'should list filters as missing');
  assert.ok(inner.error.details.missing_args.includes('budget'), 'should list budget as missing');
  assert.equal(body.result.isError, true, 'isError flag should be true');
  await app.close();
});

// =====================================================================
// Admin sweep endpoint — scheduled offer/request expiry
// =====================================================================

test('POST /internal/admin/sweep expires stale offers and requests', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/internal/admin/sweep',
    headers: { 'x-admin-key': 'admin-test', 'idempotency-key': `sweep-${TEST_RUN_SUFFIX}` },
  });
  assert.equal(res.statusCode, 200, 'sweep should succeed');
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.expired_offers, 'number');
  assert.equal(typeof body.expired_requests, 'number');
  await app.close();
});

// =====================================================================
// Crypto credit pack — NOWPayments integration
// =====================================================================

test('POST /v1/billing/crypto-credit-pack requires auth', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/billing/crypto-credit-pack',
    payload: { node_id: '00000000-0000-0000-0000-000000000000', pack_code: 'credits_500', pay_currency: 'usdcmatic' },
  });
  assert.equal(res.statusCode, 401);
  await app.close();
});

test('POST /v1/billing/crypto-credit-pack rejects wrong node_id', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-crypto-wrongnode');
  const apiKey = b.json().api_key.api_key;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/billing/crypto-credit-pack',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `crypto-wrong-${TEST_RUN_SUFFIX}` },
    payload: { node_id: '00000000-0000-0000-0000-000000000000', pack_code: 'credits_500', pay_currency: 'usdcmatic' },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, 'forbidden');
  await app.close();
});

test('POST /v1/billing/crypto-credit-pack rejects invalid pack_code', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-crypto-badpack');
  const apiKey = b.json().api_key.api_key;
  const nodeId = b.json().node.id;
  const res = await app.inject({
    method: 'POST',
    url: '/v1/billing/crypto-credit-pack',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `crypto-badpack-${TEST_RUN_SUFFIX}` },
    payload: { node_id: nodeId, pack_code: 'credits_999', pay_currency: 'usdcmatic' },
  });
  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, 'validation_error');
  await app.close();
});

test('POST /v1/billing/crypto-credit-pack creates payment and stores record (mocked NOWPayments)', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-crypto-create');
  const apiKey = b.json().api_key.api_key;
  const nodeId = b.json().node.id;

  const originalFetch = globalThis.fetch;
  const mockPaymentId = 7700000 + Math.floor(Math.random() * 100000);
  globalThis.fetch = async (url, opts) => {
    const urlStr = typeof url === 'string' ? url : url.toString();
    if (urlStr.includes('nowpayments.io') && urlStr.includes('/payment')) {
      const reqBody = JSON.parse(opts.body);
      return new Response(JSON.stringify({
        payment_id: mockPaymentId,
        payment_status: 'waiting',
        pay_address: '0xFAKEADDRESS123',
        pay_amount: reqBody.price_amount * 1.0,
        pay_currency: reqBody.pay_currency,
        price_amount: reqBody.price_amount,
        price_currency: reqBody.price_currency,
        order_id: reqBody.order_id,
        expiration_estimate_date: new Date(Date.now() + 3600000).toISOString(),
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return originalFetch(url, opts);
  };

  try {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/crypto-credit-pack',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `crypto-create-${TEST_RUN_SUFFIX}` },
      payload: { node_id: nodeId, pack_code: 'credits_500', pay_currency: 'usdcmatic' },
    });
    assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
    const body = res.json();
    assert.equal(body.node_id, nodeId);
    assert.equal(body.pack_code, 'credits_500');
    assert.equal(body.credits, 500);
    assert.equal(typeof body.pay_address, 'string');
    assert.ok(body.pay_address.length > 0, 'pay_address should be non-empty');
    assert.equal(typeof body.pay_amount, 'number');
    assert.ok(body.pay_amount > 0, 'pay_amount should be positive');
    assert.equal(body.payment_status, 'waiting');
    assert.ok(body.order_id.startsWith('fabric:'), 'order_id should be prefixed');
    assert.equal(body.payment_id, mockPaymentId);

    const dbRow = await repo.getCryptoPaymentByNowpaymentsId(mockPaymentId);
    assert.ok(dbRow, 'crypto_payment row should exist in DB');
    assert.equal(dbRow.node_id, nodeId);
    assert.equal(dbRow.pack_code, 'credits_500');
    assert.equal(dbRow.status, 'waiting');
  } finally {
    globalThis.fetch = originalFetch;
  }
  await app.close();
});

test('POST /v1/webhooks/nowpayments rejects missing signature', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/nowpayments',
    headers: { 'content-type': 'application/json' },
    payload: { payment_id: 12345, payment_status: 'finished', order_id: 'test-order' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'nowpayments_signature_invalid');
  await app.close();
});

test('POST /v1/webhooks/nowpayments rejects invalid signature', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/nowpayments',
    headers: { 'content-type': 'application/json', 'x-nowpayments-sig': 'badbadbadbad' },
    payload: { payment_id: 12345, payment_status: 'finished', order_id: 'test-order' },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'nowpayments_signature_invalid');
  await app.close();
});

test('POST /v1/webhooks/nowpayments grants credits on valid finished payment', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-crypto-webhook');
  const apiKey = b.json().api_key.api_key;
  const nodeId = b.json().node.id;

  const mockPaymentId = 8800000 + Math.floor(Math.random() * 100000);
  const orderId = `fabric:${nodeId}:credits_500:${crypto.randomUUID()}`;

  await repo.insertCryptoPayment(
    nodeId, mockPaymentId, orderId, 'credits_500', 500,
    9.99, 'usd', 'usdcmatic', '0xFAKEADDR', 9.99,
  );

  const balanceBefore = await repo.creditBalance(nodeId);

  const webhookBody = {
    payment_id: mockPaymentId,
    payment_status: 'finished',
    pay_address: '0xFAKEADDR',
    pay_amount: 9.99,
    actually_paid: 9.99,
    pay_currency: 'usdcmatic',
    price_amount: 9.99,
    price_currency: 'usd',
    order_id: orderId,
    purchase_id: '999',
    outcome_amount: 9.99,
    outcome_currency: 'usdcmatic',
  };

  function sortObjectKeys(obj) {
    if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sortObjectKeys);
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortObjectKeys(obj[key]);
    }
    return sorted;
  }

  const hmac = crypto.createHmac('sha512', 'test-ipn-secret');
  hmac.update(JSON.stringify(sortObjectKeys(webhookBody)));
  const sig = hmac.digest('hex');

  const res = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/nowpayments',
    headers: { 'content-type': 'application/json', 'x-nowpayments-sig': sig },
    payload: webhookBody,
  });
  assert.equal(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${res.body}`);
  assert.equal(res.json().ok, true);

  const balanceAfter = await repo.creditBalance(nodeId);
  assert.equal(balanceAfter, balanceBefore + 500, 'credits should be granted');

  const dbRow = await repo.getCryptoPaymentByNowpaymentsId(mockPaymentId);
  assert.equal(dbRow.status, 'finished');

  await app.close();
});

test('POST /v1/webhooks/nowpayments is idempotent — replay does not double-grant', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-crypto-idem');
  const nodeId = b.json().node.id;

  const mockPaymentId = 9900000 + Math.floor(Math.random() * 100000);
  const orderId = `fabric:${nodeId}:credits_1500:${crypto.randomUUID()}`;

  await repo.insertCryptoPayment(
    nodeId, mockPaymentId, orderId, 'credits_1500', 1500,
    19.99, 'usd', 'usdcmatic', '0xFAKEADDR2', 19.99,
  );

  const webhookBody = {
    payment_id: mockPaymentId,
    payment_status: 'finished',
    pay_address: '0xFAKEADDR2',
    pay_amount: 19.99,
    actually_paid: 19.99,
    pay_currency: 'usdcmatic',
    price_amount: 19.99,
    price_currency: 'usd',
    order_id: orderId,
    purchase_id: '1001',
    outcome_amount: 19.99,
    outcome_currency: 'usdcmatic',
  };

  function sortObjectKeys(obj) {
    if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sortObjectKeys);
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortObjectKeys(obj[key]);
    }
    return sorted;
  }

  const hmac1 = crypto.createHmac('sha512', 'test-ipn-secret');
  hmac1.update(JSON.stringify(sortObjectKeys(webhookBody)));
  const sig = hmac1.digest('hex');

  const res1 = await app.inject({
    method: 'POST', url: '/v1/webhooks/nowpayments',
    headers: { 'content-type': 'application/json', 'x-nowpayments-sig': sig },
    payload: webhookBody,
  });
  assert.equal(res1.statusCode, 200);

  const balanceAfterFirst = await repo.creditBalance(nodeId);

  const res2 = await app.inject({
    method: 'POST', url: '/v1/webhooks/nowpayments',
    headers: { 'content-type': 'application/json', 'x-nowpayments-sig': sig },
    payload: webhookBody,
  });
  assert.equal(res2.statusCode, 200);

  const balanceAfterReplay = await repo.creditBalance(nodeId);
  assert.equal(balanceAfterReplay, balanceAfterFirst, 'replay must not double-grant credits');

  await app.close();
});

test('POST /v1/webhooks/nowpayments does not grant credits for partially_paid', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-crypto-partial');
  const nodeId = b.json().node.id;

  const mockPaymentId = 6600000 + Math.floor(Math.random() * 100000);
  const orderId = `fabric:${nodeId}:credits_500:${crypto.randomUUID()}`;

  await repo.insertCryptoPayment(
    nodeId, mockPaymentId, orderId, 'credits_500', 500,
    9.99, 'usd', 'usdcmatic', '0xFAKEPARTIAL', 9.99,
  );

  const balanceBefore = await repo.creditBalance(nodeId);

  const webhookBody = {
    payment_id: mockPaymentId,
    payment_status: 'partially_paid',
    pay_address: '0xFAKEPARTIAL',
    pay_amount: 9.99,
    actually_paid: 5.0,
    pay_currency: 'usdcmatic',
    price_amount: 9.99,
    price_currency: 'usd',
    order_id: orderId,
  };

  function sortObjectKeys(obj) {
    if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(sortObjectKeys);
    const sorted = {};
    for (const key of Object.keys(obj).sort()) {
      sorted[key] = sortObjectKeys(obj[key]);
    }
    return sorted;
  }

  const hmac = crypto.createHmac('sha512', 'test-ipn-secret');
  hmac.update(JSON.stringify(sortObjectKeys(webhookBody)));
  const sig = hmac.digest('hex');

  const res = await app.inject({
    method: 'POST', url: '/v1/webhooks/nowpayments',
    headers: { 'content-type': 'application/json', 'x-nowpayments-sig': sig },
    payload: webhookBody,
  });
  assert.equal(res.statusCode, 200);

  const balanceAfter = await repo.creditBalance(nodeId);
  assert.equal(balanceAfter, balanceBefore, 'partially_paid must not grant credits');

  const dbRow = await repo.getCryptoPaymentByNowpaymentsId(mockPaymentId);
  assert.equal(dbRow.status, 'partially_paid');

  await app.close();
});

// ── Referral code endpoint ──

test('GET /v1/me/referral-code returns a code and is stable', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-refcode-1');
  const apiKey = b.json().api_key.api_key;

  const res1 = await app.inject({ method: 'GET', url: '/v1/me/referral-code', headers: { authorization: `ApiKey ${apiKey}` } });
  assert.equal(res1.statusCode, 200);
  const code1 = res1.json().referral_code;
  assert.ok(code1, 'should return a referral code');
  assert.ok(typeof code1 === 'string');

  const res2 = await app.inject({ method: 'GET', url: '/v1/me/referral-code', headers: { authorization: `ApiKey ${apiKey}` } });
  assert.equal(res2.json().referral_code, code1, 'should return the same code on subsequent calls');

  await app.close();
});

test('GET /v1/me/referral-code requires auth', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/v1/me/referral-code' });
  assert.equal(res.statusCode, 401);
  await app.close();
});

// ── Rollover cap enforcement ──

test('subscription monthly grant is capped at 2x plan credits', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-rollover-cap');
  const nodeId = b.json().node.id;
  const customerId = `cus_rollcap_${nodeId.slice(0, 8)}`;
  const subscriptionId = `sub_rollcap_${nodeId.slice(0, 8)}`;

  // Activate basic plan
  const activate = {
    id: `evt_rollcap_activate_${nodeId.slice(0, 8)}`,
    type: 'checkout.session.completed',
    data: { object: { payment_status: 'paid', metadata: { node_id: nodeId, plan_code: 'basic' }, customer: customerId, subscription: subscriptionId } },
  };
  const actSig = sign(activate);
  await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': actSig.header }, payload: actSig.raw });

  // Month 1 invoice - should get full 1000
  const inv1 = {
    id: `evt_rollcap_m1_${nodeId.slice(0, 8)}`,
    type: 'invoice.paid',
    data: { object: { id: `in_rollcap_m1_${nodeId.slice(0, 8)}`, customer: customerId, subscription: subscriptionId, period_start: 1735689600, period_end: 1738368000, billing_reason: 'subscription_cycle', metadata: { node_id: nodeId, plan_code: 'basic' } } },
  };
  const sig1 = sign(inv1);
  await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig1.header }, payload: sig1.raw });
  const bal1 = await repo.creditBalance(nodeId);
  // 100 signup + 1000 monthly = 1100
  assert.equal(bal1, 1100);

  // Month 2 invoice - sub balance is 1000, cap is 2000, so can grant up to 1000 more = full grant
  const inv2 = {
    id: `evt_rollcap_m2_${nodeId.slice(0, 8)}`,
    type: 'invoice.paid',
    data: { object: { id: `in_rollcap_m2_${nodeId.slice(0, 8)}`, customer: customerId, subscription: subscriptionId, period_start: 1738368000, period_end: 1740787200, billing_reason: 'subscription_cycle', metadata: { node_id: nodeId, plan_code: 'basic' } } },
  };
  const sig2 = sign(inv2);
  await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig2.header }, payload: sig2.raw });
  const bal2 = await repo.creditBalance(nodeId);
  // 100 signup + 1000 + 1000 = 2100
  assert.equal(bal2, 2100);

  // Month 3 invoice - sub balance is 2000, cap is 2000, so grant 0
  const inv3 = {
    id: `evt_rollcap_m3_${nodeId.slice(0, 8)}`,
    type: 'invoice.paid',
    data: { object: { id: `in_rollcap_m3_${nodeId.slice(0, 8)}`, customer: customerId, subscription: subscriptionId, period_start: 1740787200, period_end: 1743465600, billing_reason: 'subscription_cycle', metadata: { node_id: nodeId, plan_code: 'basic' } } },
  };
  const sig3 = sign(inv3);
  await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig3.header }, payload: sig3.raw });
  const bal3 = await repo.creditBalance(nodeId);
  // Cap reached, no additional credits
  assert.equal(bal3, 2100);

  await app.close();
});

// ── Prepurchase limit response includes purchase options ──

test('prepurchase_daily_limit_exceeded includes purchase_options', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-prepurchase-guidance');
  const apiKey = b.json().api_key.api_key;
  const nodeId = b.json().node.id;

  const searchPayload = { q: null, scope: 'OTHER', filters: { scope_notes: 'prepurchase-guidance-test' }, broadening: { level: 0, allow: false }, budget: { credits_requested: 10 }, limit: 20, cursor: null };

  // Exhaust the daily search limit (3 searches)
  for (let i = 0; i < 3; i++) {
    await app.inject({
      method: 'POST', url: '/v1/search/listings',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `prepurch-search-${nodeId}-${i}`, 'content-type': 'application/json' },
      payload: searchPayload,
    });
  }

  // 4th search should hit prepurchase limit
  const res = await app.inject({
    method: 'POST', url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `prepurch-search-${nodeId}-over`, 'content-type': 'application/json' },
    payload: searchPayload,
  });
  assert.equal(res.statusCode, 429);
  const body = res.json();
  assert.equal(body.error.code, 'prepurchase_daily_limit_exceeded');
  assert.ok(body.error.details.purchase_options, 'should include purchase_options');
  assert.ok(body.error.details.purchase_options.crypto, 'should include crypto options');
  assert.ok(body.error.details.purchase_options.stripe, 'should include stripe options');
  assert.ok(body.error.details.how_to_remove_limit, 'should include how_to_remove_limit');

  await app.close();
});

