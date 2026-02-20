import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

delete process.env.DATABASE_URL;
delete process.env.ADMIN_KEY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.STRIPE_TOPUP_PRICE_100;
delete process.env.STRIPE_TOPUP_PRICE_300;
delete process.env.STRIPE_TOPUP_PRICE_1000;
delete process.env.EMAIL_PROVIDER;
delete process.env.RECOVERY_CHALLENGE_TTL_MINUTES;
delete process.env.RECOVERY_CHALLENGE_MAX_ATTEMPTS;
delete process.env.RATE_LIMIT_RECOVERY_START_PER_HOUR;
delete process.env.RATE_LIMIT_RECOVERY_START_PER_NODE_PER_HOUR;
delete process.env.RATE_LIMIT_EMAIL_VERIFY_START_PER_HOUR;

process.env.ADMIN_KEY = 'admin-test';
process.env.STRIPE_SECRET_KEY = 'sk_test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_PRICE_BASIC = 'price_basic_test';
process.env.STRIPE_PRICE_PRO = 'price_pro_test';
process.env.STRIPE_PRICE_BUSINESS = 'price_business_test';
process.env.STRIPE_TOPUP_PRICE_100 = 'price_topup_100_test';
process.env.STRIPE_TOPUP_PRICE_300 = 'price_topup_300_test';
process.env.STRIPE_TOPUP_PRICE_1000 = 'price_topup_1000_test';
process.env.RATE_LIMIT_BOOTSTRAP_PER_HOUR = '1000';
process.env.EMAIL_PROVIDER = 'stub';
process.env.RECOVERY_CHALLENGE_TTL_MINUTES = '10';
process.env.RECOVERY_CHALLENGE_MAX_ATTEMPTS = '5';
process.env.RATE_LIMIT_RECOVERY_START_PER_HOUR = '1000';
process.env.RATE_LIMIT_RECOVERY_START_PER_NODE_PER_HOUR = '1000';
process.env.RATE_LIMIT_EMAIL_VERIFY_START_PER_HOUR = '1000';

const REQUIRED_LEGAL_VERSION = '2026-02-17';
const TEST_RUN_SUFFIX = crypto.randomUUID().slice(0, 8);
const LIVE_PRICE_IDS = {
  basic: 'price_1T1tO2K3gJAgZl81QzBXfPIf',
  pro: 'price_1T1wL1K3gJAgZl81IYKvjCsD',
  business: 'price_1T1wLgK3gJAgZl81450PfCc3',
  topup100: 'price_1T1wMGK3gJAgZl817t4OWdnM',
  topup300: 'price_1T1wMbK3gJAgZl81uWQJtoqH',
  topup1000: 'price_1T1wNBK3gJAgZl81ixDfggz3',
};

const { buildApp } = await import('../dist/src/app.js');
const { config } = await import('../dist/src/config.js');
const repo = await import('../dist/src/db/fabricRepo.js');
const { query } = await import('../dist/src/db/client.js');
const retentionPolicy = await import('../dist/src/retentionPolicy.js');
const emailProvider = await import('../dist/src/services/emailProvider.js');

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
    data: { object: { metadata: { node_id: nodeId, plan_code: 'basic' }, customer: `cus_${nodeId.slice(0, 8)}`, subscription: `sub_${nodeId.slice(0, 8)}` } },
  };
  const sig = sign(body);
  return app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
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
  assert.equal(body.legal_urls.terms, 'https://fabric.example/legal/terms');
  assert.equal(body.legal_urls.privacy, 'https://fabric.example/legal/privacy');
  assert.equal(body.legal_urls.aup, 'https://fabric.example/legal/acceptable-use');
  assert.equal(body.support_url, 'https://fabric.example/support');
  assert.equal(body.docs_urls.agents_url, 'https://fabric.example/docs/agents');
  assert.match(body.openapi_url, /^https:\/\//);
  assert.match(body.docs_urls.agents_url, /^https:\/\//);
  assert.match(body.docs_urls.agents_url, /\/docs\/agents$/);
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

test('GET /docs/agents returns quickstart HTML content', async () => {
  const app = buildApp();
  const res = await app.inject({
    method: 'GET',
    url: '/docs/agents',
    headers: { host: 'fabric.example', 'x-forwarded-proto': 'https' },
  });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type'] ?? ''), /^text\/html/);
  assert.match(res.body, /Fabric Agent Quickstart/);
  assert.match(res.body, /Authorization: ApiKey/);
  assert.match(res.body, /Idempotency-Key/);
  assert.match(res.body, /If-Match/);
  assert.match(res.body, /https:\/\/fabric\.example\/openapi\.json/);
  assert.match(res.body, /\/v1\/offers/);
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

test('search remains subscriber-gated while offer progression is available without subscriber status', async () => {
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
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'x' }, broadening: { level: 0, allow: false }, budget: { credits_requested: config.searchCreditCost }, limit: 20, cursor: null },
  });
  assert.equal(search.statusCode, 403);
  assert.equal(search.json().error.code, 'subscriber_required');

  const sellerUnit = await repo.createResource('units', sellerNodeId, unitPayload('No-sub offer unit', 'no-sub-offer-scope'));
  const created = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'sg-offer-create' },
    payload: { unit_ids: [sellerUnit.id], thread_id: null, note: null },
  });
  assert.equal(created.statusCode, 200);
  const offerId = created.json().offer.id;

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

test('offer lifecycle events emit webhooks and /events supports cursor polling', async () => {
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
    url: '/events?limit=2',
    headers: { authorization: `ApiKey ${buyerApiKey}` },
  });
  assert.equal(page1.statusCode, 200);
  assert.equal(Array.isArray(page1.json().events), true);
  assert.equal(page1.json().events.length, 2);
  assert.equal(typeof page1.json().next_cursor, 'string');

  const page2 = await app.inject({
    method: 'GET',
    url: `/events?since=${encodeURIComponent(page1.json().next_cursor)}&limit=100`,
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
    url: '/events?since=not-a-cursor',
    headers: { authorization: `ApiKey ${buyerApiKey}` },
  });
  assert.equal(invalidCursor.statusCode, 422);
  assert.equal(invalidCursor.json().error.code, 'validation_error');
  assert.equal(invalidCursor.json().error.details.reason, 'invalid_since_cursor');

  const deliveryRows = await query('select count(*)::text as c from event_webhook_deliveries');
  assert.equal(Number(deliveryRows[0].c) > 0, true);
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
    url: '/events?limit=10',
    headers: { authorization: `ApiKey ${sellerApiKey}` },
  });
  assert.equal(eventsPoll.statusCode, 200);
  assert.equal(Array.isArray(eventsPoll.json().events), true);
  assert.equal(eventsPoll.json().events.length > 0, true);
  await app.close();
});

test('unit upload threshold grants one trial entitlement and one credit grant', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-upload-trial-once');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  const beforeTrial = await repo.getTrialEntitlement(nodeId);
  assert.equal(beforeTrial, null);
  const balanceBeforeTenth = await repo.creditBalance(nodeId);

  for (let i = 0; i < 9; i += 1) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/units',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `trial-unit-${i}` },
      payload: unitPayload(`Trial unit ${i}`, `trial-upload-${i}`),
    });
    assert.equal(res.statusCode, 200);
  }

  const stillNoTrial = await repo.getTrialEntitlement(nodeId);
  assert.equal(stillNoTrial, null);

  const tenth = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'trial-unit-9' },
    payload: unitPayload('Trial unit 9', 'trial-upload-9'),
  });
  assert.equal(tenth.statusCode, 200);

  const entitlement = await repo.getTrialEntitlement(nodeId);
  assert.equal(Boolean(entitlement), true);
  assert.equal(entitlement.ends_at instanceof Date || typeof entitlement.ends_at === 'string', true);

  const balanceAfterTenth = await repo.creditBalance(nodeId);
  assert.equal(balanceAfterTenth - balanceBeforeTenth, config.uploadTrialCreditGrant);

  const eleventh = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'trial-unit-10' },
    payload: unitPayload('Trial unit 10', 'trial-upload-10'),
  });
  assert.equal(eleventh.statusCode, 200);

  const balanceAfterEleventh = await repo.creditBalance(nodeId);
  assert.equal(balanceAfterEleventh, balanceAfterTenth);

  const trialCount = await query("select count(*)::text as c from trial_entitlements where node_id=$1", [nodeId]);
  const trialEventCount = await query("select count(*)::text as c from trial_entitlement_events where node_id=$1 and event_type='granted'", [nodeId]);
  const trialGrantCount = await query("select count(*)::text as c from credit_ledger where node_id=$1 and type='grant_trial'", [nodeId]);
  assert.equal(Number(trialCount[0].c), 1);
  assert.equal(Number(trialEventCount[0].c), 1);
  assert.equal(Number(trialGrantCount[0].c), 1);
  await app.close();
});

test('active upload trial allows metered search, then expiry blocks spend until subscribed', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-upload-trial-expiry');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  for (let i = 0; i < 10; i += 1) {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/units',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `trial-exp-unit-${i}` },
      payload: unitPayload(`Trial expiry unit ${i}`, `trial-exp-${i}`),
    });
    assert.equal(res.statusCode, 200);
  }

  const entitlement = await repo.getTrialEntitlement(nodeId);
  assert.equal(Boolean(entitlement), true);

  const trialSearch = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'trial-search-active' },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'no-match-ok' }, broadening: { level: 0, allow: false }, budget: { credits_requested: config.searchCreditCost }, limit: 20, cursor: null },
  });
  assert.equal(trialSearch.statusCode, 200);

  await query(
    "update trial_entitlements set starts_at = now() - interval '8 days', ends_at = now() - interval '1 second' where node_id=$1",
    [nodeId],
  );

  const balanceBeforeDenied = await repo.creditBalance(nodeId);
  const expiredSearch = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'trial-search-expired' },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'no-match-ok' }, broadening: { level: 0, allow: false }, budget: { credits_requested: config.searchCreditCost }, limit: 20, cursor: null },
  });
  assert.equal(expiredSearch.statusCode, 403);
  assert.equal(expiredSearch.json().error.code, 'subscriber_required');
  const balanceAfterDenied = await repo.creditBalance(nodeId);
  assert.equal(balanceAfterDenied, balanceBeforeDenied);

  const activated = await activateBasicSubscriber(app, nodeId, 'evt_trial_to_sub');
  assert.equal(activated.statusCode, 200);

  const subscribedSearch = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'trial-search-subscriber' },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'no-match-ok' }, broadening: { level: 0, allow: false }, budget: { credits_requested: config.searchCreditCost }, limit: 20, cursor: null },
  });
  assert.equal(subscribedSearch.statusCode, 200);
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
  assert.equal(body.search_quote.estimated_cost, 2);
  assert.equal(Array.isArray(body.credit_packs), true);
  assert.equal(body.credit_packs.length, 3);
  assert.equal(body.credit_packs[0].pack_code, 'credits_100');
  assert.equal(body.credit_packs[0].credits, 100);
  assert.equal(body.credit_packs[0].price_cents, 399);
  assert.equal(body.credit_packs[0].stripe_price_id, 'price_topup_100_test');
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
  assert.equal(first.json().search_quote.estimated_cost, 4);
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

test('billing topups checkout-session creates payment mode session and respects idempotency', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-topup-checkout');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  const idemKey = 'topup-checkout-1';
  let fetchCalls = 0;

  await withMockFetch(async (url, init = {}) => {
    fetchCalls += 1;
    assert.equal(String(url), 'https://api.stripe.com/v1/checkout/sessions');
    const headers = new Headers(init.headers);
    assert.match(headers.get('Authorization') ?? '', /^Bearer /);
    assert.match(headers.get('Idempotency-Key') ?? '', /^fabric_topup:/);

    const form = new URLSearchParams(String(init.body ?? ''));
    assert.equal(form.get('mode'), 'payment');
    assert.equal(form.get('line_items[0][price]'), 'price_topup_300_test');
    assert.equal(form.get('metadata[node_id]'), nodeId);
    assert.equal(form.get('metadata[topup_pack_code]'), 'credits_300');
    assert.equal(form.get('metadata[topup_credits]'), '300');

    return jsonResponse(200, {
      id: 'cs_topup_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_topup_test_123',
      mode: 'payment',
    });
  }, async () => {
    const payload = {
      node_id: nodeId,
      pack_code: 'credits_300',
      success_url: 'https://example.com/success',
      cancel_url: 'https://example.com/cancel',
    };

    const first = await app.inject({
      method: 'POST',
      url: '/v1/billing/topups/checkout-session',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': idemKey },
      payload,
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().node_id, nodeId);
    assert.equal(first.json().pack_code, 'credits_300');
    assert.equal(first.json().credits, 300);
    assert.equal(first.json().checkout_session_id, 'cs_topup_test_123');
    assert.equal(first.json().checkout_url, 'https://checkout.stripe.com/c/pay/cs_topup_test_123');

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/billing/topups/checkout-session',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': idemKey },
      payload,
    });
    assert.equal(replay.statusCode, 200);
    assert.deepEqual(replay.json(), first.json());

    const conflict = await app.inject({
      method: 'POST',
      url: '/v1/billing/topups/checkout-session',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': idemKey },
      payload: { ...payload, pack_code: 'credits_100' },
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

test('webhook checkout.session.completed grants topup credits once by payment reference', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-topup-webhook-idem');
  const nodeId = b.json().node.id;
  const balBefore = await repo.creditBalance(nodeId);

  const eventA = {
    id: `evt_topup_a_${nodeId.slice(0, 8)}`,
    type: 'checkout.session.completed',
    data: {
      object: {
        id: `cs_topup_a_${nodeId.slice(0, 8)}`,
        payment_status: 'paid',
        payment_intent: `pi_topup_${nodeId.slice(0, 8)}`,
        metadata: { node_id: nodeId, topup_pack_code: 'credits_300' },
      },
    },
  };
  const eventB = {
    ...eventA,
    id: `evt_topup_b_${nodeId.slice(0, 8)}`,
  };

  const sigA = sign(eventA);
  const sigB = sign(eventB);
  const resA = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sigA.header }, payload: sigA.raw });
  const resB = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sigB.header }, payload: sigB.raw });
  assert.equal(resA.statusCode, 200);
  assert.equal(resB.statusCode, 200);

  const balAfter = await repo.creditBalance(nodeId);
  assert.equal(balAfter - balBefore, 300);
  await app.close();
});

test('topup grants enforce daily velocity limit per node', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-topup-velocity');
  const nodeId = b.json().node.id;
  const balBefore = await repo.creditBalance(nodeId);

  for (let i = 0; i < 4; i += 1) {
    const event = {
      id: `evt_topup_vel_${nodeId.slice(0, 8)}_${i}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: `cs_topup_vel_${nodeId.slice(0, 8)}_${i}`,
          payment_status: 'paid',
          payment_intent: `pi_topup_vel_${nodeId.slice(0, 8)}_${i}`,
          metadata: { node_id: nodeId, topup_pack_code: 'credits_100' },
        },
      },
    };
    const sig = sign(event);
    const res = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
    assert.equal(res.statusCode, 200);
  }

  const balAfter = await repo.creditBalance(nodeId);
  assert.equal(balAfter - balBefore, 300);
  await app.close();
});

test('webhook processes checkout.session.completed and is idempotent by event id', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh');
  const nodeId = b.json().node.id;
  const body = { id: 'evt_1', type: 'checkout.session.completed', data: { object: { metadata: { node_id: nodeId, plan_code: 'pro' }, customer: 'cus_1', subscription: 'sub_1' } } };
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

test('webhook accepts valid signature when stripe-signature has multiple v1 values', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh-multi');
  const nodeId = b.json().node.id;
  const body = { id: 'evt_2', type: 'checkout.session.completed', data: { object: { metadata: { node_id: nodeId, plan_code: 'pro' }, customer: 'cus_2', subscription: 'sub_2' } } };
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
  const body = { id: 'evt_bad_sig', type: 'checkout.session.completed', data: { object: { metadata: { node_id: nodeId, plan_code: 'basic' }, customer: 'cus_bad', subscription: 'sub_bad' } } };
  const sig = sign(body);
  const badHeader = `t=${sig.t},v1=${'0'.repeat(64)}`;
  const res = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': badHeader }, payload: sig.raw });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().error.code, 'stripe_signature_invalid');
  assert.equal(res.json().error.details.reason, 'signature_mismatch');
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
    data: { object: { metadata: { node_id: nodeId, plan_code: 'basic' }, customer: customerId, subscription: subscriptionId } },
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
    data: { object: { metadata: { node_id: nodeId, plan_code: 'pro' }, customer: customerId, subscription: subscriptionId } },
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
  assert.equal(balAfter - balBefore, 1500);
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
  assert.equal(balAfter - balBefore, 1500);
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
  assert.equal(afterPaid - beforePaid, 1500);
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
    data: { object: { metadata: { node_id: nodeId, plan_code: 'basic' }, customer: customerId, subscription: subscriptionId } },
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
  assert.equal(balAfterUpgrade - balBeforeUpgrade, 1000);

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
    data: { object: { metadata: { node_id: nodeId, plan_code: 'pro' }, customer: customerId, subscription: subscriptionId } },
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
  assert.equal(balAfterRenewal - balAfterUpdate, 500);
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
  assert.equal(balAfter - balBefore, 500);
  await app.close();
});

test('metering only charges on HTTP 200 for search', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-search');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  const body = { id: 'evt_sub', type: 'checkout.session.completed', data: { object: { metadata: { node_id: nodeId, plan_code: 'basic' }, customer: 'cus', subscription: 'sub' } } };
  const sig = sign(body);
  await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });

  const bal1 = await repo.creditBalance(nodeId);
  const bad = await app.inject({ method: 'POST', url: '/v1/search/listings', headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 's1' }, payload: { q: null, scope: 'ship_to', filters: {}, broadening: { level: 0, allow: false }, budget: { credits_requested: config.searchCreditCost }, limit: 20, cursor: null } });
  assert.equal(bad.statusCode, 422);
  const bal2 = await repo.creditBalance(nodeId);
  assert.equal(bal2, bal1);

  const ok = await app.inject({ method: 'POST', url: '/v1/search/listings', headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 's2' }, payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'x' }, broadening: { level: 0, allow: false }, budget: { credits_requested: config.searchCreditCost }, limit: 20, cursor: null } });
  assert.equal(ok.statusCode, 200);
  const bal3 = await repo.creditBalance(nodeId);
  assert.equal(bal3 < bal2, true);
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
    data: { object: { metadata: { node_id: nodeId, plan_code: 'basic' }, customer: `cus_${nodeId.slice(0, 8)}`, subscription: `sub_${nodeId.slice(0, 8)}` } },
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
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'x' }, broadening: { level: 0, allow: false }, budget: { credits_requested: config.searchCreditCost }, limit: 20, cursor: null },
  });
  assert.equal(res.statusCode, 402);
  assert.equal(res.json().error.code, 'credits_exhausted');
  await app.close();
});

test('search requires budget.credits_requested', async () => {
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

test('search caps spend to budget and returns guidance', async () => {
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
      budget: { credits_requested: 0 },
      limit: 20,
      cursor: null,
    },
  });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().budget.was_capped, true);
  assert.equal(res.json().budget.cap_reason, 'insufficient_budget');
  assert.equal(res.json().budget.credits_charged <= res.json().budget.credits_requested, true);
  assert.equal(typeof res.json().budget.guidance, 'string');
  assert.equal(res.json().budget.guidance.length > 0, true);
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
      budget: { credits_requested: config.searchCreditCost },
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
  assert.equal(typeof body.budget.credits_requested, 'number');
  assert.equal(typeof body.budget.credits_charged, 'number');
  assert.equal(typeof body.budget.coverage, 'object');
  assert.equal(body.budget.coverage.page_index_executed, 1);
  assert.equal(body.budget.coverage.broadening_level_executed, 0);
  assert.equal(body.budget.coverage.items_returned, body.items.length);
  assert.equal(Array.isArray(body.nodes), true);
  assert.equal(body.nodes.length, 1);
  assert.equal(body.nodes[0].node_id, targetANodeId);
  assert.equal(Object.prototype.hasOwnProperty.call(body.nodes[0], 'category_counts_nonzero'), true);
  assert.equal(typeof body.nodes[0].category_counts_nonzero, 'object');
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
      budget: { credits_requested: 200 },
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
      budget: { credits_requested: 200 },
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
      budget: { credits_requested: config.searchCreditCost },
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
      budget: { credits_requested: config.searchCreditCost },
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
  const searcherBoot = await bootstrap(app, 'boot-search-page-tier-searcher');
  const searcherNodeId = searcherBoot.json().node.id;
  const searcherApiKey = searcherBoot.json().api_key.api_key;
  assert.equal((await activateBasicSubscriber(app, searcherNodeId, 'evt_subscriber_page_tier')).statusCode, 200);

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
    budget: { credits_requested: creditsRequested },
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
  assert.equal(page1.json().budget.credits_charged, config.searchTargetCreditCost + 1);

  const page2 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-tier-page-2' },
    payload: searchPayload(page1.json().cursor, fullBudget),
  });
  assert.equal(page2.statusCode, 200);
  assert.equal(page2.json().budget.breakdown.page_index, 2);
  assert.equal(page2.json().budget.breakdown.page_cost, config.searchPageAddOnSmall);
  assert.equal(page2.json().budget.credits_charged, config.searchTargetCreditCost + 1 + config.searchPageAddOnSmall);

  const page3 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-tier-page-3' },
    payload: searchPayload(page2.json().cursor, fullBudget),
  });
  assert.equal(page3.statusCode, 200);

  const page4 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-tier-page-4' },
    payload: searchPayload(page3.json().cursor, fullBudget),
  });
  assert.equal(page4.statusCode, 200);
  assert.equal(page4.json().budget.breakdown.page_index, 4);
  assert.equal(page4.json().budget.breakdown.page_cost, config.searchPageAddOnLarge);
  assert.equal(page4.json().budget.credits_charged, config.searchTargetCreditCost + 1 + config.searchPageAddOnLarge);

  const page5 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-tier-page-5' },
    payload: searchPayload(page4.json().cursor, fullBudget),
  });
  assert.equal(page5.statusCode, 200);

  const beforePage6Balance = await repo.creditBalance(searcherNodeId);
  const modestBudget = config.searchTargetCreditCost + 1;
  const page6 = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': 'search-tier-page-6' },
    payload: searchPayload(page5.json().cursor, modestBudget),
  });
  assert.equal(page6.statusCode, 200);
  assert.equal(page6.json().budget.breakdown.page_index, 6);
  assert.equal(page6.json().budget.breakdown.page_cost, config.searchPageProhibitiveCost);
  assert.equal(page6.json().budget.was_capped, true);
  assert.equal(page6.json().budget.credits_charged <= page6.json().budget.credits_requested, true);
  assert.equal(typeof page6.json().budget.guidance, 'string');
  assert.match(page6.json().budget.guidance, /pages/i);
  const afterPage6Balance = await repo.creditBalance(searcherNodeId);
  assert.equal(afterPage6Balance, beforePage6Balance);
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
    budget: { credits_requested: config.searchCreditCost + config.searchBroadeningHighThreshold + 5 },
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
    budget: { credits_requested: 200 },
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
      budget: { credits_requested: config.searchCreditCost },
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
      budget: { credits_requested: config.searchCreditCost },
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
    data: { object: { metadata: { node_id: nodeId, plan_code: 'basic' }, customer: `cus_self_${nodeId.slice(0, 8)}`, subscription: `sub_self_${nodeId.slice(0, 8)}` } },
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
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'self-exclude-test' }, broadening: { level: 0, allow: false }, budget: { credits_requested: config.searchCreditCost }, limit: 20, cursor: null },
  });
  assert.equal(listingsRes.statusCode, 200);
  const ownListingSeen = listingsRes.json().items.some((row) => row.item?.node_id === nodeId);
  assert.equal(ownListingSeen, false);

  const requestsRes = await app.inject({
    method: 'POST',
    url: '/v1/search/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': `search-self-requests-${nodeId}` },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'self-exclude-test' }, broadening: { level: 0, allow: false }, budget: { credits_requested: config.searchCreditCost }, limit: 20, cursor: null },
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
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'suspended-visibility' }, broadening: { level: 0, allow: false }, budget: { credits_requested: config.searchCreditCost }, limit: 20, cursor: null },
  });
  assert.equal(before.statusCode, 200);
  const seenBefore = before.json().items.some((row) => row.item?.node_id === targetNodeId);
  assert.equal(seenBefore, true);

  await suspendNode(targetNodeId);

  const after = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${searcherApiKey}`, 'idempotency-key': `suspend-search-after-${searcherNodeId}` },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'suspended-visibility' }, broadening: { level: 0, allow: false }, budget: { credits_requested: config.searchCreditCost }, limit: 20, cursor: null },
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
      budget: { credits_requested: config.searchCreditCost },
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
    stripeTopupPrice100: LIVE_PRICE_IDS.topup100,
    stripeTopupPrice300: LIVE_PRICE_IDS.topup300,
    stripeTopupPrice1000: LIVE_PRICE_IDS.topup1000,
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

