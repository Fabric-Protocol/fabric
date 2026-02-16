import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

delete process.env.DATABASE_URL;
delete process.env.ADMIN_KEY;
delete process.env.STRIPE_SECRET_KEY;
delete process.env.STRIPE_WEBHOOK_SECRET;

process.env.ADMIN_KEY = 'admin-test';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';

const { buildApp } = await import('../dist/src/app.js');
const repo = await import('../dist/src/db/fabricRepo.js');

async function bootstrap(app, idk = 'boot-1', payload = { display_name: 'Node', email: null, referral_code: null }) {
  const res = await app.inject({ method: 'POST', url: '/v1/bootstrap', headers: { 'idempotency-key': idk }, payload });
  return res;
}

function sign(body) {
  const t = Math.floor(Date.now() / 1000);
  const raw = JSON.stringify(body);
  const v1 = crypto.createHmac('sha256', process.env.STRIPE_WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex');
  return { t, v1, raw, header: `t=${t},v1=${v1}` };
}

test('canonical error envelope for unauthorized', async () => {
  const app = buildApp();
  const res = await app.inject({ method: 'GET', url: '/v1/me' });
  assert.equal(res.statusCode, 401);
  assert.equal(res.json().error.code, 'unauthorized');
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
