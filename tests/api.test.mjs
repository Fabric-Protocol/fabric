import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

delete process.env.DATABASE_URL;
delete process.env.ADMIN_KEY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;
delete process.env.STRIPE_PRICE_PLUS;
delete process.env.STRIPE_PRICE_IDS_PLUS;

process.env.ADMIN_KEY = 'admin-test';
process.env.STRIPE_SECRET_KEY = 'sk_test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_PRICE_PLUS = 'price_plus_test';
process.env.STRIPE_PRICE_BASIC = 'price_basic_test';
process.env.RATE_LIMIT_BOOTSTRAP_PER_HOUR = '1000';

const REQUIRED_LEGAL_VERSION = '2026-02-17';

const { buildApp } = await import('../dist/src/app.js');
const repo = await import('../dist/src/db/fabricRepo.js');

async function bootstrap(app, idk = 'boot-1', payload = { display_name: 'Node', email: null, referral_code: null }) {
  const requestPayload = {
    display_name: 'Node',
    email: null,
    referral_code: null,
    legal: { accepted: true, version: REQUIRED_LEGAL_VERSION },
    ...payload,
    legal: (payload && typeof payload === 'object' && payload.legal) ? payload.legal : { accepted: true, version: REQUIRED_LEGAL_VERSION },
  };
  const res = await app.inject({ method: 'POST', url: '/v1/bootstrap', headers: { 'idempotency-key': idk }, payload: requestPayload });
  return res;
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

test('canonical error envelope for unauthorized', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/v1/me' });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'unauthorized');
  await app.close();
});

test('GET /v1/meta returns required legal version and legal URLs', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/v1/meta' });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.equal(body.api_version, 'v1');
  assert.equal(body.required_legal_version, REQUIRED_LEGAL_VERSION);
  assert.match(body.openapi_url, /\/openapi\.json$/);
  assert.match(body.legal_urls.terms, /\/legal\/terms$/);
  assert.match(body.legal_urls.privacy, /\/legal\/privacy$/);
  assert.match(body.legal_urls.aup, /\/legal\/aup$/);
  assert.match(body.support_url, /\/support$/);
  await app.close();
});

test('GET /openapi.json returns valid OpenAPI JSON', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/openapi.json' });
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
  const res = await app.inject({ method: 'GET', url: '/docs/agents' });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type'] ?? ''), /^text\/html/);
  assert.match(res.body, /Fabric Agent Quickstart/);
  assert.match(res.body, /Authorization: ApiKey/);
  assert.match(res.body, /required_legal_version/);
  await app.close();
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
  const res = await app.inject({
    method: 'POST',
    url: '/v1/bootstrap',
    headers: {
      'idempotency-key': 'boot-with-legal',
      'user-agent': 'fabric-test-agent',
      'x-forwarded-for': '203.0.113.10, 198.51.100.3',
    },
    payload: {
      display_name: 'Node Legal',
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

test('subscriber-gated endpoints stay blocked for non-subscribers even with credits', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-subscriber-gate');
  const nodeId = b.json().node.id;
  const apiKey = b.json().api_key.api_key;
  const balBefore = await repo.creditBalance(nodeId);
  assert.equal(balBefore > 0, true);

  const search = await app.inject({
    method: 'POST',
    url: '/v1/search/listings',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'sg-1' },
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'x' }, broadening: { level: 0, allow: false }, limit: 20, cursor: null },
  });
  assert.equal(search.statusCode, 403);
  assert.equal(search.json().error.code, 'subscriber_required');

  const offer = await app.inject({
    method: 'POST',
    url: '/v1/offers',
    headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 'sg-2' },
    payload: { unit_ids: ['00000000-0000-0000-0000-000000000001'], thread_id: null, note: null },
  });
  assert.equal(offer.statusCode, 403);
  assert.equal(offer.json().error.code, 'subscriber_required');

  const balAfter = await repo.creditBalance(nodeId);
  assert.equal(balAfter, balBefore);
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
    assert.equal(form.get('line_items[0][price]'), 'price_plus_test');
    assert.equal(form.get('metadata[node_id]'), nodeId);
    assert.equal(form.get('metadata[plan_code]'), 'plus');
    assert.equal(form.get('subscription_data[metadata][node_id]'), nodeId);
    assert.equal(form.get('subscription_data[metadata][plan_code]'), 'plus');

    return jsonResponse(200, {
      id: 'cs_test_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_123',
      mode: 'subscription',
    });
  }, async () => {
    const payload = {
      node_id: nodeId,
      plan_code: 'plus',
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
    assert.equal(first.json().plan_code, 'plus');
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

test('webhook maps invoice.paid price id to plus plan', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh-plus-plan');
  const nodeId = b.json().node.id;
  const balBefore = await repo.creditBalance(nodeId);

  const invoiceEvent = {
    id: `evt_plus_invoice_${nodeId.slice(0, 8)}`,
    type: 'invoice.paid',
    data: {
      object: {
        id: `in_plus_${nodeId.slice(0, 8)}`,
        customer: `cus_plus_${nodeId.slice(0, 8)}`,
        subscription: `sub_plus_${nodeId.slice(0, 8)}`,
        period_start: 1735689600,
        period_end: 1738368000,
        metadata: { node_id: nodeId },
        lines: {
          data: [
            {
              amount: 1999,
              pricing: {
                type: 'price_details',
                price_details: { price: 'price_plus_test' },
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
  assert.equal(me.json().subscription.plan, 'plus');
  const balAfter = await repo.creditBalance(nodeId);
  assert.equal(balAfter - balBefore, 1500);
  await app.close();
});

test('invoice.paid credits grant ignores prior zero-credit grant for same period', async () => {
  const app = buildApp();
  const b = await bootstrap(app, 'boot-wh-plus-regrant');
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
    id: `evt_plus_after_zero_${nodeId.slice(0, 8)}`,
    type: 'invoice.paid',
    data: {
      object: {
        id: `in_plus_after_zero_${nodeId.slice(0, 8)}`,
        customer: `cus_zero_${nodeId.slice(0, 8)}`,
        subscription: `sub_zero_${nodeId.slice(0, 8)}`,
        period_start: periodStart,
        period_end: periodEnd,
        metadata: { node_id: nodeId, plan_code: 'plus' },
      },
    },
  };
  const secondSig = sign(secondEvent);
  const secondRes = await app.inject({ method: 'POST', url: '/v1/webhooks/stripe', headers: { 'stripe-signature': secondSig.header }, payload: secondSig.raw });
  assert.equal(secondRes.statusCode, 200);

  const me = await app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `ApiKey ${b.json().api_key.api_key}` } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().subscription.plan, 'plus');
  const afterPaid = await repo.creditBalance(nodeId);
  assert.equal(afterPaid - beforePaid, 1500);
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
  const bad = await app.inject({ method: 'POST', url: '/v1/search/listings', headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 's1' }, payload: { q: null, scope: 'ship_to', filters: {}, broadening: { level: 0, allow: false }, limit: 20, cursor: null } });
  assert.equal(bad.statusCode, 422);
  const bal2 = await repo.creditBalance(nodeId);
  assert.equal(bal2, bal1);

  const ok = await app.inject({ method: 'POST', url: '/v1/search/listings', headers: { authorization: `ApiKey ${apiKey}`, 'idempotency-key': 's2' }, payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'x' }, broadening: { level: 0, allow: false }, limit: 20, cursor: null } });
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
    payload: { q: null, scope: 'OTHER', filters: { scope_notes: 'x' }, broadening: { level: 0, allow: false }, limit: 20, cursor: null },
  });
  assert.equal(res.statusCode, 402);
  assert.equal(res.json().error.code, 'credits_exhausted');
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
