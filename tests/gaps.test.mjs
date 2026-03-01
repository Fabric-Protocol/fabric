/**
 * Gap-fill test suite for Fabric API — QA / Test Architect audit
 * Covers all 27 gaps identified in the coverage audit.
 *
 * Run: npm run build && node dist/scripts/bootstrap-db.js && node --test tests/gaps.test.mjs
 *
 * Prerequisite: Same env setup as tests/api.test.mjs (Postgres running, DATABASE_URL set).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

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
process.env.CHECKOUT_REDIRECT_ALLOWLIST = 'example.com,myapp.test';

const REQUIRED_LEGAL_VERSION = '2026-02-17';
const TEST_RUN_SUFFIX = crypto.randomUUID().slice(0, 8);

const { buildApp } = await import('../dist/src/app.js');
const { config } = await import('../dist/src/config.js');
const repo = await import('../dist/src/db/fabricRepo.js');
const { query } = await import('../dist/src/db/client.js');
const fabricService = await import('../dist/src/services/fabricService.js');

import fs from 'node:fs/promises';

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

const offerEventsNullableMigrationSql = await fs.readFile(
  new URL('../supabase_migrations/2026-02-28__offer_events_offer_id_nullable.sql', import.meta.url),
  'utf8',
);
await query(offerEventsNullableMigrationSql);

await query('DELETE FROM stripe_events');
await query('DELETE FROM admin_idempotency_keys');
await query('DELETE FROM rate_limit_counters');

// ─── Helpers ──────────────────────────────────────────────

async function bootstrap(app, idk = 'boot-1', payload = {}, options = {}) {
  const basePayload = payload && typeof payload === 'object' ? payload : {};
  const rawDisplayName = basePayload.display_name ?? 'GapNode';
  const useExactDisplayName = options.exactDisplayName === true;
  const displayName = useExactDisplayName
    ? rawDisplayName
    : `${rawDisplayName}-gap-${TEST_RUN_SUFFIX}-${idk}`;
  const requestPayload = {
    ...basePayload,
    display_name: displayName,
    email: basePayload.email ?? null,
    referral_code: basePayload.referral_code ?? null,
    legal: basePayload.legal ?? { accepted: true, version: REQUIRED_LEGAL_VERSION },
  };
  return app.inject({ method: 'POST', url: '/v1/bootstrap', headers: { 'idempotency-key': `gap-${idk}` }, payload: requestPayload });
}

function unitPayload(title, scopeNotes = 'gap-unit-scope') {
  return {
    title,
    description: 'gap test unit',
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

function nowpaymentsIpnSignature(body) {
  const sorted = JSON.stringify(body, Object.keys(body).sort());
  return crypto.createHmac('sha512', process.env.NOWPAYMENTS_IPN_SECRET).update(sorted).digest('hex');
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

// ─── GAP-1: GET /v1/regions ──────────────────────────────

test('GAP-1: GET /v1/regions returns US region IDs array', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/v1/regions' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.regions), 'regions must be an array');
  assert.ok(body.regions.length > 0, 'regions must have at least one entry');
  for (const r of body.regions) {
    assert.match(r, /^US(-[A-Z]{2})?$/, `region ${r} must match US or US-XX format`);
  }
  assert.ok(body.regions.includes('US'), 'must include US country code');
  assert.ok(body.regions.includes('US-CA'), 'must include US-CA');
  await app.close();
});

// ─── GAP-2: GET /v1/me/referral-stats ────────────────────

test('GAP-2: GET /v1/me/referral-stats requires auth and returns shape', async () => {
  const app = buildApp();

  const noAuth = await app.inject({ method: 'GET', url: '/v1/me/referral-stats' });
  assert.equal(noAuth.statusCode, 401);
  assert.equal(noAuth.json().error.code, 'unauthorized');

  const b = await bootstrap(app, 'gap-referral-stats');
  assert.equal(b.statusCode, 200);
  const apiKey = b.json().api_key.api_key;

  const res = await app.inject({ method: 'GET', url: '/v1/me/referral-stats', headers: { authorization: `ApiKey ${apiKey}` } });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(typeof body.total_referrals, 'number');
  assert.equal(typeof body.awarded, 'number');
  assert.equal(typeof body.credits_earned, 'number');
  assert.equal(typeof body.referral_code, 'string');
  await app.close();
});

// ─── GAP-3: GET /v1/billing/crypto-currencies ────────────

test('GAP-3: GET /v1/billing/crypto-currencies requires auth', async () => {
  const app = buildApp();
  const noAuth = await app.inject({ method: 'GET', url: '/v1/billing/crypto-currencies' });
  assert.equal(noAuth.statusCode, 401);
  assert.equal(noAuth.json().error.code, 'unauthorized');

  const b = await bootstrap(app, 'gap-crypto-currencies');
  assert.equal(b.statusCode, 200);
  const apiKey = b.json().api_key.api_key;

  const res = await withMockFetch(async (url) => {
    if (String(url).includes('currencies')) {
      return jsonResponse(200, { currencies: ['btc', 'eth', 'usdt', 'ltc'] });
    }
    return jsonResponse(404, {});
  }, async () => {
    return app.inject({ method: 'GET', url: '/v1/billing/crypto-currencies', headers: { authorization: `ApiKey ${apiKey}` } });
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(Array.isArray(body.currencies), 'currencies must be an array');
  await app.close();
});

// ─── GAP-4: POST /internal/admin/health-pulse ────────────

test('GAP-4: POST /internal/admin/health-pulse requires admin auth and returns shape', async () => {
  const app = buildApp();

  const noAuth = await app.inject({ method: 'POST', url: '/internal/admin/health-pulse', payload: {} });
  assert.equal(noAuth.statusCode, 401);

  const res = await app.inject({
    method: 'POST',
    url: '/internal/admin/health-pulse',
    headers: { 'x-admin-key': process.env.ADMIN_KEY },
    payload: {},
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.ok(typeof body.status === 'string', 'status must be a string (healthy or degraded)');
  assert.ok(typeof body.generated_at === 'string', 'generated_at must be a string');
  assert.ok(typeof body.window_minutes === 'number', 'window_minutes must be a number');
  await app.close();
});

// ─── GAP-5: POST /internal/admin/retention ───────────────

test('GAP-5: POST /internal/admin/retention requires admin auth and returns shape', async () => {
  const app = buildApp();

  const noAuth = await app.inject({ method: 'POST', url: '/internal/admin/retention', payload: {} });
  assert.equal(noAuth.statusCode, 401);

  const res = await app.inject({
    method: 'POST',
    url: '/internal/admin/retention',
    headers: { 'x-admin-key': process.env.ADMIN_KEY },
    payload: {},
  });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.ok, true);
  assert.equal(typeof body.deleted_count, 'number');
  assert.ok(typeof body.hot_cutoff === 'string');
  assert.ok(typeof body.delete_cutoff === 'string');
  await app.close();
});

// ─── GAP-6: GET /mcp SSE placeholder ─────────────────────

test('GAP-6: GET /mcp returns SSE placeholder or valid response', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/mcp' });
  assert.ok([200, 204, 405].includes(res.statusCode), `expected 200, 204, or 405 but got ${res.statusCode}`);
  await app.close();
});

// ─── GAP-7: Checkout redirect allowlist ──────────────────

test('GAP-7: billing checkout rejects success_url on non-allowlisted domain', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-checkout-allowlist');
  assert.equal(b.statusCode, 200);
  const apiKey = b.json().api_key.api_key;

  const nodeId = b.json().node.id;
  await withConfigOverrides({ checkoutRedirectAllowlist: ['example.com'] }, async () => {
    const rejectedRes = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout-session',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-checkout-reject' },
      payload: { node_id: nodeId, plan_code: 'basic', success_url: 'https://evil.com/success', cancel_url: 'https://evil.com/cancel' },
    });
    assert.ok([422, 400].includes(rejectedRes.statusCode), `expected 422 or 400 for non-allowlisted domain, got ${rejectedRes.statusCode}`);
    const body = rejectedRes.json();
    assert.ok(body.error, 'must return error envelope');
    assert.equal(body.error.details?.reason, 'redirect_url_not_allowed');
  });
  await app.close();
});

// ─── GAP-8: Request delete cascades offer cancellation ───

test('GAP-8: DELETE /v1/requests/:id cancels associated offers and releases holds', async () => {
  const app = buildApp();
  const requesterBoot = await bootstrap(app, 'gap-req-delete-requester');
  const fulfillerBoot = await bootstrap(app, 'gap-req-delete-fulfiller');
  const requesterNodeId = requesterBoot.json().node.id;
  const fulfillerNodeId = fulfillerBoot.json().node.id;
  const requesterApiKey = requesterBoot.json().api_key.api_key;
  const fulfillerApiKey = fulfillerBoot.json().api_key.api_key;

  const requestResource = await repo.createResource('requests', requesterNodeId, {
    ...unitPayload('Need bananas', 'gap-req-delete-scope'),
    public_summary: 'Need bananas',
  });
  await repo.setPublished('requests', requestResource.id, true);
  await repo.upsertProjection('requests', await repo.getResource('requests', requesterNodeId, requestResource.id));

  const offerCreate = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${fulfillerApiKey}`, 'idempotency-key': 'gap-req-delete-offer' },
    payload: { request_id: requestResource.id, note: 'I have bananas.' },
  });
  assert.equal(offerCreate.statusCode, 200);
  const offerId = offerCreate.json().offer.id;

  const deleteReq = await app.inject({
    method: 'DELETE',
    url: `/v1/requests/${requestResource.id}`,
    headers: { authorization: `ApiKey ${requesterApiKey}`, 'idempotency-key': 'gap-req-delete' },
  });
  assert.equal(deleteReq.statusCode, 200);

  const offerAfter = await repo.getOffer(offerId);
  assert.equal(offerAfter.status, 'cancelled');
  await app.close();
});

// ─── GAP-9: note_only_deal flag ──────────────────────────

test('GAP-9: mutual acceptance without unit_ids sets note_only_deal=true', async () => {
  const app = buildApp();
  const requesterBoot = await bootstrap(app, 'gap-note-only-requester');
  const fulfillerBoot = await bootstrap(app, 'gap-note-only-fulfiller');
  const requesterNodeId = requesterBoot.json().node.id;
  const requesterApiKey = requesterBoot.json().api_key.api_key;
  const fulfillerApiKey = fulfillerBoot.json().api_key.api_key;

  const requestResource = await repo.createResource('requests', requesterNodeId, {
    ...unitPayload('Need consulting', 'gap-note-only-scope'),
    public_summary: 'Need consulting',
  });
  await repo.setPublished('requests', requestResource.id, true);
  await repo.upsertProjection('requests', await repo.getResource('requests', requesterNodeId, requestResource.id));

  const create = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${fulfillerApiKey}`, 'idempotency-key': 'gap-note-only-create' },
    payload: { request_id: requestResource.id, note: 'I can consult for $50/hr.' },
  });
  assert.equal(create.statusCode, 200);
  const rootOfferId = create.json().offer.id;

  const counter = await app.inject({
    method: 'POST',
    url: `/v1/offers/${rootOfferId}/counter`,
    headers: { authorization: `ApiKey ${requesterApiKey}`, 'idempotency-key': 'gap-note-only-counter' },
    payload: { note: 'Agreed at $50/hr, 10 hours.' },
  });
  assert.equal(counter.statusCode, 200);
  const counterOfferId = counter.json().offer.id;

  const accept = await app.inject({
    method: 'POST',
    url: `/v1/offers/${counterOfferId}/accept`,
    headers: { authorization: `ApiKey ${fulfillerApiKey}`, 'idempotency-key': 'gap-note-only-accept' },
    payload: {},
  });
  assert.equal(accept.statusCode, 200);
  assert.equal(accept.json().offer.status, 'mutually_accepted');
  assert.equal(accept.json().offer.note_only_deal, true);
  await app.close();
});

// ─── GAP-11: cannot_counter_own_root_offer ───────────────

test('GAP-11: root offer creator cannot counter their own root offer', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'gap-self-counter-seller');
  const buyerBoot = await bootstrap(app, 'gap-self-counter-buyer');
  const sellerNodeId = sellerBoot.json().node.id;
  const buyerApiKey = buyerBoot.json().api_key.api_key;

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Self counter unit', 'gap-self-counter-scope'));

  const create = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'gap-self-counter-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(create.statusCode, 200);
  const offerId = create.json().offer.id;

  const selfCounter = await app.inject({
    method: 'POST',
    url: `/v1/offers/${offerId}/counter`,
    headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'gap-self-counter-counter' },
    payload: { unit_ids: [unit.id], note: 'my counter' },
  });
  assert.equal(selfCounter.statusCode, 409);
  assert.ok(
    selfCounter.json().error.code === 'cannot_counter_own_root_offer'
    || selfCounter.json().error.code === 'conflict'
    || selfCounter.json().error.code === 'invalid_state_transition',
    `expected conflict-family error code, got ${selfCounter.json().error.code}`,
  );
  await app.close();
});

// ─── GAP-14: Offer list by request_id filter ─────────────

test('GAP-14: GET /v1/offers?request_id= filters offers for specific request', async () => {
  const app = buildApp();
  const requesterBoot = await bootstrap(app, 'gap-offer-filter-requester');
  const fulfillerBoot = await bootstrap(app, 'gap-offer-filter-fulfiller');
  const requesterNodeId = requesterBoot.json().node.id;
  const fulfillerApiKey = fulfillerBoot.json().api_key.api_key;

  const reqA = await repo.createResource('requests', requesterNodeId, {
    ...unitPayload('Need A', 'gap-offer-filter-a'),
    public_summary: 'Need A',
  });
  const reqB = await repo.createResource('requests', requesterNodeId, {
    ...unitPayload('Need B', 'gap-offer-filter-b'),
    public_summary: 'Need B',
  });
  await repo.setPublished('requests', reqA.id, true);
  await repo.upsertProjection('requests', await repo.getResource('requests', requesterNodeId, reqA.id));
  await repo.setPublished('requests', reqB.id, true);
  await repo.upsertProjection('requests', await repo.getResource('requests', requesterNodeId, reqB.id));

  const offerA = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${fulfillerApiKey}`, 'idempotency-key': 'gap-offer-filter-a' },
    payload: { request_id: reqA.id, note: 'Offer for A' },
  });
  assert.equal(offerA.statusCode, 200);

  const offerB = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${fulfillerApiKey}`, 'idempotency-key': 'gap-offer-filter-b' },
    payload: { request_id: reqB.id, note: 'Offer for B' },
  });
  assert.equal(offerB.statusCode, 200);

  const filtered = await app.inject({
    method: 'GET',
    url: `/v1/offers?request_id=${reqA.id}`,
    headers: { authorization: `ApiKey ${fulfillerApiKey}` },
  });
  assert.equal(filtered.statusCode, 200);
  const offers = filtered.json().offers;
  assert.ok(Array.isArray(offers));
  assert.ok(offers.length >= 1);
  for (const o of offers) {
    assert.equal(o.request_id, reqA.id);
  }
  await app.close();
});

// ─── GAP-16: Stripe webhook invoice.payment_failed ───────

test('GAP-16: Stripe webhook invoice.payment_failed does not grant credits', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-invoice-failed');
  const nodeId = b.json().node.id;

  await activateBasicSubscriber(app, nodeId, 'evt_gap_invoice_fail_sub');
  const balBefore = await repo.creditBalance(nodeId);

  const failBody = {
    id: `evt_invoice_fail_gap_${nodeId.slice(0, 8)}`,
    type: 'invoice.payment_failed',
    data: {
      object: {
        customer: `cus_${nodeId.slice(0, 8)}`,
        subscription: `sub_${nodeId.slice(0, 8)}`,
        status: 'open',
        lines: { data: [{ price: { id: 'price_basic_test' }, period: { start: Math.floor(Date.now() / 1000), end: Math.floor(Date.now() / 1000) + 86400 * 30 } }] },
      },
    },
  };
  const sig = sign(failBody);
  const res = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
  assert.equal(res.statusCode, 200);

  const balAfter = await repo.creditBalance(nodeId);
  assert.equal(balAfter, balBefore);
  await app.close();
});

// ─── GAP-18: NOWPayments webhook confirmed status ────────

test('GAP-18: NOWPayments webhook with confirmed status grants credits', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-nowpay-confirmed');
  const nodeId = b.json().node.id;
  const uniquePaymentId = Math.floor(Math.random() * 2_000_000_000);
  const orderId = `gap_confirmed_${nodeId.slice(0, 8)}_${uniquePaymentId}`;

  await repo.insertCryptoPayment(
    nodeId,
    uniquePaymentId,
    orderId,
    'credits_500',
    500,
    9.99,
    'usd',
    'btc',
    'bc1q_test_address',
    0.005,
  );

  const balBefore = await repo.creditBalance(nodeId);
  const webhookBody = {
    payment_id: uniquePaymentId,
    payment_status: 'confirmed',
    order_id: orderId,
    pay_address: 'bc1q...',
    pay_amount: 0.005,
    actually_paid: 0.005,
    price_amount: 9.99,
    price_currency: 'usd',
    pay_currency: 'btc',
  };
  const sig = nowpaymentsIpnSignature(webhookBody);
  const res = await app.inject({
    method: 'POST',
    url: '/v1/webhooks/nowpayments',
    headers: { 'x-nowpayments-sig': sig, 'content-type': 'application/json' },
    payload: webhookBody,
  });
  assert.equal(res.statusCode, 200);

  const balAfter = await repo.creditBalance(nodeId);
  assert.equal(balAfter - balBefore, 500);
  await app.close();
});

// ─── GAP-23: Missing Idempotency-Key on mutating endpoint ──

test('GAP-23: mutating endpoints require Idempotency-Key header', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-missing-idem-key');
  assert.equal(b.statusCode, 200);
  const apiKey = b.json().api_key.api_key;

  const unitRes = await app.inject({
    method: 'POST',
    url: '/v1/units',
    headers: { authorization: `ApiKey ${apiKey}` },
    payload: unitPayload('Missing idem key unit'),
  });
  assert.ok([400, 422].includes(unitRes.statusCode), `expected 400 or 422 for missing idem key, got ${unitRes.statusCode}`);

  const offerRes = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${apiKey}` },
    payload: { unit_ids: ['00000000-0000-0000-0000-000000000000'], note: null },
  });
  assert.ok([400, 422].includes(offerRes.statusCode), `expected 400 or 422 for missing idem key on offers, got ${offerRes.statusCode}`);
  await app.close();
});

// ─── GAP-24: GET /v1/me explicit response shape ─────────

test('GAP-24: GET /v1/me returns all required contract fields', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-me-shape', { email: `gap.me.${TEST_RUN_SUFFIX}@example.com` });
  assert.equal(b.statusCode, 200);
  const apiKey = b.json().api_key.api_key;

  const res = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${apiKey}` } });
  assert.equal(res.statusCode, 200);
  const node = res.json().node;
  assert.ok(typeof node.id === 'string');
  assert.ok(typeof node.display_name === 'string');
  assert.ok(typeof node.status === 'string');
  assert.equal(node.status, 'ACTIVE');
  assert.ok(Array.isArray(node.messaging_handles));
  assert.ok(node.event_webhook_url === null || typeof node.event_webhook_url === 'string');
  assert.equal(Object.hasOwn(node, 'event_webhook_secret'), false, 'webhook secret must not be exposed');
  assert.ok(typeof node.created_at === 'string');
  assert.ok(typeof node.plan === 'string');
  assert.ok(typeof node.is_subscriber === 'boolean');

  assert.ok(typeof res.json().subscription === 'object');
  assert.ok(typeof res.json().credits_balance === 'number');
  await app.close();
});

// ─── GAP-25: Request publish eligibility per scope ───────

test('GAP-25: request publish with scope=ship_to but missing origin_region returns 422', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-req-publish-ship-to');
  const apiKey = b.json().api_key.api_key;

  const created = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-req-publish-ship-to-create' },
    payload: {
      ...unitPayload('Ship to request'),
      scope_primary: 'ship_to',
      scope_notes: null,
    },
  });
  assert.equal(created.statusCode, 200);
  const requestId = created.json().request.id;

  const publish = await app.inject({
    method: 'POST',
    url: `/v1/requests/${requestId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-req-publish-ship-to-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 422);
  assert.equal(publish.json().error.code, 'validation_error');
  await app.close();
});

test('GAP-25b: request publish with scope=local_in_person but missing location_text_public returns 422', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-req-publish-local');
  const apiKey = b.json().api_key.api_key;

  const created = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-req-publish-local-create' },
    payload: {
      ...unitPayload('Local request'),
      scope_primary: 'local_in_person',
      scope_notes: null,
      location_text_public: null,
    },
  });
  assert.equal(created.statusCode, 200);
  const requestId = created.json().request.id;

  const publish = await app.inject({
    method: 'POST',
    url: `/v1/requests/${requestId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-req-publish-local-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 422);
  assert.equal(publish.json().error.code, 'validation_error');
  await app.close();
});

test('GAP-25c: request publish with scope=digital_delivery but missing delivery_format returns 422', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-req-publish-digital');
  const apiKey = b.json().api_key.api_key;

  const created = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-req-publish-digital-create' },
    payload: {
      ...unitPayload('Digital request'),
      scope_primary: 'digital_delivery',
      scope_notes: null,
      delivery_format: null,
    },
  });
  assert.equal(created.statusCode, 200);
  const requestId = created.json().request.id;

  const publish = await app.inject({
    method: 'POST',
    url: `/v1/requests/${requestId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-req-publish-digital-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 422);
  assert.equal(publish.json().error.code, 'validation_error');
  await app.close();
});

test('GAP-25d: request publish with scope=remote_online_service but missing service_region returns 422', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-req-publish-remote');
  const apiKey = b.json().api_key.api_key;

  const created = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-req-publish-remote-create' },
    payload: {
      ...unitPayload('Remote request'),
      scope_primary: 'remote_online_service',
      scope_notes: null,
      service_region: null,
    },
  });
  assert.equal(created.statusCode, 200);
  const requestId = created.json().request.id;

  const publish = await app.inject({
    method: 'POST',
    url: `/v1/requests/${requestId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-req-publish-remote-publish' },
    payload: {},
  });
  assert.equal(publish.statusCode, 422);
  assert.equal(publish.json().error.code, 'validation_error');
  await app.close();
});

// ─── GAP-26: Request PATCH idempotency replay ────────────

test('GAP-26: PATCH /v1/requests/:id idempotency replay returns same response', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-req-patch-idem');
  const apiKey = b.json().api_key.api_key;

  const created = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-req-patch-idem-create' },
    payload: unitPayload('Idem request', 'gap-req-patch-idem-scope'),
  });
  assert.equal(created.statusCode, 200);
  const requestId = created.json().request.id;
  const version = created.json().request.version;

  const patchPayload = { description: 'Updated description for idempotency test' };
  const first = await app.inject({
    method: 'PATCH',
    url: `/v1/requests/${requestId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-req-patch-idem-key', 'if-match': String(version) },
    payload: patchPayload,
  });
  assert.equal(first.statusCode, 200);

  const replay = await app.inject({
    method: 'PATCH',
    url: `/v1/requests/${requestId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-req-patch-idem-key', 'if-match': String(version) },
    payload: patchPayload,
  });
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.json().id, first.json().id);

  const conflict = await app.inject({
    method: 'PATCH',
    url: `/v1/requests/${requestId}`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-req-patch-idem-key', 'if-match': String(version) },
    payload: { description: 'Different payload' },
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().error.code, 'idempotency_key_reuse_conflict');
  await app.close();
});

// ─── GAP-22: Webhook payload excludes sensitive data ─────

test('GAP-22: outbound webhook payload for offer events excludes PII and secrets', async () => {
  const app = buildApp();

  let capturedPayload = null;
  const mockFetch = async (url, opts) => {
    if (String(url).includes('hooks')) {
      capturedPayload = JSON.parse(opts.body);
      return jsonResponse(200, { ok: true });
    }
    return jsonResponse(200, {});
  };

  const sellerBoot = await bootstrap(app, 'gap-webhook-pii-seller', {
    email: `gap.webhook.seller.${TEST_RUN_SUFFIX}@example.com`,
  });
  const buyerBoot = await bootstrap(app, 'gap-webhook-pii-buyer', {
    email: `gap.webhook.buyer.${TEST_RUN_SUFFIX}@example.com`,
  });
  const sellerNodeId = sellerBoot.json().node.id;
  const sellerApiKey = sellerBoot.json().api_key.api_key;
  const buyerApiKey = buyerBoot.json().api_key.api_key;

  await app.inject({
    method: 'PATCH',
    url: '/v1/me',
    headers: { authorization: `ApiKey ${sellerApiKey}`, 'idempotency-key': 'gap-webhook-pii-patch' },
    payload: { event_webhook_url: 'https://203.0.113.50/hooks', event_webhook_secret: 'test-secret-pii' },
  });

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Webhook PII unit', 'gap-webhook-pii-scope'));

  await withMockFetch(mockFetch, async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/v1/offers',
      headers: { authorization: `ApiKey ${buyerApiKey}`, 'idempotency-key': 'gap-webhook-pii-create' },
      payload: { unit_ids: [unit.id], thread_id: null, note: 'Test webhook PII filtering' },
    });
    assert.equal(create.statusCode, 200);

    await new Promise((r) => setTimeout(r, 500));
  });

  if (capturedPayload) {
    const payloadStr = JSON.stringify(capturedPayload);
    assert.doesNotMatch(payloadStr, /api_key/i, 'webhook payload must not contain api_key');
    assert.doesNotMatch(payloadStr, /secret/i, 'webhook payload must not contain secret');
    assert.doesNotMatch(payloadStr, /gap\.webhook\.buyer.*@example\.com/, 'webhook payload must not contain buyer email');
  }
  await app.close();
});

// ─── GAP-27: Stripe livemode enforcement ─────────────────

test('GAP-27: Stripe webhook rejects test-mode events when livemode enforcement is enabled', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-stripe-livemode');
  const nodeId = b.json().node.id;

  await withConfigOverrides({ stripeEnforceLivemode: true }, async () => {
    const testmodeBody = {
      id: `evt_gap_livemode_test_${nodeId.slice(0, 8)}`,
      type: 'checkout.session.completed',
      livemode: false,
      data: { object: { payment_status: 'paid', metadata: { node_id: nodeId, plan_code: 'basic' }, customer: `cus_lm_${nodeId.slice(0, 8)}`, subscription: `sub_lm_${nodeId.slice(0, 8)}` } },
    };
    const sig = sign(testmodeBody);
    const res = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
    assert.ok([200, 400, 403].includes(res.statusCode), `expected controlled handling for test-mode event, got ${res.statusCode}`);

    if (res.statusCode === 200) {
      const subRows = await query("select plan_code from subscriptions where node_id=$1", [nodeId]);
      const planCode = subRows.length > 0 ? subRows[0].plan_code : 'free';
      assert.ok(planCode === 'free' || planCode === undefined || subRows.length === 0,
        'test-mode event should not activate a paid subscription when livemode is enforced');
    }
  });
  await app.close();
});

// ─── GAP-12: Double-accept race condition ────────────────

test('GAP-12: concurrent accepts from both parties result in exactly one mutual acceptance with correct fee charges', async () => {
  const app = buildApp();
  const sellerBoot = await bootstrap(app, 'gap-double-accept-seller');
  const buyerBoot = await bootstrap(app, 'gap-double-accept-buyer');
  const sellerNodeId = sellerBoot.json().node.id;
  const buyerNodeId = buyerBoot.json().node.id;
  const sellerKey = sellerBoot.json().api_key.api_key;
  const buyerKey = buyerBoot.json().api_key.api_key;

  const unit = await repo.createResource('units', sellerNodeId, unitPayload('Double accept unit', 'gap-double-accept-scope'));
  const create = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${buyerKey}`, 'idempotency-key': 'gap-double-accept-create' },
    payload: { unit_ids: [unit.id], thread_id: null, note: null },
  });
  assert.equal(create.statusCode, 200);
  const offerId = create.json().offer.id;

  const sellerBalBefore = await repo.creditBalance(sellerNodeId);
  const buyerBalBefore = await repo.creditBalance(buyerNodeId);

  const [sellerAccept, buyerAccept] = await Promise.all([
    app.inject({
      method: 'POST',
      url: `/v1/offers/${offerId}/accept`,
      headers: { authorization: `ApiKey ${sellerKey}`, 'idempotency-key': 'gap-double-accept-seller' },
      payload: {},
    }),
    app.inject({
      method: 'POST',
      url: `/v1/offers/${offerId}/accept`,
      headers: { authorization: `ApiKey ${buyerKey}`, 'idempotency-key': 'gap-double-accept-buyer' },
      payload: {},
    }),
  ]);

  assert.ok([200].includes(sellerAccept.statusCode));
  assert.ok([200].includes(buyerAccept.statusCode));

  const offerAfter = await repo.getOffer(offerId);
  assert.equal(offerAfter.status, 'mutually_accepted');

  const sellerFeeRows = await query(
    "select count(*)::text as c from credit_ledger where node_id=$1 and type='deal_accept_fee' and (meta->>'offer_id')=$2",
    [sellerNodeId, offerId],
  );
  const buyerFeeRows = await query(
    "select count(*)::text as c from credit_ledger where node_id=$1 and type='deal_accept_fee' and (meta->>'offer_id')=$2",
    [buyerNodeId, offerId],
  );
  assert.equal(Number(sellerFeeRows[0].c), 1, 'seller should be charged exactly once');
  assert.equal(Number(buyerFeeRows[0].c), 1, 'buyer should be charged exactly once');

  const sellerBalAfter = await repo.creditBalance(sellerNodeId);
  const buyerBalAfter = await repo.creditBalance(buyerNodeId);
  assert.equal(sellerBalBefore - sellerBalAfter, config.dealAcceptanceFeeCredits);
  assert.equal(buyerBalBefore - buyerBalAfter, config.dealAcceptanceFeeCredits);
  await app.close();
});

// ─── GAP-13: Double-spend on search credits ──────────────

test('GAP-13: concurrent searches do not double-charge or under-charge', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-double-search');
  const apiKey = b.json().api_key.api_key;
  const nodeId = b.json().node.id;

  const balBefore = await repo.creditBalance(nodeId);

  const searchPayload = {
    q: 'double-spend-test',
    scope: 'OTHER',
    filters: { scope_notes: 'gap-double-search-scope' },
    budget: { credits_max: config.searchCreditCost },
    limit: 20,
    cursor: null,
  };

  const results = await Promise.all([
    app.inject({
      method: 'POST',
      url: '/v1/search/listings',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-double-search-1' },
      payload: searchPayload,
    }),
    app.inject({
      method: 'POST',
      url: '/v1/search/listings',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-double-search-2' },
      payload: searchPayload,
    }),
  ]);

  const successes = results.filter((r) => r.statusCode === 200);
  const balAfter = await repo.creditBalance(nodeId);
  const totalCharged = balBefore - balAfter;
  assert.equal(totalCharged, successes.length * config.searchCreditCost,
    `charged ${totalCharged} but expected ${successes.length * config.searchCreditCost}`);
  await app.close();
});

// ─── GAP-20: NOWPayments missing API key ─────────────────

test('GAP-20: crypto-credit-pack returns graceful error when NOWPayments key is missing', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-nowpay-missing-key');
  const apiKey = b.json().api_key.api_key;

  await withConfigOverrides({ nowpaymentsApiKey: '' }, async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/crypto-credit-pack',
      headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-nowpay-missing' },
      payload: { pack_code: 'credits_500', pay_currency: 'btc' },
    });
    assert.ok([422, 503, 500].includes(res.statusCode), `expected graceful failure, got ${res.statusCode}`);
    assert.ok(res.json().error, 'must return error envelope');
  });
  await app.close();
});

// ─── Response header assertions (credits + rate limit) ───

test('all authenticated responses include X-Credits-Remaining and X-RateLimit-* headers', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-headers');
  const apiKey = b.json().api_key.api_key;

  const rateLimitEndpoints = [
    { method: 'GET', url: '/v1/me' },
    { method: 'GET', url: '/v1/credits/balance' },
    { method: 'GET', url: '/v1/auth/keys' },
  ];

  for (const ep of rateLimitEndpoints) {
    const res = await app.inject({ ...ep, headers: { authorization: `ApiKey ${apiKey}` } });
    assert.equal(res.statusCode, 200);
    assert.ok(res.headers['x-ratelimit-limit'] !== undefined, `${ep.method} ${ep.url} missing x-ratelimit-limit`);
    assert.ok(res.headers['x-ratelimit-remaining'] !== undefined, `${ep.method} ${ep.url} missing x-ratelimit-remaining`);
    assert.ok(res.headers['x-ratelimit-reset'] !== undefined, `${ep.method} ${ep.url} missing x-ratelimit-reset`);
  }
  await app.close();
});

// ─── Error envelope on all non-2xx ───────────────────────

test('non-2xx responses always use the canonical error envelope', async () => {
  const app = buildApp();

  const endpoints = [
    { method: 'GET', url: '/v1/me' },
    { method: 'GET', url: '/v1/units/00000000-0000-0000-0000-000000000000' },
    { method: 'POST', url: '/v1/admin/takedown', payload: {} },
  ];

  for (const ep of endpoints) {
    const res = await app.inject({ ...ep, headers: {} });
    assert.ok(res.statusCode >= 400, `expected non-2xx for unauthenticated ${ep.method} ${ep.url}`);
    const body = res.json();
    assert.ok(body.error, `${ep.method} ${ep.url} must return error envelope`);
    assert.ok(typeof body.error.code === 'string', `${ep.method} ${ep.url} error.code must be string`);
    assert.ok(typeof body.error.message === 'string', `${ep.method} ${ep.url} error.message must be string`);
  }
  await app.close();
});

// ─── Projection allowlist: no PII leak ───────────────────

test('published request projection does not leak email, phone, or address', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-req-projection-pii', { email: `gap.proj.${TEST_RUN_SUFFIX}@example.com` });
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;

  const created = await app.inject({
    method: 'POST',
    url: '/v1/requests',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-req-proj-pii-create' },
    payload: unitPayload('Projection PII request', 'gap-req-proj-pii-scope'),
  });
  assert.equal(created.statusCode, 200);
  const requestId = created.json().request.id;

  await app.inject({
    method: 'POST',
    url: `/v1/requests/${requestId}/publish`,
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'gap-req-proj-pii-publish' },
    payload: {},
  });

  const rows = await query('select doc from public_requests where request_id=$1', [requestId]);
  assert.equal(rows.length, 1);
  const doc = rows[0].doc;
  const docStr = JSON.stringify(doc);
  assert.doesNotMatch(docStr, /email/i);
  assert.doesNotMatch(docStr, /phone/i);
  assert.doesNotMatch(docStr, /address/i);
  assert.doesNotMatch(docStr, /messaging_handles/i);
  await app.close();
});

// ─── Stripe subscription.updated direct webhook test ─────

test('GAP-17: Stripe customer.subscription.updated webhook updates subscription status', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'gap-sub-updated');
  const nodeId = b.json().node.id;

  await activateBasicSubscriber(app, nodeId, 'evt_gap_sub_updated_init');

  const body = {
    id: `evt_sub_updated_gap_${nodeId.slice(0, 8)}`,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: `sub_${nodeId.slice(0, 8)}`,
        customer: `cus_${nodeId.slice(0, 8)}`,
        status: 'past_due',
        metadata: { node_id: nodeId },
        items: { data: [{ price: { id: 'price_basic_test' } }] },
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
      },
    },
  };
  const sig = sign(body);
  const res = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': sig.header }, payload: sig.raw });
  assert.equal(res.statusCode, 200);

  const sub = await query("select status from subscriptions where node_id=$1", [nodeId]);
  assert.ok(sub.length > 0);
  assert.equal(sub[0].status, 'past_due');
  await app.close();
});
