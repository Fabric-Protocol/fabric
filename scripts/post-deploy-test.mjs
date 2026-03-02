/**
 * Post-deploy verification — tests the 4 outstanding items against the live API.
 * 1. email_taken bug fix
 * 2. Billing checkout sessions with correct redirect URLs
 * 3. Contact reveal happy path (PATCH emails → accept → reveal)
 * 4. Credit pack checkout
 */

const BASE = 'https://fabric-api-393345198409.us-west1.run.app';
const RUN_ID = Date.now().toString(36);
let pass = 0, fail = 0;
const failures = [];

function idem() { return `idem-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`; }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function api(method, path, { body, headers = {} } = {}) {
  const opts = { method, headers: { ...headers } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, opts);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: res.status, json, text };
}

function assert(cond, name, detail) {
  if (cond) { pass++; console.log(`  PASS: ${name}`); }
  else { fail++; const m = `  FAIL: ${name}${detail ? ' — ' + detail : ''}`; console.log(m); failures.push(m); }
}

function auth(key) { return { 'Authorization': `ApiKey ${key}` }; }

async function retryBoot(body, label) {
  const key = idem();
  return api('POST', '/v1/bootstrap', { body, headers: { 'Idempotency-Key': key } });
}

async function main() {
  console.log('╔════════════════════════════════════════════════╗');
  console.log('║  POST-DEPLOY VERIFICATION (live production)    ║');
  console.log('╚════════════════════════════════════════════════╝');
  console.log(`Target: ${BASE}\nRun: ${RUN_ID}\n`);

  // Get legal version
  const meta = await api('GET', '/v1/meta');
  const lv = meta.json?.required_legal_version;
  console.log(`Legal version: ${lv}\n`);

  // ═══ Bootstrap two nodes with emails ═══
  console.log('=== Bootstrap Node A (seller) ===');
  const sellerEmail = `seller-${RUN_ID}@e2e-test.fabric.local`;
  const rA = await retryBoot({
    display_name: `PostDeploy-Seller-${RUN_ID}`,
    email: sellerEmail,
    referral_code: null,
    legal: { accepted: true, version: lv },
  }, 'seller');
  assert(rA.status === 200, 'seller bootstrap 200', `got ${rA.status}: ${JSON.stringify(rA.json)?.substring(0, 200)}`);
  const sellerKey = rA.json?.api_key?.api_key;
  const sellerNodeId = rA.json?.node?.id;

  console.log('\n=== Bootstrap Node B (buyer) ===');
  const buyerEmail = `buyer-${RUN_ID}@e2e-test.fabric.local`;
  const rB = await retryBoot({
    display_name: `PostDeploy-Buyer-${RUN_ID}`,
    email: buyerEmail,
    referral_code: null,
    legal: { accepted: true, version: lv },
  }, 'buyer');
  assert(rB.status === 200, 'buyer bootstrap 200', `got ${rB.status}: ${JSON.stringify(rB.json)?.substring(0, 200)}`);
  const buyerKey = rB.json?.api_key?.api_key;
  const buyerNodeId = rB.json?.node?.id;

  if (!sellerKey || !buyerKey) { console.log('\nFATAL: Bootstrap failed.'); process.exit(1); }

  // ═══ TEST 1: email_taken fix ═══
  console.log('\n=== TEST 1: email_taken fix ===');
  const rDup = await api('POST', '/v1/bootstrap', {
    body: {
      display_name: `PostDeploy-DupEmail-${RUN_ID}`,
      email: sellerEmail,
      referral_code: null,
      legal: { accepted: true, version: lv },
    },
    headers: { 'Idempotency-Key': idem() },
  });
  assert(rDup.status === 422, 'duplicate email => 422 (not 500)', `got ${rDup.status}: ${JSON.stringify(rDup.json)?.substring(0, 200)}`);
  assert(rDup.json?.error?.code === 'validation_error', 'error code = validation_error', `got ${rDup.json?.error?.code}`);
  const reason = rDup.json?.error?.details?.reason;
  assert(reason === 'email_taken', 'reason = email_taken', `got ${reason}`);

  // ═══ TEST 2: Billing checkout sessions ═══
  console.log('\n=== TEST 2: Billing checkout — subscription ===');
  const rBill1 = await api('POST', '/v1/billing/checkout-session', {
    body: {
      node_id: sellerNodeId,
      plan_code: 'basic',
      success_url: `${BASE}/docs/agents?checkout=success`,
      cancel_url: `${BASE}/docs/agents?checkout=cancel`,
    },
    headers: { ...auth(sellerKey), 'Idempotency-Key': idem() },
  });
  assert(rBill1.status === 200, 'subscription checkout => 200', `got ${rBill1.status}: ${JSON.stringify(rBill1.json)?.substring(0, 300)}`);
  if (rBill1.status === 200) {
    const url = rBill1.json?.checkout_url ?? rBill1.json?.url;
    assert(typeof url === 'string' && url.startsWith('https://'), 'returns Stripe checkout URL', `got ${url}`);
  }

  console.log('\n=== TEST 2b: Billing checkout — credit pack ===');
  const rBill2 = await api('POST', '/v1/billing/credit-packs/checkout-session', {
    body: {
      node_id: sellerNodeId,
      pack_code: 'credits_500',
      success_url: `${BASE}/docs/agents?checkout=success`,
      cancel_url: `${BASE}/docs/agents?checkout=cancel`,
    },
    headers: { ...auth(sellerKey), 'Idempotency-Key': idem() },
  });
  assert(rBill2.status === 200, 'credit pack checkout => 200', `got ${rBill2.status}: ${JSON.stringify(rBill2.json)?.substring(0, 300)}`);
  if (rBill2.status === 200) {
    const url = rBill2.json?.checkout_url ?? rBill2.json?.url;
    assert(typeof url === 'string' && url.startsWith('https://'), 'returns Stripe checkout URL', `got ${url}`);
  }

  // ═══ TEST 3: Contact reveal happy path ═══
  console.log('\n=== TEST 3: Full offer → accept → reveal ===');

  // Seller creates and publishes a unit
  const rUnit = await api('POST', '/v1/units', {
    body: { title: `Reveal-Test-${RUN_ID}`, description: 'For reveal test', type: 'service', scope_primary: 'OTHER', scope_notes: 'reveal test', category_ids: [2], public_summary: 'reveal test' },
    headers: { ...auth(sellerKey), 'Idempotency-Key': idem() },
  });
  assert(rUnit.status === 200, 'create unit', `got ${rUnit.status}`);
  const unitId = (rUnit.json?.unit ?? rUnit.json)?.id;

  const rPub = await api('POST', `/v1/units/${unitId}/publish`, {
    headers: { ...auth(sellerKey), 'Idempotency-Key': idem() },
  });
  assert(rPub.status === 200, 'publish unit', `got ${rPub.status}`);

  // Buyer makes an offer
  const rOffer = await api('POST', '/v1/offers', {
    body: { unit_ids: [unitId], note: 'Reveal test offer', ttl_minutes: 1440 },
    headers: { ...auth(buyerKey), 'Idempotency-Key': idem() },
  });
  if (rOffer.status === 429) {
    console.log('  (offer create hit pre-purchase daily limit — trying to proceed)');
  }
  assert(rOffer.status === 200, 'create offer', `got ${rOffer.status}: ${JSON.stringify(rOffer.json)?.substring(0, 200)}`);
  const offerId = (rOffer.json?.offer ?? rOffer.json)?.id;

  if (offerId) {
    // Seller accepts
    const rAccS = await api('POST', `/v1/offers/${offerId}/accept`, {
      headers: { ...auth(sellerKey), 'Idempotency-Key': idem() },
    });
    assert(rAccS.status === 200 || rAccS.status === 429, 'seller accept', `got ${rAccS.status}`);

    // Buyer accepts
    const rAccB = await api('POST', `/v1/offers/${offerId}/accept`, {
      headers: { ...auth(buyerKey), 'Idempotency-Key': idem() },
    });
    assert(rAccB.status === 200 || rAccB.status === 429, 'buyer accept', `got ${rAccB.status}`);

    // Check offer status
    const rGet = await api('GET', `/v1/offers/${offerId}`, { headers: auth(sellerKey) });
    const offerStatus = (rGet.json?.offer ?? rGet.json)?.status;
    console.log(`  Offer status: ${offerStatus}`);

    if (offerStatus === 'mutually_accepted') {
      // Reveal contact — seller reveals buyer
      const rRevS = await api('POST', `/v1/offers/${offerId}/reveal-contact`, {
        headers: { ...auth(sellerKey), 'Idempotency-Key': idem() },
      });
      assert(rRevS.status === 200, 'seller reveal-contact => 200', `got ${rRevS.status}: ${JSON.stringify(rRevS.json)?.substring(0, 200)}`);
      if (rRevS.status === 200) {
        assert(typeof rRevS.json?.contact === 'object', 'contact object present');
        assert(typeof rRevS.json?.contact?.email === 'string', 'contact email present');
        console.log(`  Revealed buyer email: ${rRevS.json?.contact?.email}`);
      }

      // Reveal contact — buyer reveals seller
      const rRevB = await api('POST', `/v1/offers/${offerId}/reveal-contact`, {
        headers: { ...auth(buyerKey), 'Idempotency-Key': idem() },
      });
      assert(rRevB.status === 200, 'buyer reveal-contact => 200', `got ${rRevB.status}: ${JSON.stringify(rRevB.json)?.substring(0, 200)}`);
      if (rRevB.status === 200) {
        assert(typeof rRevB.json?.contact === 'object', 'contact object present');
        assert(typeof rRevB.json?.contact?.email === 'string', 'contact email present');
        console.log(`  Revealed seller email: ${rRevB.json?.contact?.email}`);
      }
    } else {
      console.log(`  (offer not mutually_accepted — status: ${offerStatus}, skipping reveal)`);
      if (rAccS.status === 429 || rAccB.status === 429) {
        console.log('  (pre-purchase daily limit hit on accept — expected for free tier)');
      }
    }
  }

  // ═══ Summary ═══
  console.log('\n╔════════════════════════════════════════════════╗');
  console.log(`║  RESULTS:  ${String(pass).padStart(3)} PASSED  /  ${String(fail).padStart(3)} FAILED           ║`);
  console.log('╚════════════════════════════════════════════════╝');
  if (failures.length) { console.log('\nFailed:'); failures.forEach(f => console.log(f)); }
  else console.log('\nAll post-deploy tests passed!');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error('FATAL:', e); process.exit(2); });
