/**
 * Full end-to-end test suite for Fabric API.
 * Tests every endpoint exactly as a new user/agent would call them.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ADMIN_KEY = process.env.ADMIN_KEY || '8PcjGUbrMEWKvXROi9ztsno5D4YTheLpQ6qJdAxg3f1ylC72';

let pass = 0;
let fail = 0;
const failures = [];

const RUN_ID = Date.now().toString(36);
function idemKey() { return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }

async function api(method, path, { body, headers = {} } = {}) {
  const url = `${BASE}${path}`;
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), json, text, ok: res.ok };
}

function assert(condition, testName, detail) {
  if (condition) {
    pass++;
    console.log(`  PASS: ${testName}`);
  } else {
    fail++;
    const msg = `  FAIL: ${testName}${detail ? ' — ' + detail : ''}`;
    console.log(msg);
    failures.push(msg);
  }
}

// ═══════════════════════════════════════════════════════
// SECTION 0: Public metadata (no auth)
// ═══════════════════════════════════════════════════════

async function testMeta() {
  console.log('\n=== GET /v1/meta ===');
  const r = await api('GET', '/v1/meta');
  assert(r.status === 200, 'status 200');
  assert(r.json?.api_version === 'v1', 'api_version = v1');
  assert(r.json?.required_legal_version === '2026-02-17', 'required_legal_version present');
  assert(typeof r.json?.openapi_url === 'string', 'openapi_url present');
  assert(typeof r.json?.categories_url === 'string', 'categories_url present');
  assert(typeof r.json?.regions_url === 'string', 'regions_url present');
  assert(typeof r.json?.mcp_url === 'string', 'mcp_url present');
  assert(typeof r.json?.legal_urls?.terms === 'string', 'legal_urls.terms present');
  assert(typeof r.json?.agent_toc === 'object', 'agent_toc present');
  assert(Array.isArray(r.json?.agent_toc?.start_here), 'agent_toc.start_here is array');
  assert(Array.isArray(r.json?.agent_toc?.happy_path), 'agent_toc.happy_path is array');
  assert(Array.isArray(r.json?.agent_toc?.deal_structures), 'agent_toc.deal_structures is array');
  assert(Array.isArray(r.json?.agent_toc?.capabilities), 'agent_toc.capabilities is array');
  return r.json;
}

async function testCategories() {
  console.log('\n=== GET /v1/categories ===');
  const r = await api('GET', '/v1/categories');
  assert(r.status === 200, 'status 200');
  assert(Array.isArray(r.json?.categories), 'categories is array');
  assert(r.json?.categories?.length >= 1, 'at least 1 category');
  const c = r.json?.categories?.[0];
  assert(typeof c?.id === 'number', 'first category has numeric id');
  assert(typeof c?.slug === 'string', 'first category has slug');
  assert(typeof c?.name === 'string', 'first category has name');
  assert(typeof r.json?.categories_version === 'number', 'categories_version present');
  return r.json;
}

async function testOpenAPI() {
  console.log('\n=== GET /openapi.json ===');
  const r = await api('GET', '/openapi.json');
  assert(r.status === 200, 'status 200');
  assert(r.json?.openapi === '3.0.3', 'openapi version 3.0.3');
  assert(typeof r.json?.paths === 'object', 'paths object present');
  assert(typeof r.json?.components?.schemas === 'object', 'components.schemas present');
}

async function testRegions() {
  console.log('\n=== GET /v1/regions ===');
  const r = await api('GET', '/v1/regions');
  assert(r.status === 200, 'status 200');
  assert(Array.isArray(r.json?.regions), 'regions is array');
  assert(r.json?.regions?.includes('US'), 'includes US');
  assert(r.json?.regions?.includes('US-CA'), 'includes US-CA');
  assert(typeof r.json?.format === 'string', 'format field present');
}

async function testHealthz() {
  console.log('\n=== GET /healthz ===');
  const r = await api('GET', '/healthz');
  assert(r.status === 200, 'status 200');
  assert(r.json?.ok === true, 'ok: true');
}

async function testLegalPages() {
  console.log('\n=== Legal/Support/Docs HTML pages ===');
  for (const path of ['/legal/terms', '/legal/privacy', '/legal/acceptable-use', '/legal/aup', '/legal/refunds', '/legal/agents', '/support', '/docs/agents']) {
    const r = await api('GET', path);
    assert(r.status === 200, `${path} returns 200`);
    assert(r.text.includes('<!doctype html>') || r.text.includes('<!DOCTYPE html>') || r.text.includes('<html'), `${path} returns HTML`);
  }
}

// ═══════════════════════════════════════════════════════
// SECTION 1: Bootstrap + Auth
// ═══════════════════════════════════════════════════════

async function testBootstrapValidation() {
  console.log('\n=== POST /v1/bootstrap — validation errors ===');
  const r1 = await api('POST', '/v1/bootstrap', {
    body: { email: null, referral_code: null, legal: { accepted: true, version: '2026-02-17' } },
    headers: { 'Idempotency-Key': idemKey() },
  });
  assert(r1.status === 422, 'missing display_name => 422', `got ${r1.status}`);
  assert(r1.json?.error?.code, 'error envelope present');

  const r2 = await api('POST', '/v1/bootstrap', {
    body: { display_name: 'TestBad', email: null, referral_code: null },
    headers: { 'Idempotency-Key': idemKey() },
  });
  assert(r2.status === 422, 'missing legal => 422', `got ${r2.status}`);

  const r3 = await api('POST', '/v1/bootstrap', {
    body: { display_name: 'TestBad', email: null, referral_code: null, legal: { accepted: true, version: '2020-01-01' } },
    headers: { 'Idempotency-Key': idemKey() },
  });
  assert(r3.status === 422, 'wrong legal_version => 422', `got ${r3.status}`);

  const r4 = await api('POST', '/v1/bootstrap', {
    body: { display_name: 'TestBad', email: null, referral_code: null, legal: { accepted: false, version: '2026-02-17' } },
    headers: { 'Idempotency-Key': idemKey() },
  });
  assert(r4.status === 422, 'legal_accepted=false => 422', `got ${r4.status}`);
}

async function testAuth401() {
  console.log('\n=== Auth 401 — missing/invalid API key ===');
  const r1 = await api('GET', '/v1/me');
  assert(r1.status === 401, 'GET /v1/me without auth => 401', `got ${r1.status}`);
  assert(r1.json?.error?.code, 'error envelope present');

  const r2 = await api('GET', '/v1/me', { headers: { 'Authorization': 'ApiKey invalid-key-xxx' } });
  assert(r2.status === 401, 'GET /v1/me with bad key => 401', `got ${r2.status}`);
}

function extractKey(bootstrapJson) {
  if (typeof bootstrapJson?.api_key === 'string') return bootstrapJson.api_key;
  if (typeof bootstrapJson?.api_key?.api_key === 'string') return bootstrapJson.api_key.api_key;
  return null;
}

async function testBootstrap() {
  console.log('\n=== POST /v1/bootstrap (Node A — seller) ===');
  const r = await api('POST', '/v1/bootstrap', {
    body: { display_name: `E2E-Seller-${RUN_ID}`, email: `seller-${RUN_ID}@test.local`, referral_code: null, legal: { accepted: true, version: '2026-02-17' } },
    headers: { 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  const apiKey = extractKey(r.json);
  const nodeId = r.json?.node?.id;
  assert(typeof nodeId === 'string', 'node.id present');
  assert(typeof apiKey === 'string', 'api_key present');
  assert(r.json?.node?.display_name === `E2E-Seller-${RUN_ID}`, 'display_name matches');
  return { json: r.json, apiKey, nodeId };
}

async function testBootstrapBuyer() {
  console.log('\n=== POST /v1/bootstrap (Node B — buyer) ===');
  const r = await api('POST', '/v1/bootstrap', {
    body: { display_name: `E2E-Buyer-${RUN_ID}`, email: `buyer-${RUN_ID}@test.local`, referral_code: null, legal: { accepted: true, version: '2026-02-17' } },
    headers: { 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  const apiKey = extractKey(r.json);
  const nodeId = r.json?.node?.id;
  assert(typeof apiKey === 'string', 'api_key present');
  return { json: r.json, apiKey, nodeId };
}

async function testMe(apiKey) {
  console.log('\n=== GET /v1/me ===');
  const r = await api('GET', '/v1/me', { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r.status === 200, 'status 200');
  assert(typeof r.json?.node?.id === 'string', 'node.id present');
  assert(typeof r.json?.subscription === 'object', 'subscription present');
  assert(typeof r.json?.credits_balance === 'number', 'credits_balance present');
  assert(typeof r.json?.node?.display_name === 'string', 'display_name present');
  assert(typeof r.json?.node?.plan === 'string', 'plan present');
  return r.json;
}

async function testMePatch(apiKey, version) {
  console.log('\n=== PATCH /v1/me ===');
  const r = await api('PATCH', '/v1/me', {
    body: { display_name: `E2E-Seller-Updated-${RUN_ID}` },
    headers: {
      'Authorization': `ApiKey ${apiKey}`,
      'Idempotency-Key': idemKey(),
      'If-Match': String(version),
    },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  assert(r.json?.node?.display_name === `E2E-Seller-Updated-${RUN_ID}`, 'display_name updated');

  // Test messaging_handles update
  const r2 = await api('PATCH', '/v1/me', {
    body: { messaging_handles: [{ kind: 'telegram', handle: '@e2etest', url: null }] },
    headers: {
      'Authorization': `ApiKey ${apiKey}`,
      'Idempotency-Key': idemKey(),
      'If-Match': String(r.json?.node?.version ?? version + 1),
    },
  });
  assert(r2.status === 200, 'messaging_handles update => 200', `got ${r2.status}`);
  return r2.json;
}

async function testApiKeyManagement(apiKey) {
  console.log('\n=== API Key Management (create, list, revoke) ===');
  const r1 = await api('POST', '/v1/auth/keys', {
    body: { label: 'secondary-key' },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r1.status === 200, 'POST /v1/auth/keys => 200', `got ${r1.status}: ${JSON.stringify(r1.json)}`);
  const newKeyRaw = extractKey(r1.json) ?? r1.json?.api_key;
  assert(typeof newKeyRaw === 'string', 'new api_key returned');
  const newKeyId = r1.json?.key_id;
  assert(typeof newKeyId === 'string', 'key_id returned');

  const r2 = await api('GET', '/v1/auth/keys', { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r2.status === 200, 'GET /v1/auth/keys => 200', `got ${r2.status}`);
  const keys = r2.json?.keys ?? r2.json;
  assert(Array.isArray(keys), 'keys array returned');
  assert(keys?.length >= 2, 'at least 2 keys');

  if (newKeyId) {
    const r3 = await api('DELETE', `/v1/auth/keys/${newKeyId}`, {
      headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
    });
    assert(r3.status === 200, `DELETE /v1/auth/keys/${newKeyId} => 200`, `got ${r3.status}`);
  }
}

// ═══════════════════════════════════════════════════════
// SECTION 2: Credits
// ═══════════════════════════════════════════════════════

async function testCreditsBalance(apiKey) {
  console.log('\n=== GET /v1/credits/balance ===');
  const r = await api('GET', '/v1/credits/balance', { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r.status === 200, 'status 200');
  assert(typeof r.json?.credits_balance === 'number', 'credits_balance is number');
  assert(typeof r.json?.subscription === 'object', 'subscription present');
  return r.json?.credits_balance;
}

async function testCreditsLedger(apiKey) {
  console.log('\n=== GET /v1/credits/ledger ===');
  const r = await api('GET', '/v1/credits/ledger', { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r.status === 200, 'status 200');
  assert(Array.isArray(r.json?.entries), 'entries is array');
  assert(r.json?.entries?.length >= 1, 'at least 1 ledger entry (signup grant)');
  const entry = r.json?.entries?.[0];
  assert(typeof entry?.amount === 'number' || typeof entry?.delta === 'number', 'entry has amount or delta');
  return r.json;
}

async function testCreditsQuoteGet(apiKey) {
  console.log('\n=== GET /v1/credits/quote ===');
  const r = await api('GET', '/v1/credits/quote', { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r.status === 200, 'status 200');
  assert(typeof r.json?.credits_balance === 'number', 'credits_balance in quote');
  assert(typeof r.json?.search_quote === 'object', 'search_quote present');
  assert(Array.isArray(r.json?.credit_packs), 'credit_packs array present');
  assert(Array.isArray(r.json?.plans), 'plans array present');
  return r.json;
}

async function testCreditsQuotePost(apiKey) {
  console.log('\n=== POST /v1/credits/quote (estimate) ===');
  const r = await api('POST', '/v1/credits/quote', {
    body: { q: 'GPU hours', scope: 'remote_online_service', filters: { regions: ['US'] }, budget: { credits_requested: 50 }, limit: 20, cursor: null },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  assert(typeof r.json?.search_quote?.estimated_cost === 'number', 'estimated_cost present');
  return r.json;
}

// ═══════════════════════════════════════════════════════
// SECTION 3: Unit CRUD
// ═══════════════════════════════════════════════════════

async function testUnitCreate(apiKey, overrides = {}) {
  console.log('\n=== POST /v1/units (create) ===');
  const r = await api('POST', '/v1/units', {
    body: {
      title: overrides.title ?? 'E2E Test GPU Server',
      description: 'High-performance GPU compute for ML workloads',
      type: 'service',
      quantity: 10,
      measure: 'HR',
      estimated_value: 50,
      scope_primary: 'remote_online_service',
      service_region: { country_code: 'US', admin1: 'CA' },
      tags: ['gpu', 'ml', 'compute'],
      category_ids: [8],
      public_summary: 'GPU hours available for ML workloads',
      ...overrides,
    },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  const unit = r.json?.unit ?? r.json;
  assert(typeof unit?.id === 'string', 'unit id present');
  return unit;
}

async function testUnitCreateSecond(apiKey) {
  console.log('\n=== POST /v1/units (create second unit) ===');
  const r = await api('POST', '/v1/units', {
    body: {
      title: 'E2E Storage Block',
      description: '1TB SSD storage allocation',
      type: 'service',
      quantity: 5,
      measure: 'DAY',
      estimated_value: 20,
      scope_primary: 'remote_online_service',
      service_region: { country_code: 'US' },
      tags: ['storage', 'ssd'],
      category_ids: [8],
      public_summary: 'SSD storage days available',
    },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  const unit = r.json?.unit ?? r.json;
  return unit;
}

async function testUnitList(apiKey) {
  console.log('\n=== GET /v1/units (list) ===');
  const r = await api('GET', '/v1/units', { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r.status === 200, 'status 200');
  const units = r.json?.units ?? (Array.isArray(r.json) ? r.json : null);
  assert(Array.isArray(units), 'units is array');
  assert(units?.length >= 1, 'at least 1 unit');
  return units;
}

async function testUnitGet(apiKey, unitId) {
  console.log('\n=== GET /v1/units/:id ===');
  const r = await api('GET', `/v1/units/${unitId}`, { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r.status === 200, 'status 200', `got ${r.status}`);
  const unit = r.json?.unit ?? r.json;
  assert(unit?.id === unitId, 'correct unit returned');
  assert(typeof unit?.row_version === 'string' || typeof unit?.version === 'number', 'version/row_version present');
  return unit;
}

async function testUnitPatch(apiKey, unitId, version) {
  console.log('\n=== PATCH /v1/units/:id ===');
  const r = await api('PATCH', `/v1/units/${unitId}`, {
    body: { description: 'Updated: Premium GPU compute' },
    headers: {
      'Authorization': `ApiKey ${apiKey}`,
      'Idempotency-Key': idemKey(),
      'If-Match': String(version),
    },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json;
}

async function testUnitDelete(apiKey, unitId) {
  console.log('\n=== DELETE /v1/units/:id (soft delete) ===');
  const r = await api('DELETE', `/v1/units/${unitId}`, {
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);

  // Verify soft deleted — GET should return 404
  const r2 = await api('GET', `/v1/units/${unitId}`, { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r2.status === 404, 'deleted unit returns 404 on GET', `got ${r2.status}`);
  return r.json;
}

// ═══════════════════════════════════════════════════════
// SECTION 4: Request CRUD
// ═══════════════════════════════════════════════════════

async function testRequestCreate(apiKey) {
  console.log('\n=== POST /v1/requests (create) ===');
  const r = await api('POST', '/v1/requests', {
    body: {
      title: 'E2E Need: Data Labeling Service',
      description: 'Looking for image classification labeling',
      type: 'service',
      scope_primary: 'remote_online_service',
      service_region: { country_code: 'US' },
      need_by: '2026-06-01',
      accept_substitutions: true,
      tags: ['data', 'labeling', 'ml'],
      category_ids: [2],
      public_summary: 'Need data labeling for ML project',
    },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  const req = r.json?.request ?? r.json;
  assert(typeof req?.id === 'string', 'request id present');
  return req;
}

async function testRequestList(apiKey) {
  console.log('\n=== GET /v1/requests (list) ===');
  const r = await api('GET', '/v1/requests', { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r.status === 200, 'status 200');
  const requests = r.json?.requests ?? (Array.isArray(r.json) ? r.json : null);
  assert(Array.isArray(requests), 'requests is array');
  assert(requests?.length >= 1, 'at least 1 request');
  return requests;
}

async function testRequestGet(apiKey, requestId) {
  console.log('\n=== GET /v1/requests/:id ===');
  const r = await api('GET', `/v1/requests/${requestId}`, { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r.status === 200, 'status 200');
  const req = r.json?.request ?? r.json;
  assert(req?.id === requestId, 'correct request returned');
  return req;
}

async function testRequestPatch(apiKey, requestId, version) {
  console.log('\n=== PATCH /v1/requests/:id ===');
  const r = await api('PATCH', `/v1/requests/${requestId}`, {
    body: { description: 'Updated: Need high-quality data labeling' },
    headers: {
      'Authorization': `ApiKey ${apiKey}`,
      'Idempotency-Key': idemKey(),
      'If-Match': String(version),
    },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json;
}

// ═══════════════════════════════════════════════════════
// SECTION 5: Publish/Unpublish
// ═══════════════════════════════════════════════════════

async function testPublishUnit(apiKey, unitId) {
  console.log(`\n=== POST /v1/units/${unitId}/publish ===`);
  const r = await api('POST', `/v1/units/${unitId}/publish`, {
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json;
}

async function testUnpublishUnit(apiKey, unitId) {
  console.log(`\n=== POST /v1/units/${unitId}/unpublish ===`);
  const r = await api('POST', `/v1/units/${unitId}/unpublish`, {
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json;
}

async function testPublishRequest(apiKey, requestId) {
  console.log(`\n=== POST /v1/requests/${requestId}/publish ===`);
  const r = await api('POST', `/v1/requests/${requestId}/publish`, {
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json;
}

async function testUnpublishRequest(apiKey, requestId) {
  console.log(`\n=== POST /v1/requests/${requestId}/unpublish ===`);
  const r = await api('POST', `/v1/requests/${requestId}/unpublish`, {
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json;
}

// ═══════════════════════════════════════════════════════
// SECTION 6: Search (metered)
// ═══════════════════════════════════════════════════════

async function testSearchListings(apiKey) {
  console.log('\n=== POST /v1/search/listings ===');
  const r = await api('POST', '/v1/search/listings', {
    body: {
      q: 'GPU',
      scope: 'remote_online_service',
      filters: { regions: ['US'] },
      budget: { credits_requested: 50 },
      limit: 20,
      cursor: null,
    },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  assert(Array.isArray(r.json?.items), 'items is array');
  assert(typeof r.json?.budget?.credits_charged === 'number', 'budget.credits_charged present');
  assert(typeof r.json?.search_id === 'string', 'search_id present');
  assert(typeof r.json?.has_more === 'boolean', 'has_more present');
  return r.json;
}

async function testSearchRequests(apiKey) {
  console.log('\n=== POST /v1/search/requests ===');
  const r = await api('POST', '/v1/search/requests', {
    body: {
      q: 'data labeling',
      scope: 'remote_online_service',
      filters: { regions: ['US'] },
      budget: { credits_requested: 50 },
      limit: 20,
      cursor: null,
    },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  assert(Array.isArray(r.json?.items), 'items is array');
  assert(typeof r.json?.budget?.credits_charged === 'number', 'budget.credits_charged present');
  return r.json;
}

async function testSearchWithAllScopes(apiKey) {
  console.log('\n=== Search with all 5 scopes ===');

  // local_in_person
  const r1 = await api('POST', '/v1/search/listings', {
    body: { q: null, scope: 'local_in_person', filters: { regions: ['US-CA'] }, budget: { credits_requested: 50 }, limit: 5, cursor: null },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r1.status === 200, 'local_in_person search => 200', `got ${r1.status}: ${JSON.stringify(r1.json)}`);

  // ship_to
  const r2 = await api('POST', '/v1/search/listings', {
    body: { q: null, scope: 'ship_to', filters: { ship_to_regions: ['US'] }, budget: { credits_requested: 50 }, limit: 5, cursor: null },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r2.status === 200, 'ship_to search => 200', `got ${r2.status}: ${JSON.stringify(r2.json)}`);

  // digital_delivery
  const r3 = await api('POST', '/v1/search/listings', {
    body: { q: null, scope: 'digital_delivery', filters: { regions: ['US'] }, budget: { credits_requested: 50 }, limit: 5, cursor: null },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r3.status === 200, 'digital_delivery search => 200', `got ${r3.status}: ${JSON.stringify(r3.json)}`);

  // OTHER
  const r4 = await api('POST', '/v1/search/listings', {
    body: { q: null, scope: 'OTHER', filters: { scope_notes: 'anything' }, budget: { credits_requested: 50 }, limit: 5, cursor: null },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r4.status === 200, 'OTHER search => 200', `got ${r4.status}: ${JSON.stringify(r4.json)}`);
}

// ═══════════════════════════════════════════════════════
// SECTION 7: Node Inventory Expansion
// ═══════════════════════════════════════════════════════

async function testNodeInventory(apiKey, nodeId) {
  console.log('\n=== GET /v1/public/nodes/:id/listings ===');
  const r1 = await api('GET', `/v1/public/nodes/${nodeId}/listings`, { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r1.status === 200, 'listings status 200', `got ${r1.status}`);

  console.log('\n=== GET /v1/public/nodes/:id/requests ===');
  const r2 = await api('GET', `/v1/public/nodes/${nodeId}/requests`, { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r2.status === 200, 'requests status 200', `got ${r2.status}`);

  console.log('\n=== POST /v1/public/nodes/categories-summary ===');
  const r3 = await api('POST', '/v1/public/nodes/categories-summary', {
    body: { node_ids: [nodeId], kind: 'both' },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r3.status === 200, 'categories-summary status 200', `got ${r3.status}: ${JSON.stringify(r3.json)}`);
  assert(typeof r3.json?.summaries === 'object', 'summaries object present');
}

// ═══════════════════════════════════════════════════════
// SECTION 8: Offers lifecycle
// ═══════════════════════════════════════════════════════

async function testOfferCreate(buyerKey, unitIds, label) {
  console.log(`\n=== POST /v1/offers (create — unit-targeted${label ? ', ' + label : ''}) ===`);
  const r = await api('POST', '/v1/offers', {
    body: {
      unit_ids: unitIds,
      note: 'I would like to trade my data labeling services for your GPU hours',
      ttl_minutes: 1440,
    },
    headers: { 'Authorization': `ApiKey ${buyerKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  const offer = r.json?.offer ?? r.json;
  assert(typeof offer?.id === 'string', 'offer.id present');
  assert(typeof offer?.status === 'string', 'status present');
  assert(typeof offer?.thread_id === 'string', 'thread_id present');
  return offer;
}

async function testOfferCreateRequestTargeted(sellerKey, requestId) {
  console.log('\n=== POST /v1/offers (create — request-targeted) ===');
  const r = await api('POST', '/v1/offers', {
    body: {
      request_id: requestId,
      note: 'I can provide data labeling — 10k images at $0.05/image',
      ttl_minutes: 1440,
    },
    headers: { 'Authorization': `ApiKey ${sellerKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  const offer = r.json?.offer ?? r.json;
  assert(typeof offer?.id === 'string', 'offer.id present');
  return offer;
}

async function testOfferList(apiKey, role) {
  console.log(`\n=== GET /v1/offers?role=${role} ===`);
  const r = await api('GET', `/v1/offers?role=${role}`, { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r.status === 200, 'status 200');
  const offers = r.json?.offers ?? (Array.isArray(r.json) ? r.json : null);
  assert(Array.isArray(offers), 'offers is array');
  return offers;
}

async function testOfferGet(apiKey, offerId) {
  console.log('\n=== GET /v1/offers/:id ===');
  const r = await api('GET', `/v1/offers/${offerId}`, { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r.status === 200, 'status 200', `got ${r.status}`);
  const offer = r.json?.offer ?? r.json;
  assert(offer?.id === offerId, 'correct offer returned');
  return offer;
}

async function testOfferCounter(apiKey, offerId, unitIds) {
  console.log('\n=== POST /v1/offers/:id/counter ===');
  const body = { note: 'Counter: Here is my counter-proposal', ttl_minutes: 720 };
  if (unitIds && unitIds.length > 0) body.unit_ids = unitIds;
  const r = await api('POST', `/v1/offers/${offerId}/counter`, {
    body,
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json?.offer ?? r.json;
}

async function testOfferAccept(apiKey, offerId, label) {
  console.log(`\n=== POST /v1/offers/:id/accept${label ? ' (' + label + ')' : ''} ===`);
  const r = await api('POST', `/v1/offers/${offerId}/accept`, {
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json?.offer ?? r.json;
}

async function testOfferReject(apiKey, offerId) {
  console.log('\n=== POST /v1/offers/:id/reject ===');
  const r = await api('POST', `/v1/offers/${offerId}/reject`, {
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json;
}

async function testOfferCancel(apiKey, offerId) {
  console.log('\n=== POST /v1/offers/:id/cancel ===');
  const r = await api('POST', `/v1/offers/${offerId}/cancel`, {
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json;
}

// ═══════════════════════════════════════════════════════
// SECTION 9: Contact reveal
// ═══════════════════════════════════════════════════════

async function testRevealContact(apiKey, offerId, label) {
  console.log(`\n=== POST /v1/offers/:id/reveal-contact${label ? ' (' + label + ')' : ''} ===`);
  const r = await api('POST', `/v1/offers/${offerId}/reveal-contact`, {
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  assert(typeof r.json?.contact === 'object', 'contact object present');
  return r.json;
}

// ═══════════════════════════════════════════════════════
// SECTION 10: Events
// ═══════════════════════════════════════════════════════

async function testEvents(apiKey, label) {
  console.log(`\n=== GET /v1/events${label ? ' (' + label + ')' : ''} ===`);
  const r = await api('GET', '/v1/events', { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r.status === 200, 'status 200', `got ${r.status}`);
  assert(Array.isArray(r.json?.events), 'events is array');
  return r.json;
}

// ═══════════════════════════════════════════════════════
// SECTION 11: Referrals
// ═══════════════════════════════════════════════════════

async function testReferralCode(apiKey) {
  console.log('\n=== GET /v1/me/referral-code ===');
  const r = await api('GET', '/v1/me/referral-code', { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r.status === 200, 'status 200', `got ${r.status}`);
  assert(typeof r.json?.referral_code === 'string', 'referral_code present');
  return r.json?.referral_code;
}

async function testReferralStats(apiKey) {
  console.log('\n=== GET /v1/me/referral-stats ===');
  const r = await api('GET', '/v1/me/referral-stats', { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r.status === 200, 'status 200', `got ${r.status}`);
  assert(typeof r.json?.total_referrals === 'number', 'total_referrals present');
  return r.json;
}

async function testReferralClaim(apiKey, code) {
  console.log('\n=== POST /v1/referrals/claim ===');
  const r = await api('POST', '/v1/referrals/claim', {
    body: { referral_code: code },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200 || r.status === 409 || r.status === 422, 'valid response code', `got ${r.status}: ${JSON.stringify(r.json)}`);
}

// ═══════════════════════════════════════════════════════
// SECTION 12: Billing
// ═══════════════════════════════════════════════════════

async function testBillingCheckout(apiKey) {
  console.log('\n=== POST /v1/billing/checkout-session ===');
  const r = await api('POST', '/v1/billing/checkout-session', {
    body: { plan: 'basic', success_url: 'https://example.com/success', cancel_url: 'https://example.com/cancel' },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200 || r.status === 422 || r.status === 503 || r.status === 500, 'valid response code', `got ${r.status}`);
  if (r.status === 200) {
    assert(typeof r.json?.url === 'string' || typeof r.json?.checkout_url === 'string', 'checkout url returned');
  }
}

async function testCreditPackCheckout(apiKey) {
  console.log('\n=== POST /v1/billing/credit-packs/checkout-session ===');
  const r = await api('POST', '/v1/billing/credit-packs/checkout-session', {
    body: { pack: '500', success_url: 'https://example.com/success', cancel_url: 'https://example.com/cancel' },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200 || r.status === 422 || r.status === 503 || r.status === 500, 'valid response code', `got ${r.status}: ${JSON.stringify(r.json)}`);
}

async function testCryptoCurrencies(apiKey) {
  console.log('\n=== GET /v1/billing/crypto-currencies ===');
  const r = await api('GET', '/v1/billing/crypto-currencies', { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  // 422 expected when NOWPAYMENTS_API_KEY not configured
  assert(r.status === 200 || r.status === 422, 'valid response (200 or 422 if crypto not configured)', `got ${r.status}`);
}

// ═══════════════════════════════════════════════════════
// SECTION 13: Idempotency
// ═══════════════════════════════════════════════════════

async function testIdempotency(apiKey) {
  console.log('\n=== Idempotency tests ===');
  const key = idemKey();
  const body1 = { title: 'Idempotency Test Unit' };

  const r1 = await api('POST', '/v1/units', {
    body: body1,
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': key },
  });
  assert(r1.status === 200, 'first call => 200');
  const unit1 = r1.json?.unit ?? r1.json;

  const r2 = await api('POST', '/v1/units', {
    body: body1,
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': key },
  });
  assert(r2.status === 200, 'replay same key+body => 200 (idempotent)');
  const unit2 = r2.json?.unit ?? r2.json;
  assert(unit1?.id === unit2?.id, 'replay returns same unit id');

  const r3 = await api('POST', '/v1/units', {
    body: { title: 'DIFFERENT BODY' },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': key },
  });
  assert(r3.status === 409, 'replay same key + different body => 409', `got ${r3.status}`);
  assert(r3.json?.error?.code, 'error envelope present on 409');
}

// ═══════════════════════════════════════════════════════
// SECTION 14: Optimistic concurrency
// ═══════════════════════════════════════════════════════

async function testOptimisticConcurrency(apiKey, unitId, correctVersion) {
  console.log('\n=== Optimistic concurrency (If-Match) ===');
  const r = await api('PATCH', `/v1/units/${unitId}`, {
    body: { description: 'stale write attempt' },
    headers: {
      'Authorization': `ApiKey ${apiKey}`,
      'Idempotency-Key': idemKey(),
      'If-Match': '99999',
    },
  });
  assert(r.status === 409, 'stale If-Match => 409', `got ${r.status}`);

  const r2 = await api('PATCH', `/v1/units/${unitId}`, {
    body: { description: 'no If-Match' },
    headers: {
      'Authorization': `ApiKey ${apiKey}`,
      'Idempotency-Key': idemKey(),
    },
  });
  assert(r2.status === 428 || r2.status === 422 || r2.status === 400, 'missing If-Match => 428/422/400', `got ${r2.status}`);
}

// ═══════════════════════════════════════════════════════
// SECTION 15: Admin
// ═══════════════════════════════════════════════════════

async function testAdminProjectionRebuild() {
  console.log('\n=== POST /v1/admin/projections/rebuild ===');
  const r = await api('POST', '/v1/admin/projections/rebuild', {
    body: { kind: 'all', mode: 'full' },
    headers: { 'X-Admin-Key': ADMIN_KEY, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
  return r.json;
}

async function testAdminTakedown() {
  console.log('\n=== POST /v1/admin/takedown ===');
  const r = await api('POST', '/v1/admin/takedown', {
    body: { target_type: 'public_listing', target_id: '00000000-0000-0000-0000-000000000000', reason: 'E2E test takedown' },
    headers: { 'X-Admin-Key': ADMIN_KEY, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200 || r.status === 404, 'admin takedown valid response', `got ${r.status}: ${JSON.stringify(r.json)}`);
}

async function testAdminCreditsAdjust(nodeId) {
  console.log('\n=== POST /v1/admin/credits/adjust ===');
  const r = await api('POST', '/v1/admin/credits/adjust', {
    body: { node_id: nodeId, delta: 50, reason: 'E2E test admin credit adjustment' },
    headers: { 'X-Admin-Key': ADMIN_KEY, 'Idempotency-Key': idemKey() },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}: ${JSON.stringify(r.json)}`);
}

async function testAdminDailyMetrics() {
  console.log('\n=== GET /internal/admin/daily-metrics ===');
  const r = await api('GET', '/internal/admin/daily-metrics', { headers: { 'X-Admin-Key': ADMIN_KEY } });
  assert(r.status === 200, 'status 200', `got ${r.status}`);
}

async function testAdminAuth401() {
  console.log('\n=== Admin auth 401 (missing/bad X-Admin-Key) ===');
  const r1 = await api('POST', '/v1/admin/projections/rebuild', {
    body: { kind: 'all', mode: 'full' },
    headers: { 'Idempotency-Key': idemKey() },
  });
  assert(r1.status === 401, 'missing admin key => 401', `got ${r1.status}`);

  const r2 = await api('POST', '/v1/admin/projections/rebuild', {
    body: { kind: 'all', mode: 'full' },
    headers: { 'X-Admin-Key': 'wrong-key', 'Idempotency-Key': idemKey() },
  });
  assert(r2.status === 401, 'wrong admin key => 401', `got ${r2.status}`);
}

// ═══════════════════════════════════════════════════════
// SECTION 16: MCP endpoint
// ═══════════════════════════════════════════════════════

async function testMcpInitialize() {
  console.log('\n=== MCP: initialize ===');
  const r = await api('POST', '/mcp', {
    body: { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'e2e-test', version: '1.0' } } },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}`);
  assert(r.json?.result?.protocolVersion, 'protocolVersion in result');
  assert(r.json?.result?.serverInfo?.name, 'serverInfo.name present');
}

async function testMcpToolsList() {
  console.log('\n=== MCP: tools/list ===');
  const r = await api('POST', '/mcp', {
    body: { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  });
  assert(r.status === 200, 'status 200');
  const tools = r.json?.result?.tools ?? [];
  assert(Array.isArray(tools), 'tools array returned');
  const toolNames = tools.map(t => t.name);
  assert(toolNames.includes('fabric_bootstrap'), 'fabric_bootstrap tool present');
  assert(toolNames.includes('fabric_get_meta'), 'fabric_get_meta tool present');
  assert(toolNames.includes('fabric_search_listings'), 'fabric_search_listings tool present');
  assert(toolNames.includes('fabric_create_unit'), 'fabric_create_unit tool present');
  assert(toolNames.includes('fabric_create_offer'), 'fabric_create_offer tool present');
  assert(toolNames.includes('fabric_get_profile'), 'fabric_get_profile tool present');
  assert(toolNames.includes('fabric_accept_offer'), 'fabric_accept_offer tool present');
  assert(toolNames.includes('fabric_reveal_contact'), 'fabric_reveal_contact tool present');
  console.log(`  (${toolNames.length} MCP tools available)`);
  return toolNames;
}

async function testMcpToolCallBootstrap() {
  console.log('\n=== MCP: tools/call fabric_bootstrap ===');
  const mcpName = `MCP-Agent-${RUN_ID}-${Math.random().toString(36).slice(2, 6)}`;
  const r = await api('POST', '/mcp', {
    body: { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'fabric_bootstrap', arguments: { display_name: mcpName } } },
  });
  assert(r.status === 200, 'status 200', `got ${r.status}`);
  const content = r.json?.result?.content;
  assert(Array.isArray(content), 'content array returned');
  let parsed;
  try { parsed = JSON.parse(content?.[0]?.text); } catch { parsed = null; }
  assert(parsed?.api_key || parsed?.node, 'bootstrap result contains api_key or node', `got: ${content?.[0]?.text?.substring(0, 200)}`);
  return parsed;
}

async function testMcpToolCallMeta() {
  console.log('\n=== MCP: tools/call fabric_get_meta ===');
  const r = await api('POST', '/mcp', {
    body: { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'fabric_get_meta', arguments: {} } },
  });
  assert(r.status === 200, 'status 200');
  const content = r.json?.result?.content;
  let parsed;
  try { parsed = JSON.parse(content?.[0]?.text); } catch { parsed = null; }
  assert(parsed?.api_version === 'v1', 'meta returns api_version v1');
}

async function testMcpToolCallWithAuth(apiKey) {
  console.log('\n=== MCP: tools/call fabric_get_profile (authenticated) ===');
  const r = await api('POST', '/mcp', {
    body: { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'fabric_get_profile', arguments: {} } },
    headers: { 'Authorization': `ApiKey ${apiKey}` },
  });
  assert(r.status === 200, 'status 200');
  const content = r.json?.result?.content;
  let parsed;
  try { parsed = JSON.parse(content?.[0]?.text); } catch { parsed = null; }
  assert(parsed?.node || parsed?.credits_balance !== undefined, 'authenticated profile data returned', `got: ${content?.[0]?.text?.substring(0, 200)}`);
}

async function testMcpPromptsList() {
  console.log('\n=== MCP: prompts/list ===');
  const r = await api('POST', '/mcp', {
    body: { jsonrpc: '2.0', id: 6, method: 'prompts/list', params: {} },
  });
  assert(r.status === 200, 'status 200');
}

async function testMcpResourcesList() {
  console.log('\n=== MCP: resources/list ===');
  const r = await api('POST', '/mcp', {
    body: { jsonrpc: '2.0', id: 7, method: 'resources/list', params: {} },
  });
  assert(r.status === 200, 'status 200');
}

// ═══════════════════════════════════════════════════════
// SECTION 17: Trust & safety
// ═══════════════════════════════════════════════════════

async function testContactInfoRejection(apiKey) {
  console.log('\n=== Contact info rejection in content fields ===');
  const r1 = await api('POST', '/v1/units', {
    body: { title: 'Call me at 555-123-4567 for details' },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r1.status === 422, 'phone in title => 422', `got ${r1.status}`);

  const r2 = await api('POST', '/v1/units', {
    body: { title: 'Great item', description: 'Email me at user@example.com' },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r2.status === 422, 'email in description => 422', `got ${r2.status}`);

  const r3 = await api('POST', '/v1/units', {
    body: { title: 'Clean item', description: 'telegram: @myhandle for quick chat' },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r3.status === 422, 'messaging handle in description => 422', `got ${r3.status}`);
}

async function testRequestTtlValidation(apiKey) {
  console.log('\n=== Request TTL validation ===');
  const r1 = await api('POST', '/v1/requests', {
    body: { title: 'Short TTL', ttl_minutes: 10 },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r1.status === 422 || r1.status === 400, 'ttl_minutes < 60 rejected', `got ${r1.status}`);

  const r2 = await api('POST', '/v1/requests', {
    body: { title: 'Long TTL', ttl_minutes: 999999 },
    headers: { 'Authorization': `ApiKey ${apiKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(r2.status === 422 || r2.status === 400, 'ttl_minutes > 525600 rejected', `got ${r2.status}`);
}

// ═══════════════════════════════════════════════════════
// SECTION 18: 404s
// ═══════════════════════════════════════════════════════

async function testNotFound(apiKey) {
  console.log('\n=== 404 responses ===');
  const fakeId = '00000000-0000-0000-0000-000000000001';
  const r1 = await api('GET', `/v1/units/${fakeId}`, { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r1.status === 404, 'GET nonexistent unit => 404', `got ${r1.status}`);

  const r2 = await api('GET', `/v1/requests/${fakeId}`, { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r2.status === 404, 'GET nonexistent request => 404', `got ${r2.status}`);

  const r3 = await api('GET', `/v1/offers/${fakeId}`, { headers: { 'Authorization': `ApiKey ${apiKey}` } });
  assert(r3.status === 404, 'GET nonexistent offer => 404', `got ${r3.status}`);
}

// ═══════════════════════════════════════════════════════
// SECTION 19: Idempotency-Key requirement
// ═══════════════════════════════════════════════════════

async function testIdempotencyKeyRequired(apiKey) {
  console.log('\n=== Idempotency-Key required on non-GET ===');
  const r = await api('POST', '/v1/units', {
    body: { title: 'No idem key' },
    headers: { 'Authorization': `ApiKey ${apiKey}` },
  });
  assert(r.status === 422 || r.status === 400, 'POST without Idempotency-Key rejected', `got ${r.status}: ${JSON.stringify(r.json)}`);
}

// ═══════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════

async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║    FABRIC API — Full E2E Test Suite              ║');
  console.log('║    Testing as a real new user/agent              ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log(`Target: ${BASE}\n`);

  // 0. Public metadata
  const meta = await testMeta();
  await testCategories();
  await testOpenAPI();
  await testRegions();
  await testHealthz();
  await testLegalPages();

  // 1. Bootstrap two nodes
  await testBootstrapValidation();
  await testAuth401();
  const seller = await testBootstrap();
  const buyer = await testBootstrapBuyer();
  const sellerKey = seller.apiKey;
  const sellerNodeId = seller.nodeId;
  const buyerKey = buyer.apiKey;
  const buyerNodeId = buyer.nodeId;

  if (!sellerKey || !buyerKey) {
    console.log('\nFATAL: Bootstrap failed — cannot continue.');
    process.exit(1);
  }

  // 2. Profile
  const meResult = await testMe(sellerKey);
  const sellerVersion = meResult?.node?.version ?? 1;
  const mePatchResult = await testMePatch(sellerKey, sellerVersion);
  await testApiKeyManagement(sellerKey);

  // 3. Credits
  await testCreditsBalance(sellerKey);
  await testCreditsLedger(sellerKey);
  await testCreditsQuoteGet(sellerKey);
  await testCreditsQuotePost(sellerKey);

  // 4. Unit CRUD
  const unit1 = await testUnitCreate(sellerKey);
  const unit2 = await testUnitCreateSecond(sellerKey);
  const units = await testUnitList(sellerKey);
  const unitDetail = await testUnitGet(sellerKey, unit1?.id);
  const unitVersion = unitDetail?.row_version ?? unitDetail?.version ?? 1;
  await testUnitPatch(sellerKey, unit1?.id, unitVersion);

  // 5. Request CRUD
  const request1 = await testRequestCreate(buyerKey);
  await testRequestList(buyerKey);
  const reqDetail = await testRequestGet(buyerKey, request1?.id);
  const reqVersion = reqDetail?.row_version ?? reqDetail?.version ?? 1;
  await testRequestPatch(buyerKey, request1?.id, reqVersion);

  // 6. Publish/unpublish
  await testPublishUnit(sellerKey, unit1?.id);
  await testPublishUnit(sellerKey, unit2?.id);
  await testPublishRequest(buyerKey, request1?.id);

  // 7. Admin projection rebuild (so search can find published items)
  await testAdminProjectionRebuild();

  // 8. Search
  await testSearchListings(buyerKey);
  await testSearchRequests(sellerKey);
  await testSearchWithAllScopes(buyerKey);

  // 9. Node inventory expansion
  await testNodeInventory(buyerKey, sellerNodeId);

  // 10. Offers — unit-targeted: buyer offers on seller's unit
  const offer1 = await testOfferCreate(buyerKey, [unit1?.id], 'for accept flow');
  await testOfferList(buyerKey, 'made');
  await testOfferList(sellerKey, 'received');
  await testOfferGet(sellerKey, offer1?.id);

  // Offer1 was auto-accepted by sender (accepted_by_a). Seller accepts => mutually_accepted
  const accepted1 = await testOfferAccept(sellerKey, offer1?.id, 'seller accepts');

  // 11. Contact reveal (after mutual acceptance)
  await testRevealContact(sellerKey, offer1?.id, 'seller reveals buyer contact');
  await testRevealContact(buyerKey, offer1?.id, 'buyer reveals seller contact');

  // 12. Offers — request-targeted flow + counter
  // Seller creates offer on buyer's request (seller's 1st offer create)
  const offer2 = await testOfferCreateRequestTargeted(sellerKey, request1?.id);
  if (offer2?.requires_counter) {
    const counterOffer = await testOfferCounter(buyerKey, offer2?.id, null);
    if (counterOffer) {
      // Note: seller accept may hit prepurchase daily limit (1 accept/day already used above)
      console.log('\n=== POST /v1/offers/:id/accept (seller accepts counter — may hit pre-purchase limit) ===');
      const rAccept = await api('POST', `/v1/offers/${counterOffer?.id}/accept`, {
        headers: { 'Authorization': `ApiKey ${sellerKey}`, 'Idempotency-Key': idemKey() },
      });
      assert(rAccept.status === 200 || rAccept.status === 429, 'accept or pre-purchase limit', `got ${rAccept.status}`);
      if (rAccept.status === 429) console.log('  (expected: pre-purchase daily accept limit reached)');
    }
  } else if (offer2) {
    console.log('\n=== POST /v1/offers/:id/accept (buyer accepts request-targeted — may hit pre-purchase limit) ===');
    const rAccept = await api('POST', `/v1/offers/${offer2?.id}/accept`, {
      headers: { 'Authorization': `ApiKey ${buyerKey}`, 'Idempotency-Key': idemKey() },
    });
    assert(rAccept.status === 200 || rAccept.status === 429, 'accept or pre-purchase limit', `got ${rAccept.status}`);
  }

  // 13. Offer cancel — buyer creates offer #2 on unit2, then cancels
  const offer3 = await testOfferCreate(buyerKey, [unit2?.id], 'for cancel flow');
  if (offer3) await testOfferCancel(buyerKey, offer3?.id);

  // 14. Offer reject — buyer creates offer #3 on unit1 (may hit 3/day limit), seller rejects
  console.log('\n=== POST /v1/offers (create — for reject, may hit pre-purchase limit) ===');
  const rOffer4 = await api('POST', '/v1/offers', {
    body: { unit_ids: [unit1?.id], note: 'Offer for reject test', ttl_minutes: 1440 },
    headers: { 'Authorization': `ApiKey ${buyerKey}`, 'Idempotency-Key': idemKey() },
  });
  assert(rOffer4.status === 200 || rOffer4.status === 429, 'offer create or pre-purchase limit', `got ${rOffer4.status}`);
  if (rOffer4.status === 200) {
    const offer4 = rOffer4.json?.offer ?? rOffer4.json;
    await testOfferReject(sellerKey, offer4?.id);
  } else {
    console.log('  (expected: pre-purchase daily offer create limit reached — skipping reject test)');
  }

  // 15. Unpublish/re-publish cycle
  await testUnpublishUnit(sellerKey, unit1?.id);
  await testUnpublishRequest(buyerKey, request1?.id);
  await testPublishUnit(sellerKey, unit1?.id);

  // 16. Events
  await testEvents(sellerKey, 'seller');
  await testEvents(buyerKey, 'buyer');

  // 17. Referrals
  const refCode = await testReferralCode(sellerKey);
  await testReferralStats(sellerKey);
  if (refCode) await testReferralClaim(buyerKey, refCode);

  // 18. Billing
  await testBillingCheckout(sellerKey);
  await testCreditPackCheckout(sellerKey);
  await testCryptoCurrencies(sellerKey);

  // 19. Idempotency
  await testIdempotency(sellerKey);

  // 20. Optimistic concurrency
  const freshUnit = await testUnitGet(sellerKey, unit1?.id);
  const freshVersion = freshUnit?.row_version ?? freshUnit?.version ?? 1;
  await testOptimisticConcurrency(sellerKey, unit1?.id, freshVersion);

  // 21. Idempotency-Key required
  await testIdempotencyKeyRequired(sellerKey);

  // 22. Contact info rejection
  await testContactInfoRejection(sellerKey);

  // 23. TTL validation
  await testRequestTtlValidation(sellerKey);

  // 24. 404s
  await testNotFound(sellerKey);

  // 25. Admin
  await testAdminTakedown();
  await testAdminCreditsAdjust(sellerNodeId);
  await testAdminDailyMetrics();
  await testAdminAuth401();

  // 26. Soft delete
  const deleteUnit = await testUnitCreate(sellerKey, { title: 'To-Delete Unit' });
  if (deleteUnit) await testUnitDelete(sellerKey, deleteUnit?.id);

  // 27. MCP
  await testMcpInitialize();
  await testMcpToolsList();
  await testMcpToolCallBootstrap();
  await testMcpToolCallMeta();
  await testMcpToolCallWithAuth(sellerKey);
  await testMcpPromptsList();
  await testMcpResourcesList();

  // ───── Summary ─────
  console.log('\n╔══════════════════════════════════════════════════╗');
  console.log(`║    RESULTS:  ${String(pass).padStart(3)} PASSED  /  ${String(fail).padStart(3)} FAILED              `);
  console.log('╚══════════════════════════════════════════════════╝');
  if (failures.length > 0) {
    console.log('\nFailed tests:');
    for (const f of failures) console.log(f);
  } else {
    console.log('\nAll tests passed!');
  }
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error('FATAL:', err); process.exit(2); });
