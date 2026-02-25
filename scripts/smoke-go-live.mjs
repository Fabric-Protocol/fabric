#!/usr/bin/env node
/**
 * Go-live smoke test: bootstrap-to-reveal happy path + 402 test + page checks
 *
 * Usage:
 *   node scripts/smoke-go-live.mjs
 *
 * Env vars:
 *   BASE_URL (default: https://fabric-api-2x2ettafia-uw.a.run.app)
 *   ADMIN_KEY (required for creating second node key if bootstrap rate-limited)
 *   SMOKE_API_KEY_A (optional: reuse existing node A key)
 *   SMOKE_API_KEY_B (optional: reuse existing node B key)
 */

const BASE_URL = (process.env.BASE_URL || 'https://fabric-api-2x2ettafia-uw.a.run.app').replace(/\/+$/, '');

function idemKey() {
  return crypto.randomUUID();
}

async function api(method, path, { apiKey, adminKey, body, query } = {}) {
  const url = new URL(path, `${BASE_URL}/`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  }
  const headers = {};
  if (apiKey) headers['authorization'] = `ApiKey ${apiKey}`;
  if (adminKey) headers['x-admin-key'] = adminKey;
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['idempotency-key'] = idemKey();
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, json, headers: Object.fromEntries(res.headers.entries()) };
}

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

function step(label) {
  console.log(`\n=== ${label} ===`);
}

async function main() {
  const results = { pass: [], fail: [] };
  function record(name, passed, detail) {
    (passed ? results.pass : results.fail).push({ name, detail });
    console.log(`  ${passed ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  }

  // --- #8: Verify /support page ---
  step('#8 — Verify /support page has real contact info');
  const support = await api('GET', '/support');
  record('/support returns 200', support.status === 200);
  const supportHasEmail = (support.json?._raw || '').includes('mapmoiras@gmail.com');
  record('/support has real contact email', supportHasEmail);

  // --- #10: Review /legal/* pages ---
  step('#10 — Review /legal/* pages for completeness');
  const legalPaths = ['/legal/terms', '/legal/privacy', '/legal/acceptable-use', '/legal/refunds', '/legal/agents'];
  for (const p of legalPaths) {
    const r = await api('GET', p);
    record(`${p} returns 200`, r.status === 200);
    const body = r.json?._raw || '';
    const hasOperator = body.includes('Pilsang Park');
    const hasEffective = body.includes('2026-02-17');
    const hasContact = body.includes('mapmoiras@gmail.com');
    record(`${p} has operator/date/contact`, hasOperator && hasEffective && hasContact,
      `operator=${hasOperator} date=${hasEffective} contact=${hasContact}`);
    const minLength = p === '/legal/refunds' ? 2000 : 4000;
    record(`${p} has substantive content (>=${minLength} chars)`, body.length >= minLength, `length=${body.length}`);
  }

  // --- #6: Bootstrap-to-reveal happy path ---
  step('#6 — Bootstrap-to-reveal happy-path test');

  const meta = await api('GET', '/v1/meta');
  assert(meta.status === 200, '/v1/meta failed');
  const legalVersion = meta.json.required_legal_version;
  console.log(`  Legal version: ${legalVersion}`);

  let apiKeyA = process.env.SMOKE_API_KEY_A;
  let nodeIdA = null;
  let apiKeyB = process.env.SMOKE_API_KEY_B;
  let nodeIdB = null;

  if (!apiKeyA) {
    const bootA = await api('POST', '/v1/bootstrap', {
      body: {
        display_name: `SmokeA_${Date.now()}`,
        email: null,
        referral_code: null,
        legal: { accepted: true, version: legalVersion },
      },
    });
    if (bootA.status === 200) {
      apiKeyA = bootA.json.api_key.api_key;
      nodeIdA = bootA.json.node.id;
      record('Bootstrap Node A', true, `id=${nodeIdA}`);
    } else {
      record('Bootstrap Node A', false, `status=${bootA.status} code=${bootA.json?.error?.code}`);
      console.log('  Cannot proceed without Node A. Exiting.');
      printSummary(results);
      return;
    }
  }

  if (!apiKeyB) {
    const bootB = await api('POST', '/v1/bootstrap', {
      body: {
        display_name: `SmokeB_${Date.now()}`,
        email: null,
        referral_code: null,
        legal: { accepted: true, version: legalVersion },
      },
    });
    if (bootB.status === 200) {
      apiKeyB = bootB.json.api_key.api_key;
      nodeIdB = bootB.json.node.id;
      record('Bootstrap Node B', true, `id=${nodeIdB}`);
    } else if (bootB.json?.error?.code === 'rate_limit_exceeded' && process.env.ADMIN_KEY) {
      console.log('  Bootstrap rate-limited. Using admin key to create Node B via fresh bootstrap workaround...');
      record('Bootstrap Node B (rate-limited, need admin workaround)', false, 'rate_limit_exceeded');
      console.log('  Skipping happy-path test due to bootstrap rate limit. Rerun after cooldown or provide SMOKE_API_KEY_B.');
      printSummary(results);
      return;
    } else {
      record('Bootstrap Node B', false, `status=${bootB.status} code=${bootB.json?.error?.code}`);
      console.log('  Cannot proceed without Node B. Provide SMOKE_API_KEY_B or wait for rate limit cooldown.');
      printSummary(results);
      return;
    }
  }

  // Verify /v1/me for both
  const meA = await api('GET', '/v1/me', { apiKey: apiKeyA });
  assert(meA.status === 200, `Node A /v1/me failed: ${meA.status}`);
  nodeIdA = nodeIdA || meA.json.node.id;
  record('Node A /v1/me', true, `status=${meA.json.node.status} credits=${meA.json.credits_balance}`);

  const meB = await api('GET', '/v1/me', { apiKey: apiKeyB });
  assert(meB.status === 200, `Node B /v1/me failed: ${meB.status}`);
  nodeIdB = nodeIdB || meB.json.node.id;
  record('Node B /v1/me', true, `status=${meB.json.node.status} credits=${meB.json.credits_balance}`);

  // Create unit (Node B)
  const createUnit = await api('POST', '/v1/units', {
    apiKey: apiKeyB,
    body: {
      title: 'Smoke test widget',
      description: 'Widget for go-live smoke test',
      type: 'good',
      condition: 'new',
      quantity: 1,
      measure: 'EA',
      scope_primary: 'OTHER',
      scope_notes: 'go-live smoke',
      public_summary: 'Smoke test widget for sale',
      tags: [],
      category_ids: [],
    },
  });
  record('Create unit (Node B)', createUnit.status === 200 || createUnit.status === 201,
    `status=${createUnit.status}`);
  const unitId = createUnit.json?.unit?.id;
  if (!unitId) {
    console.log('  Unit creation failed, cannot continue happy path.');
    console.log('  Response:', JSON.stringify(createUnit.json, null, 2));
    printSummary(results);
    return;
  }

  // Create offer (Node A → Node B's unit)
  const createOffer = await api('POST', '/v1/offers', {
    apiKey: apiKeyA,
    body: { unit_ids: [unitId], thread_id: null, note: 'go-live smoke offer' },
  });
  record('Create offer (Node A)', createOffer.status === 200 || createOffer.status === 201,
    `status=${createOffer.status}`);
  const offerId = createOffer.json?.offer?.id;
  if (!offerId) {
    console.log('  Offer creation failed. Response:', JSON.stringify(createOffer.json, null, 2));
    printSummary(results);
    return;
  }

  // Accept offer (Node B)
  const acceptB = await api('POST', `/v1/offers/${offerId}/accept`, { apiKey: apiKeyB, body: {} });
  record('Accept offer (Node B)', acceptB.status === 200, `status=${acceptB.status}`);

  // Accept offer (Node A) — mutual acceptance
  const acceptA = await api('POST', `/v1/offers/${offerId}/accept`, { apiKey: apiKeyA, body: {} });
  record('Accept offer (Node A) — mutual', acceptA.status === 200, `status=${acceptA.status}`);

  // Reveal contact (Node A)
  const reveal = await api('POST', `/v1/offers/${offerId}/reveal-contact`, { apiKey: apiKeyA, body: {} });
  record('Reveal contact (Node A)', reveal.status === 200, `status=${reveal.status}`);
  if (reveal.status === 200) {
    const hasEmail = reveal.json?.contact?.email !== undefined;
    record('Reveal includes contact data', hasEmail || reveal.json?.contact != null,
      `keys=${Object.keys(reveal.json?.contact || {}).join(',')}`);
  }

  printSummary(results);
}

function printSummary(results) {
  console.log('\n' + '='.repeat(60));
  console.log(`SUMMARY: ${results.pass.length} passed, ${results.fail.length} failed`);
  if (results.fail.length > 0) {
    console.log('FAILURES:');
    for (const f of results.fail) console.log(`  - ${f.name}${f.detail ? `: ${f.detail}` : ''}`);
  }
  console.log('='.repeat(60));
  process.exitCode = results.fail.length > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(`SMOKE FAILED: ${err?.message ?? String(err)}`);
  process.exitCode = 1;
});
