#!/usr/bin/env node
/**
 * Test 402 credits-exhausted and 429 pre-purchase limit behavior.
 * Validates error envelope, purchase guidance, and agent UX.
 *
 * Env: SMOKE_API_KEY_A (required), BASE_URL (optional)
 */

const BASE_URL = (process.env.BASE_URL || 'https://fabric-api-2x2ettafia-uw.a.run.app').replace(/\/+$/, '');
const apiKey = process.env.SMOKE_API_KEY_A;
if (!apiKey) { console.error('Set SMOKE_API_KEY_A'); process.exit(1); }

async function api(method, path, body) {
  const headers = { authorization: `ApiKey ${apiKey}` };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['idempotency-key'] = crypto.randomUUID();
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, json, headers: Object.fromEntries(res.headers.entries()) };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const checks = [];
  function record(name, passed, detail) {
    checks.push({ name, pass: passed, detail });
    console.log(`  ${passed ? 'PASS' : 'FAIL'}: ${name}${detail ? ` (${detail})` : ''}`);
  }

  const me = await api('GET', '/v1/me');
  const credits = me.json?.credits_balance ?? 0;
  console.log(`Credits balance: ${credits}`);

  const searchBody = {
    q: null,
    scope: 'remote_online_service',
    filters: { regions: ['US'] },
    budget: { credits_requested: 100 },
    limit: 20,
    cursor: null,
  };

  // --- Test 1: budget_cap_exceeded (request budget lower than cost) ---
  console.log('\n=== Test 1: budget_cap_exceeded (budget < cost) ===');
  const capped = await api('POST', '/v1/search/listings', {
    ...searchBody,
    budget: { credits_requested: 1 },
  });
  console.log(`  Status: ${capped.status}, code: ${capped.json?.error?.code}`);
  record('Budget cap too low returns 402', capped.status === 402);
  record('Error code is budget_cap_exceeded', capped.json?.error?.code === 'budget_cap_exceeded');
  if (capped.status === 402) {
    const details = capped.json?.error?.details ?? {};
    record('Has needed/max breakdown', details.needed != null && details.max != null,
      `needed=${details.needed} max=${details.max}`);
    const hasPG = details.purchase_guidance != null;
    record('Has purchase_guidance', hasPG);
    if (hasPG) {
      const pg = details.purchase_guidance;
      record('purchase_guidance.stripe present', !!pg.stripe);
      record('purchase_guidance.stripe.credit_packs is array', Array.isArray(pg.stripe?.credit_packs));
      if (pg.crypto) record('purchase_guidance.crypto present', true);
    }
    console.log(`  Full 402 response:\n${JSON.stringify(capped.json, null, 2)}`);
  }

  // --- Test 2: Drain searches to hit pre-purchase daily limit ---
  console.log('\n=== Test 2: Pre-purchase daily search limit (3/day) ===');
  let searchCount = 0;
  let hitPrePurchaseLimit = false;
  let prePurchaseResponse = null;

  for (let i = 0; i < 5; i++) {
    const r = await api('POST', '/v1/search/listings', searchBody);
    searchCount++;
    if (r.status === 200) {
      console.log(`  Search ${searchCount}: 200 OK, charged=${r.json?.budget?.credits_charged ?? '?'}`);
    } else if (r.status === 429 && r.json?.error?.code === 'prepurchase_daily_limit_exceeded') {
      hitPrePurchaseLimit = true;
      prePurchaseResponse = r;
      console.log(`  Search ${searchCount}: 429 prepurchase_daily_limit_exceeded`);
      break;
    } else if (r.status === 429) {
      console.log(`  Search ${searchCount}: 429 rate_limit (${r.json?.error?.code}), waiting...`);
      await sleep(5000);
      i--;
      continue;
    } else if (r.status === 402) {
      console.log(`  Search ${searchCount}: 402 credits exhausted`);
      break;
    } else {
      console.log(`  Search ${searchCount}: ${r.status} ${r.json?.error?.code}`);
      break;
    }
    await sleep(500);
  }

  if (hitPrePurchaseLimit && prePurchaseResponse) {
    record('Pre-purchase limit returns 429', true);
    record('Error code is prepurchase_daily_limit_exceeded', prePurchaseResponse.json?.error?.code === 'prepurchase_daily_limit_exceeded');
    const details = prePurchaseResponse.json?.error?.details ?? {};
    const hasPurchaseInfo = details.purchase_options != null || details.purchase_guidance != null;
    record('429 includes purchase options/guidance', hasPurchaseInfo);
    if (details.purchase_options) {
      const po = details.purchase_options;
      record('purchase_options.stripe present', !!po.stripe);
      const hasStripeCredits = po.stripe?.credit_packs?.available_packs?.length > 0;
      record('purchase_options.stripe has credit packs', hasStripeCredits);
      const hasStripeSubs = po.stripe?.subscriptions?.available_plans?.length > 0;
      record('purchase_options.stripe has subscriptions', hasStripeSubs);
      if (po.crypto) {
        record('purchase_options.crypto present', !!po.crypto);
        record('purchase_options.crypto has available packs', po.crypto?.available_packs?.length > 0);
      }
    }
    record('429 details include limit/used/window', details.limit != null && details.used != null && details.window != null,
      `limit=${details.limit} used=${details.used} window=${details.window}`);
    record('429 details include how_to_remove_limit', typeof details.how_to_remove_limit === 'string');
  } else {
    record('Pre-purchase limit test (needs fresh-day node)', false, 'may have already used daily searches');
  }

  // --- Test 3: Verify credits remaining header on metered response ---
  console.log('\n=== Test 3: Credits headers on responses ===');
  const meAfter = await api('GET', '/v1/me');
  const creditsAfter = meAfter.json?.credits_balance ?? 0;
  console.log(`  Credits after tests: ${creditsAfter}`);
  record('Credits decreased after searches', creditsAfter < credits, `before=${credits} after=${creditsAfter}`);

  // Summary
  console.log('\n' + '='.repeat(60));
  const passed = checks.filter(c => c.pass).length;
  console.log(`SUMMARY: ${passed}/${checks.length} checks passed`);
  if (checks.some(c => !c.pass)) {
    console.log('FAILURES:');
    for (const c of checks.filter(c => !c.pass)) {
      console.log(`  - ${c.name}${c.detail ? `: ${c.detail}` : ''}`);
    }
  }
  console.log('='.repeat(60));
  process.exitCode = checks.every(c => c.pass) ? 0 : 1;
}

main().catch(err => { console.error(`ERROR: ${err.message}`); process.exitCode = 1; });
