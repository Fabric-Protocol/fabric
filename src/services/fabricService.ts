import crypto from 'node:crypto';
import { config } from '../config.js';
import * as repo from '../db/fabricRepo.js';
import { sendEmail } from './emailProvider.js';

function requirePublishFields(row: any) {
  if (!row.title) return 'title_required';
  if (!row.type) return 'type_required';
  if (!row.scope_primary) return 'scope_primary_required';
  if (row.scope_primary === 'OTHER' && !row.scope_notes) return 'scope_notes_required';
  if (row.scope_primary === 'local_in_person' && !row.location_text_public) return 'location_text_public_required';
  if (row.scope_primary === 'ship_to') {
    const ok = row.origin_region?.country_code && row.origin_region?.admin1 && row.dest_region?.country_code && row.dest_region?.admin1;
    if (!ok) return 'ship_regions_required';
  }
  if (row.scope_primary === 'remote_online_service' && !row.service_region?.country_code) return 'service_region_required';
  if (row.scope_primary === 'digital_delivery' && !row.delivery_format) return 'delivery_format_required';
  return null;
}

export const fabricService = {
  async bootstrap(payload: {
    display_name: string;
    email: string | null;
    referral_code: string | null;
    recovery_public_key: string | null;
    legal_version: string;
    legal_ip: string | null;
    legal_user_agent: string | null;
  }) {
    const node = await repo.createNode(payload.display_name, normalizeEmail(payload.email), payload.recovery_public_key, {
      acceptedAt: new Date().toISOString(),
      version: payload.legal_version,
      ip: payload.legal_ip,
      userAgent: payload.legal_user_agent,
    });
    const apiKey = await repo.createApiKey(node.id, 'default');
    await repo.ensureSubscription(node.id);
    await repo.addCredit(node.id, 'grant_signup', config.signupGrantCredits, {});
    if (payload.referral_code) {
      const referralCode = payload.referral_code.trim();
      if (referralCode) {
        let code = await repo.findReferralCode(referralCode);
        if (!code) {
          await repo.ensureReferralCode(referralCode, node.id);
          code = await repo.findReferralCode(referralCode);
        }
        if (code?.active && !(await repo.hasPaidStripeEvent(node.id)) && !(await repo.hasReferralClaim(node.id))) {
          await repo.createReferralClaim(referralCode, node.id, code.issuer_node_id);
        }
      }
    }
    return {
      node: {
        id: node.id,
        display_name: payload.display_name,
        email: normalizeEmail(payload.email),
        email_verified_at: null,
        recovery_public_key_configured: Boolean(payload.recovery_public_key),
        status: 'ACTIVE',
        plan: 'free',
        is_subscriber: false,
        created_at: node.created_at,
      },
      api_key: { key_id: apiKey.id, api_key: apiKey.api_key, created_at: apiKey.created_at },
      credits: { granted: config.signupGrantCredits, reason: 'SIGNUP_GRANT' },
    };
  },
  async createAuthKey(nodeId: string, label: string) {
    const key = await repo.createApiKey(nodeId, label);
    return { api_key: key.api_key, key_id: key.id, created_at: key.created_at };
  },
  async createBillingCheckoutSession(
    authedNodeId: string,
    payload: { node_id: string; plan_code: string; success_url: string; cancel_url: string },
    idempotencyKey: string | null,
  ) {
    if (payload.node_id !== authedNodeId) return { forbidden: true };
    const planCode = normalizePlanCode(payload.plan_code);
    if (!planCode || !paidPlanCodeSet.has(planCode)) return { validationError: 'unsupported_plan_code' };
    const stripePriceId = firstConfiguredStripePriceId(planCode);
    if (!stripePriceId) return { validationError: 'missing_price_mapping', plan_code: planCode };
    const missingStripeEnvVars = missingStripeCheckoutCoreEnvVars();
    if (missingStripeEnvVars.length > 0) {
      return { validationError: 'stripe_not_configured', missing: missingStripeEnvVars };
    }

    const checkoutSession = await createStripeCheckoutSession({
      nodeId: authedNodeId,
      planCode,
      priceId: stripePriceId,
      successUrl: payload.success_url,
      cancelUrl: payload.cancel_url,
      idempotencyKey,
    });
    if (!checkoutSession.ok) {
      return {
        validationError: 'stripe_checkout_failed',
        stripe_status: checkoutSession.status,
      };
    }

    const checkoutSessionId = nonEmptyString(checkoutSession.session?.id);
    const checkoutUrl = nonEmptyString(checkoutSession.session?.url);
    if (!checkoutSessionId || !checkoutUrl) {
      return { validationError: 'stripe_checkout_missing_url' };
    }

    return {
      node_id: authedNodeId,
      plan_code: planCode,
      checkout_session_id: checkoutSessionId,
      checkout_url: checkoutUrl,
    };
  },
  async createTopupCheckoutSession(
    authedNodeId: string,
    payload: { node_id: string; pack_code: string; success_url: string; cancel_url: string },
    idempotencyKey: string | null,
  ) {
    if (payload.node_id !== authedNodeId) return { forbidden: true };
    const pack = creditPackQuoteByCode(payload.pack_code);
    if (!pack) return { validationError: 'unsupported_pack_code' };
    if (!pack.stripe_price_id) return { validationError: 'missing_topup_price_mapping', pack_code: pack.pack_code };
    const missingStripeEnvVars = missingStripeCheckoutCoreEnvVars();
    if (missingStripeEnvVars.length > 0) {
      return { validationError: 'stripe_not_configured', missing: missingStripeEnvVars };
    }

    const checkoutSession = await createStripeTopupCheckoutSession({
      nodeId: authedNodeId,
      packCode: pack.pack_code,
      credits: pack.credits,
      priceId: pack.stripe_price_id,
      successUrl: payload.success_url,
      cancelUrl: payload.cancel_url,
      idempotencyKey,
    });
    if (!checkoutSession.ok) {
      return {
        validationError: 'stripe_checkout_failed',
        stripe_status: checkoutSession.status,
      };
    }

    const checkoutSessionId = nonEmptyString(checkoutSession.session?.id);
    const checkoutUrl = nonEmptyString(checkoutSession.session?.url);
    if (!checkoutSessionId || !checkoutUrl) {
      return { validationError: 'stripe_checkout_missing_url' };
    }

    return {
      node_id: authedNodeId,
      pack_code: pack.pack_code,
      credits: pack.credits,
      checkout_session_id: checkoutSessionId,
      checkout_url: checkoutUrl,
    };
  },
  stripeDiagnostics() {
    return stripeDiagnosticsSnapshot();
  },
  listAuthKeys(nodeId: string) { return repo.listKeys(nodeId).then((keys) => ({ keys })); },
  revokeAuthKey(nodeId: string, keyId: string) { return repo.revokeKey(nodeId, keyId); },
  async me(nodeId: string) {
    const me = await repo.getMe(nodeId);
    const balance = await repo.creditBalance(nodeId);
    const responsePlan = planCodeForResponse(me.plan_code);
    return {
      node: {
        id: me.id,
        display_name: me.display_name,
        email: me.email,
        email_verified_at: me.email_verified_at,
        recovery_public_key_configured: Boolean(me.recovery_public_key),
        status: me.status,
        plan: responsePlan,
        is_subscriber: me.sub_status === 'active',
        created_at: me.created_at,
      },
      subscription: { plan: responsePlan, status: me.sub_status, period_start: me.current_period_start, period_end: me.current_period_end, credits_rollover_enabled: true },
      credits_balance: balance,
    };
  },
  async patchMe(nodeId: string, payload: { display_name: string | null; email: string | null; recovery_public_key?: string | null }) {
    await repo.updateMe(nodeId, payload.display_name, normalizeEmail(payload.email), payload.recovery_public_key);
    return this.me(nodeId);
  },
  async startEmailVerify(nodeId: string, email: string) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return { validationError: 'email_required' };
    await repo.setNodeEmailForVerification(nodeId, normalizedEmail);
    const code = recoveryCode();
    const challenge = await repo.createRecoveryChallenge(
      nodeId,
      'email_verify',
      recoveryHash(code),
      recoveryExpiresAtIso(),
      config.recoveryChallengeMaxAttempts,
      { email: normalizedEmail },
    );
    const sent = await sendEmail({
      to: normalizedEmail,
      subject: 'Fabric email verification code',
      text: `Your Fabric verification code is ${code}. It expires in ${config.recoveryChallengeTtlMinutes} minutes.`,
    });
    if (!sent.ok) return { deliveryError: sent.reason, provider: sent.provider };
    return { ok: true, challenge_id: challenge.id, expires_at: challenge.expires_at };
  },
  async completeEmailVerify(nodeId: string, email: string, code: string) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) return { validationError: 'email_required' };
    const normalizedCode = String(code ?? '').trim();
    if (!/^\d{6}$/.test(normalizedCode)) return { validationError: 'code_format_invalid' };
    const out = await repo.completeEmailVerificationChallenge(nodeId, normalizedEmail, recoveryHash(normalizedCode));
    if (out.status === 'ok') return { ok: true };
    return { failed: out.status };
  },
  async startRecovery(nodeId: string, method: 'pubkey' | 'email') {
    const profile = await repo.getNodeRecoveryProfile(nodeId);
    if (!profile) return { notFound: true };
    if (method === 'pubkey') {
      if (!profile.recovery_public_key) return { validationError: 'recovery_public_key_missing' };
      const nonce = crypto.randomBytes(32).toString('hex');
      const challenge = await repo.createRecoveryChallenge(
        nodeId,
        'pubkey',
        nonce,
        recoveryExpiresAtIso(),
        config.recoveryChallengeMaxAttempts,
        {},
      );
      return { challenge_id: challenge.id, nonce, expires_at: challenge.expires_at };
    }

    if (!profile.email || !profile.email_verified_at) return { validationError: 'email_not_verified' };
    const code = recoveryCode();
    const challenge = await repo.createRecoveryChallenge(
      nodeId,
      'email',
      recoveryHash(code),
      recoveryExpiresAtIso(),
      config.recoveryChallengeMaxAttempts,
      { email: profile.email },
    );
    const sent = await sendEmail({
      to: profile.email,
      subject: 'Fabric API key recovery code',
      text: `Your Fabric API key recovery code is ${code}. It expires in ${config.recoveryChallengeTtlMinutes} minutes.`,
    });
    if (!sent.ok) return { deliveryError: sent.reason, provider: sent.provider };
    return { ok: true, challenge_id: challenge.id, expires_at: challenge.expires_at };
  },
  async completeRecovery(payload: { challenge_id: string; signature?: string; code?: string }) {
    if (payload.signature && payload.code) return { validationError: 'ambiguous_method' };
    if (!payload.signature && !payload.code) return { validationError: 'method_payload_required' };

    const challenge = await repo.getRecoveryChallenge(payload.challenge_id);
    if (!challenge) return { notFound: true };

    if (payload.signature) {
      if (challenge.type !== 'pubkey') return { validationError: 'challenge_type_mismatch' };
      const message = recoverySignedMessage(challenge.id, challenge.nonce_or_code_hash);
      const verified = verifyRecoverySignature(challenge.recovery_public_key ?? '', message, payload.signature);
      const completion = await repo.completeRecoveryChallenge(
        payload.challenge_id,
        'pubkey',
        verified ? challenge.nonce_or_code_hash : '__invalid_signature__',
      );
      if (completion.status !== 'ok') return { failed: completion.status };
      return {
        node_id: completion.node_id,
        key_id: completion.key_id,
        api_key: completion.api_key,
      };
    }

    const code = String(payload.code ?? '').trim();
    if (!/^\d{6}$/.test(code)) return { validationError: 'code_format_invalid' };
    const completion = await repo.completeRecoveryChallenge(payload.challenge_id, 'email', recoveryHash(code));
    if (completion.status !== 'ok') return { failed: completion.status };
    return {
      node_id: completion.node_id,
      key_id: completion.key_id,
      api_key: completion.api_key,
    };
  },
  async creditsBalance(nodeId: string) {
    const me = await repo.getMe(nodeId);
    return { credits_balance: await repo.creditBalance(nodeId), subscription: { plan: planCodeForResponse(me.plan_code), status: me.sub_status, period_start: me.current_period_start, period_end: me.current_period_end, credits_rollover_enabled: true } };
  },
  async creditsQuote(nodeId: string, payload: any | null) {
    const quotePayload = payload ?? {};
    const cacheKey = payload
      ? `${nodeId}:${crypto.createHash('sha256').update(JSON.stringify(quotePayload)).digest('hex')}`
      : null;
    const now = Date.now();
    if (cacheKey) {
      const cached = creditsQuoteCache.get(cacheKey);
      if (cached && cached.expiresAtMs > now) return cached.value;
      if (cached && cached.expiresAtMs <= now) creditsQuoteCache.delete(cacheKey);
    }

    const level = Number(quotePayload?.broadening?.level ?? 0);
    const estimatedCost = config.searchCreditCost + level;
    const balance = await repo.creditBalance(nodeId);
    const me = await repo.getMe(nodeId);

    const quote = {
      node_id: nodeId,
      subscription: {
        plan: planCodeForResponse(me.plan_code),
        status: me.sub_status,
      },
      credits_balance: balance,
      search_quote: {
        estimated_cost: estimatedCost,
        breakdown: {
          base_search_cost: config.searchCreditCost,
          broadening_level: level,
          broadening_cost: level,
        },
      },
      affordability: {
        can_afford_estimate: balance >= estimatedCost,
      },
      credit_packs: creditPackQuotes(),
      plans: paidPlanQuotes(),
    };

    if (cacheKey) {
      creditsQuoteCache.set(cacheKey, { expiresAtMs: now + CREDITS_QUOTE_CACHE_TTL_MS, value: quote });
    }
    return quote;
  },
  async creditsLedger(nodeId: string, limit: number, cursor: string | null) { const entries = await repo.listLedger(nodeId, limit, cursor); return { entries, next_cursor: entries.length === limit ? entries[entries.length - 1].created_at : null }; },
  async createUnit(nodeId: string, payload: any) {
    const created = await repo.createUnitWithUploadTrial(nodeId, payload, {
      threshold: config.uploadTrialThreshold,
      trialDays: config.uploadTrialDurationDays,
      trialCreditGrant: config.uploadTrialCreditGrant,
    });
    return {
      unit: {
        id: created.id,
        node_id: created.node_id,
        publish_status: created.publish_status,
        created_at: created.created_at,
        updated_at: created.updated_at,
        version: created.version,
      },
    };
  },
  listUnits(nodeId: string, limit: number, cursor: string | null) { return repo.listResources('units', nodeId, limit, cursor); },
  getUnit(nodeId: string, id: string) { return repo.getResource('units', nodeId, id); },
  patchUnit(nodeId: string, id: string, version: number, payload: any) { return repo.patchResource('units', nodeId, id, version, payload); },
  deleteUnit(nodeId: string, id: string) { return repo.deleteResource('units', nodeId, id); },
  createRequest(nodeId: string, payload: any) { return repo.createResource('requests', nodeId, payload).then((request) => ({ request })); },
  listRequests(nodeId: string, limit: number, cursor: string | null) { return repo.listResources('requests', nodeId, limit, cursor); },
  getRequest(nodeId: string, id: string) { return repo.getResource('requests', nodeId, id); },
  patchRequest(nodeId: string, id: string, version: number, payload: any) { return repo.patchResource('requests', nodeId, id, version, payload); },
  deleteRequest(nodeId: string, id: string) { return repo.deleteResource('requests', nodeId, id); },
  async publish(kind: 'units' | 'requests', nodeId: string, id: string) {
    const me = await repo.getMe(nodeId);
    if (!me) return { notFound: true };
    if (me.status !== 'ACTIVE' || me.suspended_at) return { forbidden: true };
    const row = await repo.getResource(kind, nodeId, id);
    if (!row) return { notFound: true };
    const failure = requirePublishFields(row);
    if (failure) return { validationError: failure };
    await repo.setPublished(kind, id, true);
    const updated = await repo.getResource(kind, nodeId, id);
    await repo.upsertProjection(kind, updated);
    return kind === 'units' ? { projection: { kind: 'listing', source_unit_id: id, published_at: new Date().toISOString() } } : { projection: { kind: 'request', source_request_id: id, published_at: new Date().toISOString() } };
  },
  async unpublish(kind: 'units' | 'requests', _nodeId: string, id: string) { await repo.setPublished(kind, id, false); await repo.removeProjection(kind, id); return { ok: true }; },
  async search(nodeId: string, kind: 'listings' | 'requests', hasSpendEntitlement: boolean, body: any, idemKey: string) {
    if (!hasSpendEntitlement) return { forbidden: true };
    const cost = config.searchCreditCost + (body.broadening?.level ?? 0);
    const balance = await repo.creditBalance(nodeId);
    if (balance < cost) return { creditsExhausted: { credits_required: cost, credits_balance: balance } };
    const rows = await repo.searchPublic(kind, body.scope, body.limit ?? 20, body.cursor ?? null, nodeId);
    await repo.addCredit(nodeId, body.cursor ? 'debit_search_page' : 'debit_search', -cost, { scope: body.scope }, idemKey);
    await repo.logSearch(nodeId, kind, body.scope, body.q ?? null, body.filters ?? {}, body.broadening?.level ?? 0, cost);
    return { search_id: crypto.randomUUID(), scope: body.scope, limit: body.limit ?? 20, cursor: body.cursor ?? null, broadening: body.broadening ?? { level: 0, allow: false }, applied_filters: body.filters ?? {}, items: rows.map((r) => ({ item: r.doc, rank: { sort_keys: { distance_miles: null, route_specificity_score: 0, fts_rank: 0, recency_score: 0 } } })), has_more: rows.length === (body.limit ?? 20) };
  },
  async nodePublicInventory(nodeId: string, targetNodeId: string, kind: 'listings'|'requests', hasSpendEntitlement: boolean, limit: number, cursor: string | null) {
    if (!hasSpendEntitlement) return { forbidden: true };
    const cost = config.searchCreditCost;
    const balance = await repo.creditBalance(nodeId);
    if (balance < cost) return { creditsExhausted: { credits_required: cost, credits_balance: balance } };
    const rows = await repo.listNodePublic(targetNodeId, kind, limit, cursor);
    await repo.addCredit(nodeId, 'debit_search_page', -cost, { kind: `public_nodes_${kind}` }, null);
    return { node_id: targetNodeId, limit, cursor, items: rows.map((r) => r.doc), has_more: rows.length === limit };
  },
};

export async function offerSummary(offer: any) {
  const lines = await repo.getOfferLines(offer.id);
  const hold = await repo.getHoldSummary(offer.id);
  return {
    id: offer.id,
    thread_id: offer.thread_id,
    from_node_id: offer.from_node_id,
    to_node_id: offer.to_node_id,
    status: offer.status,
    accepted_by_from_at: offer.accepted_by_from_at,
    accepted_by_to_at: offer.accepted_by_to_at,
    held_unit_ids: hold.held_unit_ids,
    unheld_unit_ids: hold.unheld_unit_ids,
    hold_status: hold.hold_status,
    hold_expires_at: hold.hold_expires_at,
    created_at: offer.created_at,
    updated_at: offer.updated_at,
    version: offer.row_version,
    unit_ids: lines.map((l) => l.unit_id),
  };
}

(fabricService as any).createOffer = async (nodeId: string, isSubscriber: boolean, unitIds: string[], threadId: string | null, note: string | null) => {
  if (!isSubscriber) return { forbidden: true };
  const owners = await repo.getUnitsOwners(unitIds);
  if (owners.length !== unitIds.length) return { conflict: 'invalid_units' };
  const uniqueOwners = new Set(owners.map((u) => u.node_id));
  if (uniqueOwners.size !== 1) return { conflict: 'multiple_owners' };
  const toNodeId = owners[0].node_id;
  const th = threadId ?? crypto.randomUUID();
  const offer = await repo.createOffer(nodeId, toNodeId, unitIds[0], th, note);
  const held: string[] = [];
  const unheld: string[] = [];
  for (const unitId of unitIds) {
    await repo.addOfferLine(offer.id, unitId);
    if (await repo.activeHeld(unitId)) unheld.push(unitId);
    else {
      await repo.createHold(offer.id, unitId);
      held.push(unitId);
    }
  }
  const sum = await offerSummary(offer);
  sum.held_unit_ids = held;
  sum.unheld_unit_ids = unheld;
  return { offer: sum };
};

(fabricService as any).counterOffer = async (nodeId: string, isSubscriber: boolean, offerId: string, unitIds: string[], note: string | null) => {
  if (!isSubscriber) return { forbidden: true };
  const prior = await repo.getOffer(offerId);
  if (!prior) return { notFound: true };
  await repo.setOfferStatus(prior.id, 'countered', { countered_at: new Date().toISOString() });
  await repo.releaseHolds(prior.id);
  const next = await (fabricService as any).createOffer(nodeId, true, unitIds, prior.thread_id, note);
  return next;
};

(fabricService as any).acceptOffer = async (nodeId: string, isSubscriber: boolean, offerId: string) => {
  if (!isSubscriber) return { forbidden: true };
  const offer = await repo.getOffer(offerId);
  if (!offer) return { notFound: true };
  if (offer.status !== 'pending' && offer.status !== 'accepted_by_a' && offer.status !== 'accepted_by_b') return { conflict: true };
  const byFrom = offer.from_node_id === nodeId;
  if (byFrom) {
    if (offer.accepted_by_to_at) {
      const updated = await repo.setOfferStatus(offerId, 'mutually_accepted', { accepted_by_from_at: new Date().toISOString(), mutually_accepted_at: new Date().toISOString() });
      await repo.commitHolds(offerId);
      return { offer: await offerSummary(updated) };
    }
    const updated = await repo.setOfferStatus(offerId, 'accepted_by_a', { accepted_by_from_at: new Date().toISOString() });
    return { offer: await offerSummary(updated) };
  }
  if (offer.accepted_by_from_at) {
    const updated = await repo.setOfferStatus(offerId, 'mutually_accepted', { accepted_by_to_at: new Date().toISOString(), mutually_accepted_at: new Date().toISOString() });
    await repo.commitHolds(offerId);
    return { offer: await offerSummary(updated) };
  }
  const updated = await repo.setOfferStatus(offerId, 'accepted_by_b', { accepted_by_to_at: new Date().toISOString() });
  return { offer: await offerSummary(updated) };
};

(fabricService as any).rejectOffer = async (nodeId: string, offerId: string) => {
  const offer = await repo.getOffer(offerId);
  if (!offer) return { notFound: true };
  if (![offer.from_node_id, offer.to_node_id].includes(nodeId)) return { forbidden: true };
  const updated = await repo.setOfferStatus(offerId, 'rejected', { rejected_at: new Date().toISOString() });
  await repo.releaseHolds(offerId);
  return { offer: await offerSummary(updated) };
};

(fabricService as any).cancelOffer = async (nodeId: string, offerId: string) => {
  const offer = await repo.getOffer(offerId);
  if (!offer) return { notFound: true };
  if (offer.from_node_id !== nodeId) return { forbidden: true };
  const updated = await repo.setOfferStatus(offerId, 'cancelled', { cancelled_at: new Date().toISOString() });
  await repo.releaseHolds(offerId);
  return { offer: await offerSummary(updated) };
};

(fabricService as any).listOffers = async (nodeId: string, role: 'made' | 'received', limit: number, cursor: string | null) => {
  const offers = await repo.listOffers(nodeId, role, limit, cursor);
  return { offers: await Promise.all(offers.map((o) => offerSummary(o))) };
};

(fabricService as any).getOffer = async (nodeId: string, offerId: string) => {
  const offer = await repo.getOffer(offerId);
  if (!offer) return null;
  if (![offer.from_node_id, offer.to_node_id].includes(nodeId)) return null;
  return { offer: await offerSummary(offer) };
};

(fabricService as any).revealContact = async (nodeId: string, isSubscriber: boolean, offerId: string) => {
  const offer = await repo.getOffer(offerId);
  if (!offer) return { notFound: true };
  if (offer.status !== 'mutually_accepted') return { notAccepted: true };
  if (![offer.from_node_id, offer.to_node_id].includes(nodeId)) return { forbidden: true };
  if (!isSubscriber) return { subscriberRequired: true };
  const from = await repo.getMe(offer.from_node_id);
  const to = await repo.getMe(offer.to_node_id);
  if (from.sub_status !== 'active' || to.sub_status !== 'active') return { subscriberRequired: true };
  const revealNode = offer.from_node_id === nodeId ? to : from;
  await repo.addContactReveal(offerId, nodeId, revealNode.id, revealNode.email, revealNode.phone);
  return { contact: { email: revealNode.email ?? '', phone: revealNode.phone ?? null } };
};

(fabricService as any).claimReferral = async (nodeId: string, referralCode: string) => {
  const code = await repo.findReferralCode(referralCode);
  if (!code || !code.active) return { invalid: true };
  if (await repo.hasPaidStripeEvent(nodeId)) return { locked: true };
  if (await repo.hasReferralClaim(nodeId)) return { already: true, referrer_node_id: code.issuer_node_id };
  await repo.createReferralClaim(referralCode, nodeId, code.issuer_node_id);
  return { ok: true, referrer_node_id: code.issuer_node_id };
};

const planCredits: Record<string, number> = { free: 0, basic: 500, pro: 1500, business: 5000 };
const freeLikePlans = new Set(['free', 'none']);
const creditsQuoteCache = new Map<string, { expiresAtMs: number; value: any }>();
const CREDITS_QUOTE_CACHE_TTL_MS = 60 * 1000;

type CreditPackQuote = {
  pack_code: string;
  credits: number;
  price_cents: number;
  currency: 'usd';
  stripe_price_id: string | null;
};

function creditPackQuotes(): CreditPackQuote[] {
  return [
    {
      pack_code: 'credits_100',
      credits: config.topupPack100Credits,
      price_cents: config.topupPack100PriceCents,
      currency: 'usd',
      stripe_price_id: nonEmptyString(config.stripeTopupPrice100),
    },
    {
      pack_code: 'credits_300',
      credits: config.topupPack300Credits,
      price_cents: config.topupPack300PriceCents,
      currency: 'usd',
      stripe_price_id: nonEmptyString(config.stripeTopupPrice300),
    },
    {
      pack_code: 'credits_1000',
      credits: config.topupPack1000Credits,
      price_cents: config.topupPack1000PriceCents,
      currency: 'usd',
      stripe_price_id: nonEmptyString(config.stripeTopupPrice1000),
    },
  ];
}

function creditPackQuoteByCode(packCode: string | null | undefined) {
  if (!packCode) return null;
  const normalized = packCode.trim().toLowerCase();
  return creditPackQuotes().find((pack) => pack.pack_code === normalized) ?? null;
}

function paidPlanQuotes() {
  return [
    { plan_code: 'basic', monthly_credits: planCredits.basic },
    { plan_code: 'pro', monthly_credits: planCredits.pro },
    { plan_code: 'business', monthly_credits: planCredits.business },
  ];
}

const stripePricePlanMap: Record<string, string[]> = {
  basic: config.stripePriceIdsBasic,
  pro: config.stripePriceIdsPro,
  business: config.stripePriceIdsBusiness,
};
const stripePlanEnvVarNames: Record<string, { ids: string; single: string }> = {
  basic: { ids: 'STRIPE_PRICE_IDS_BASIC', single: 'STRIPE_PRICE_BASIC' },
  pro: { ids: 'STRIPE_PRICE_IDS_PRO', single: 'STRIPE_PRICE_PRO' },
  business: { ids: 'STRIPE_PRICE_IDS_BUSINESS', single: 'STRIPE_PRICE_BUSINESS' },
};
const paidPlanCodes = ['basic', 'pro', 'business'] as const;
const paidPlanCodeSet = new Set<string>(paidPlanCodes);
const canonicalPlanCodes = new Set<string>(['free', ...paidPlanCodes]);

function stripePriceIdCountsByPlan() {
  return {
    basic: config.stripePriceIdsBasic.length,
    pro: config.stripePriceIdsPro.length,
    business: config.stripePriceIdsBusiness.length,
  };
}

function stripeSecretKeyPresent() {
  return Boolean(nonEmptyString(config.stripeSecretKey));
}

function stripeWebhookSecretPresent() {
  return Boolean(nonEmptyString(config.stripeWebhookSecret));
}

function missingStripeCheckoutCoreEnvVars() {
  const missing: string[] = [];
  if (!stripeSecretKeyPresent()) missing.push('STRIPE_SECRET_KEY');
  return missing;
}

function stripeDiagnosticsSnapshot() {
  const missing = new Set<string>();
  const stripeSecretConfigured = stripeSecretKeyPresent();
  const stripeWebhookConfigured = stripeWebhookSecretPresent();
  const planCounts = stripePriceIdCountsByPlan();

  if (!stripeSecretConfigured) missing.add('STRIPE_SECRET_KEY');
  if (!stripeWebhookConfigured) missing.add('STRIPE_WEBHOOK_SECRET');

  for (const [planCode, count] of Object.entries(planCounts)) {
    if (count > 0) continue;
    const names = stripePlanEnvVarNames[planCode];
    if (!names) continue;
    missing.add(names.ids);
    missing.add(names.single);
  }

  if (!nonEmptyString(config.stripeTopupPrice100)) missing.add('STRIPE_TOPUP_PRICE_100');
  if (!nonEmptyString(config.stripeTopupPrice300)) missing.add('STRIPE_TOPUP_PRICE_300');
  if (!nonEmptyString(config.stripeTopupPrice1000)) missing.add('STRIPE_TOPUP_PRICE_1000');

  return {
    stripe_configured: missing.size === 0,
    missing: [...missing].sort(),
    price_id_counts_by_plan: planCounts,
    stripe_secret_key_present: stripeSecretConfigured,
    stripe_webhook_secret_present: stripeWebhookConfigured,
  };
}

function firstConfiguredStripePriceId(planCode: string) {
  const priceIds = stripePricePlanMap[planCode];
  if (!Array.isArray(priceIds) || priceIds.length === 0) return null;
  return priceIds[0];
}

function mappingKeysPresentByPlan() {
  return Object.fromEntries(Object.entries(stripePricePlanMap).map(([plan, ids]) => [plan, ids.length]));
}

function normalizePlanCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : null;
}

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function stripePriceIdFromLine(line: any): string | null {
  const direct = nonEmptyString(line?.price?.id)
    ?? nonEmptyString(line?.price)
    ?? nonEmptyString(line?.plan?.id)
    ?? nonEmptyString(line?.plan)
    ?? nonEmptyString(line?.pricing?.price_details?.price);
  return direct;
}

function invoiceLineItems(invoiceObject: any): any[] {
  return Array.isArray(invoiceObject?.lines?.data) ? invoiceObject.lines.data : [];
}

function extractStripePriceIds(invoiceObject: any) {
  const ids = invoiceLineItems(invoiceObject).map((line) => stripePriceIdFromLine(line)).filter((value): value is string => Boolean(value));
  return [...new Set(ids)];
}

function extractStripeSubscriptionIdFromInvoice(invoiceObject: any): string | null {
  const direct = stripeId(invoiceObject?.subscription);
  if (direct) return direct;
  for (const line of invoiceLineItems(invoiceObject)) {
    const fromParent = nonEmptyString(line?.parent?.subscription_item_details?.subscription);
    if (fromParent) return fromParent;
  }
  return null;
}

function normalizeEmail(value: string | null | undefined) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

function recoveryCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function recoveryHash(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function recoveryExpiresAtIso() {
  return new Date(Date.now() + (config.recoveryChallengeTtlMinutes * 60 * 1000)).toISOString();
}

function recoverySignedMessage(challengeId: string, nonce: string) {
  return `fabric-recovery:${challengeId}:${nonce}`;
}

function decodeSignature(rawSignature: string) {
  const sig = rawSignature.trim();
  if (!sig) return null;
  if (/^[0-9a-f]+$/i.test(sig) && sig.length % 2 === 0) return Buffer.from(sig, 'hex');
  try {
    const decoded = Buffer.from(sig, 'base64');
    if (!decoded.length) return null;
    return decoded;
  } catch {
    return null;
  }
}

function verifyRecoverySignature(publicKey: string, message: string, signature: string) {
  try {
    const key = crypto.createPublicKey(publicKey);
    const signatureBytes = decodeSignature(signature);
    if (!signatureBytes) return false;
    const keyType = key.asymmetricKeyType;
    const algorithm = keyType === 'ed25519' || keyType === 'ed448' ? null : 'sha256';
    return crypto.verify(algorithm as any, Buffer.from(message, 'utf8'), key, signatureBytes);
  } catch {
    return false;
  }
}

function stripeId(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

function stripeTimeToIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') {
    const asMillis = value > 1_000_000_000_000 ? value : value * 1000;
    return new Date(asMillis).toISOString();
  }
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) {
      const numeric = Number(value);
      const asMillis = numeric > 1_000_000_000_000 ? numeric : numeric * 1000;
      return new Date(asMillis).toISOString();
    }
    return value;
  }
  return null;
}

function validPeriodWindow(periodStart: string | null, periodEnd: string | null) {
  if (!periodStart || !periodEnd) return false;
  const startMs = Date.parse(periodStart);
  const endMs = Date.parse(periodEnd);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return false;
  return startMs < endMs;
}

function invoiceLinePeriodWindow(invoiceObject: any) {
  for (const line of invoiceLineItems(invoiceObject)) {
    const periodStart = stripeTimeToIso(line?.period?.start ?? line?.period_start);
    const periodEnd = stripeTimeToIso(line?.period?.end ?? line?.period_end);
    if (validPeriodWindow(periodStart, periodEnd)) return { periodStart, periodEnd };
  }
  return null;
}

async function stripeSubscriptionPeriodWindow(stripeSubscriptionId: string | null) {
  if (!stripeSubscriptionId) return null;
  const subscription = await fetchStripeJson(`subscriptions/${encodeURIComponent(stripeSubscriptionId)}`);
  const periodStart = stripeTimeToIso(subscription?.current_period_start);
  const periodEnd = stripeTimeToIso(subscription?.current_period_end);
  if (!validPeriodWindow(periodStart, periodEnd)) return null;
  return { periodStart, periodEnd };
}

async function resolveInvoicePeriodWindow(invoiceObject: any, eventObject: any, stripeSubscriptionId: string | null) {
  const invoicePeriodStart = stripeTimeToIso(invoiceObject?.period_start ?? eventObject?.period_start);
  const invoicePeriodEnd = stripeTimeToIso(invoiceObject?.period_end ?? eventObject?.period_end);
  if (validPeriodWindow(invoicePeriodStart, invoicePeriodEnd)) {
    return { periodStart: invoicePeriodStart, periodEnd: invoicePeriodEnd };
  }

  const subscriptionWindow = await stripeSubscriptionPeriodWindow(stripeSubscriptionId);
  if (subscriptionWindow) return subscriptionWindow;

  const lineWindow = invoiceLinePeriodWindow(invoiceObject);
  if (lineWindow) return lineWindow;

  return {
    periodStart: invoicePeriodStart ?? new Date().toISOString(),
    periodEnd: invoicePeriodEnd,
  };
}

async function fetchInvoiceForPlanResolution(event: any) {
  const eventObject = event?.data?.object ?? {};
  const invoiceId = nonEmptyString(eventObject?.id);
  if (!invoiceId) return null;
  return fetchStripeJson(`invoices/${encodeURIComponent(invoiceId)}?expand[]=lines.data.price&expand[]=lines.data.plan`);
}

function planFromStripePrices(stripePriceIds: string[]) {
  if (stripePriceIds.length === 0) return null;
  for (const [planCode, configuredPriceIds] of Object.entries(stripePricePlanMap)) {
    if (configuredPriceIds.length === 0) continue;
    const configuredSet = new Set(configuredPriceIds);
    if (stripePriceIds.some((priceId) => configuredSet.has(priceId))) return planCode;
  }
  return null;
}

function planCodeForStorage(planCode: string) {
  return planCode;
}

function planCodeForResponse(planCode: string) {
  return planCode;
}

const planOrder: Record<string, number> = {
  free: 0,
  basic: 1,
  pro: 2,
  business: 3,
};

function planRank(planCode: string | null | undefined) {
  if (!planCode) return 0;
  return planOrder[planCode] ?? 0;
}

function normalizePlanForComparison(planCode: string | null | undefined) {
  const normalized = normalizePlanCode(planCode);
  if (!normalized || !(normalized in planOrder)) return 'free';
  return normalized;
}

function invoiceIdForIdempotency(invoiceObject: any) {
  return nonEmptyString(invoiceObject?.id);
}

function hasProrationLine(invoiceObject: any) {
  for (const line of invoiceLineItems(invoiceObject)) {
    if (line?.proration === true) return true;
    if (line?.parent?.subscription_item_details?.proration === true) return true;
  }
  return false;
}

async function invoiceObjectWithLines(event: any) {
  const eventObject = event?.data?.object ?? {};
  if (invoiceLineItems(eventObject).length > 0) return eventObject;
  const fetched = await fetchInvoiceForPlanResolution(event);
  return fetched ?? eventObject;
}

async function resolvePlanCode(nodeId: string, event: any, fallback: string, options: { preferStripePriceMap?: boolean; avoidFreeFallback?: boolean } = {}) {
  const explicitPlan = normalizePlanCode(event.data?.object?.metadata?.plan_code ?? event.data?.object?.plan_code ?? null);
  if (explicitPlan && canonicalPlanCodes.has(explicitPlan)) return explicitPlan;

  let stripePriceIds: string[] = [];
  if (options.preferStripePriceMap) {
    const eventObject = event?.data?.object ?? {};
    stripePriceIds = extractStripePriceIds(eventObject);
    if (stripePriceIds.length === 0) {
      const fetchedInvoice = await fetchInvoiceForPlanResolution(event);
      if (fetchedInvoice) stripePriceIds = extractStripePriceIds(fetchedInvoice);
    }
    const mappedPlan = planFromStripePrices(stripePriceIds);
    if (mappedPlan) return mappedPlan;
  }

  const me = await repo.getMe(nodeId);
  const existingPlanRaw = normalizePlanCode(me?.plan_code);
  const existingPlan = existingPlanRaw && canonicalPlanCodes.has(existingPlanRaw) ? existingPlanRaw : null;
  if (options.avoidFreeFallback && existingPlan && !freeLikePlans.has(existingPlan)) return existingPlan;
  if (options.preferStripePriceMap && stripePriceIds.length > 0) {
    console.warn(JSON.stringify({
      msg: 'stripe plan mapping missing',
      event_type: event?.type ?? null,
      stripe_price_ids: stripePriceIds,
      mapping_keys_present: mappingKeysPresentByPlan(),
      existing_plan: existingPlan,
    }));
  }
  if (existingPlan) return existingPlan;
  const normalizedFallback = normalizePlanCode(fallback);
  if (normalizedFallback && canonicalPlanCodes.has(normalizedFallback)) return normalizedFallback;
  return fallback;
}

async function createStripeCheckoutSession(payload: {
  nodeId: string;
  planCode: string;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string | null;
}) {
  const form = new URLSearchParams();
  form.set('mode', 'subscription');
  form.set('line_items[0][price]', payload.priceId);
  form.set('line_items[0][quantity]', '1');
  form.set('success_url', payload.successUrl);
  form.set('cancel_url', payload.cancelUrl);
  form.set('client_reference_id', payload.nodeId);
  form.set('metadata[node_id]', payload.nodeId);
  form.set('metadata[plan_code]', payload.planCode);
  form.set('subscription_data[metadata][node_id]', payload.nodeId);
  form.set('subscription_data[metadata][plan_code]', payload.planCode);

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.stripeSecretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (payload.idempotencyKey) headers['Idempotency-Key'] = `fabric_checkout:${payload.nodeId}:${payload.idempotencyKey}`;

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers,
      body: form.toString(),
    });
    const session = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, session };
  } catch {
    return { ok: false, status: 0, session: null };
  }
}

async function createStripeTopupCheckoutSession(payload: {
  nodeId: string;
  packCode: string;
  credits: number;
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string | null;
}) {
  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('line_items[0][price]', payload.priceId);
  form.set('line_items[0][quantity]', '1');
  form.set('success_url', payload.successUrl);
  form.set('cancel_url', payload.cancelUrl);
  form.set('client_reference_id', payload.nodeId);
  form.set('metadata[node_id]', payload.nodeId);
  form.set('metadata[topup_pack_code]', payload.packCode);
  form.set('metadata[topup_credits]', String(payload.credits));

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.stripeSecretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (payload.idempotencyKey) headers['Idempotency-Key'] = `fabric_topup:${payload.nodeId}:${payload.idempotencyKey}`;

  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers,
      body: form.toString(),
    });
    const session = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, session };
  } catch {
    return { ok: false, status: 0, session: null };
  }
}

async function fetchStripeJson(path: string) {
  if (!config.stripeSecretKey) return null;
  try {
    const res = await fetch(`https://api.stripe.com/v1/${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.stripeSecretKey}` },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchNodeIdFromStripeCustomer(stripeCustomerId: string) {
  const customer = await fetchStripeJson(`customers/${encodeURIComponent(stripeCustomerId)}`);
  const nodeId = customer?.metadata?.node_id;
  return typeof nodeId === 'string' && nodeId ? nodeId : null;
}

async function fetchNodeIdFromStripeSubscription(stripeSubscriptionId: string) {
  const subscription = await fetchStripeJson(`subscriptions/${encodeURIComponent(stripeSubscriptionId)}`);
  const nodeId = subscription?.metadata?.node_id;
  return typeof nodeId === 'string' && nodeId ? nodeId : null;
}

async function resolveDeterministicStripeIds(nodeId: string, incomingStripeCustomerId: string | null, incomingStripeSubscriptionId: string | null) {
  const existing = await repo.getSubscriptionMapping(nodeId);
  let stripeCustomerId = existing.stripe_customer_id;
  let stripeSubscriptionId = existing.stripe_subscription_id;

  if (incomingStripeCustomerId) {
    const owner = await repo.findNodeIdByStripeCustomerId(incomingStripeCustomerId);
    const canAttachToNode = !owner || owner === nodeId;
    const nodeAllows = !existing.stripe_customer_id || existing.stripe_customer_id === incomingStripeCustomerId;
    if (canAttachToNode && nodeAllows) stripeCustomerId = incomingStripeCustomerId;
  }

  if (incomingStripeSubscriptionId) {
    const owner = await repo.findNodeIdByStripeSubscriptionId(incomingStripeSubscriptionId);
    const canAttachToNode = !owner || owner === nodeId;
    const nodeAllows = !existing.stripe_subscription_id || existing.stripe_subscription_id === incomingStripeSubscriptionId;
    if (canAttachToNode && nodeAllows) stripeSubscriptionId = incomingStripeSubscriptionId;
  }

  return { stripeCustomerId: stripeCustomerId ?? null, stripeSubscriptionId: stripeSubscriptionId ?? null };
}

async function resolveNodeMapping(event: any) {
  const object = event.data?.object ?? {};
  const nodeIdFromPayload = object.metadata?.node_id ?? object.node_id ?? event.node_id ?? null;
  const stripeCustomerId = stripeId(object.customer);
  const stripeSubscriptionId = event.type?.startsWith('customer.subscription.') ? stripeId(object.id) : (stripeId(object.subscription) ?? extractStripeSubscriptionIdFromInvoice(object));

  if (nodeIdFromPayload) {
    return { nodeId: nodeIdFromPayload as string, source: 'metadata' as const, stripeCustomerId, stripeSubscriptionId };
  }

  if (stripeCustomerId) {
    const byCustomer = await repo.findNodeIdByStripeCustomerId(stripeCustomerId);
    if (byCustomer) {
      return { nodeId: byCustomer, source: 'stripe_customer_id' as const, stripeCustomerId, stripeSubscriptionId };
    }
  }

  if (stripeSubscriptionId) {
    const bySub = await repo.findNodeIdByStripeSubscriptionId(stripeSubscriptionId);
    if (bySub) {
      return { nodeId: bySub, source: 'stripe_subscription_id' as const, stripeCustomerId, stripeSubscriptionId };
    }
  }

  if (stripeCustomerId) {
    const byCustomerMetadata = await fetchNodeIdFromStripeCustomer(stripeCustomerId);
    if (byCustomerMetadata) {
      return { nodeId: byCustomerMetadata, source: 'stripe_customer_metadata' as const, stripeCustomerId, stripeSubscriptionId };
    }
  }

  if (stripeSubscriptionId) {
    const bySubscriptionMetadata = await fetchNodeIdFromStripeSubscription(stripeSubscriptionId);
    if (bySubscriptionMetadata) {
      return { nodeId: bySubscriptionMetadata, source: 'stripe_subscription_metadata' as const, stripeCustomerId, stripeSubscriptionId };
    }
  }

  return { nodeId: null, source: null, stripeCustomerId, stripeSubscriptionId };
}

function utcDayStartIso(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

function topupPackFromStripeEventObject(object: any) {
  const packCode = nonEmptyString(object?.metadata?.topup_pack_code ?? object?.metadata?.pack_code ?? null);
  return creditPackQuoteByCode(packCode);
}

function topupPaymentReference(object: any) {
  return nonEmptyString(stripeId(object?.payment_intent))
    ?? nonEmptyString(stripeId(object?.invoice))
    ?? nonEmptyString(stripeId(object?.id));
}

function topupIdempotencyKey(paymentReference: string) {
  if (paymentReference.startsWith('pi_')) return `topup:payment_intent:${paymentReference}`;
  if (paymentReference.startsWith('in_')) return `topup:invoice:${paymentReference}`;
  return `topup:session:${paymentReference}`;
}

async function applyTopupGrant(nodeId: string, eventType: string, eventObject: any) {
  const pack = topupPackFromStripeEventObject(eventObject);
  if (!pack) return { handled: false, reason: 'not_topup_event' as const };
  if (eventType === 'checkout.session.completed') {
    const paymentStatus = nonEmptyString(eventObject?.payment_status);
    if (paymentStatus && paymentStatus !== 'paid') {
      return { handled: true, applied: false, reason: 'topup_payment_not_paid' as const, pack_code: pack.pack_code };
    }
  }

  const paymentReference = topupPaymentReference(eventObject);
  if (!paymentReference) return { handled: true, applied: false, reason: 'topup_missing_payment_reference' as const, pack_code: pack.pack_code };

  const grantsToday = await repo.countTopupPurchasesSince(nodeId, utcDayStartIso());
  if (grantsToday >= config.topupMaxGrantsPerDay) {
    return {
      handled: true,
      applied: false,
      reason: 'topup_velocity_limit_exceeded' as const,
      pack_code: pack.pack_code,
      payment_reference: paymentReference,
      grants_today: grantsToday,
      max_grants_per_day: config.topupMaxGrantsPerDay,
    };
  }

  const inserted = await repo.addCreditIdempotent(
    nodeId,
    'topup_purchase',
    pack.credits,
    { pack_code: pack.pack_code, payment_reference: paymentReference, event_type: eventType },
    topupIdempotencyKey(paymentReference),
  );
  return {
    handled: true,
    applied: inserted,
    reason: inserted ? 'topup_granted' as const : 'topup_idempotent_replay' as const,
    pack_code: pack.pack_code,
    credits: pack.credits,
    payment_reference: paymentReference,
  };
}

(fabricService as any).processStripeEvent = async (event: any) => {
  const type = String(event.type ?? 'unknown');
  const object = event.data?.object ?? {};
  const mapping = await resolveNodeMapping(event);
  if (!mapping.nodeId) {
    return {
      mapped: false,
      reason: 'unmapped_stripe_customer',
      event_type: type,
      stripe_customer_id: mapping.stripeCustomerId,
      stripe_subscription_id: mapping.stripeSubscriptionId,
    };
  }

  const nodeId = mapping.nodeId;
  const incomingStripeCustomerId = mapping.stripeCustomerId ?? stripeId(object.customer);
  const incomingStripeSubscriptionId = mapping.stripeSubscriptionId ?? (type.startsWith('customer.subscription.') ? stripeId(object.id) : (stripeId(object.subscription) ?? extractStripeSubscriptionIdFromInvoice(object)));
  const { stripeCustomerId, stripeSubscriptionId } = await resolveDeterministicStripeIds(nodeId, incomingStripeCustomerId, incomingStripeSubscriptionId);

  if (type === 'customer.subscription.created' || type === 'customer.subscription.updated' || type === 'customer.subscription.deleted') {
    const planCode = await resolvePlanCode(nodeId, event, 'free');
    const storedPlanCode = planCodeForStorage(planCode);
    const status = type === 'customer.subscription.deleted' ? 'canceled' : (object.status ?? 'active');
    await repo.upsertSubscription(nodeId, storedPlanCode, status, stripeTimeToIso(object.current_period_start), stripeTimeToIso(object.current_period_end), stripeCustomerId, stripeSubscriptionId);
    const subscriptionActivated = status === 'active'
      ? {
          node_id: nodeId,
          plan_code: planCodeForResponse(storedPlanCode),
          invoice_id: null,
          stripe_subscription_id: stripeSubscriptionId,
        }
      : null;
    return {
      mapped: true,
      node_id: nodeId,
      mapping_source: mapping.source,
      event_type: type,
      ...(subscriptionActivated ? { subscription_activated: subscriptionActivated } : {}),
    };
  }

  if (type === 'checkout.session.completed') {
    const topup = await applyTopupGrant(nodeId, type, object);
    if (topup.handled) {
      if (!topup.applied && topup.reason === 'topup_velocity_limit_exceeded') {
        console.warn(JSON.stringify({
          msg: 'topup velocity limit exceeded',
          node_id: nodeId,
          pack_code: topup.pack_code,
          payment_reference: topup.payment_reference,
          grants_today: topup.grants_today,
          max_grants_per_day: topup.max_grants_per_day,
        }));
      }
      return { mapped: true, node_id: nodeId, mapping_source: mapping.source, event_type: type, topup };
    }
    const planCode = await resolvePlanCode(nodeId, event, 'basic');
    const storedPlanCode = planCodeForStorage(planCode);
    await repo.upsertSubscription(nodeId, storedPlanCode, 'active', stripeTimeToIso(object.current_period_start), stripeTimeToIso(object.current_period_end), stripeCustomerId, stripeSubscriptionId);
    return {
      mapped: true,
      node_id: nodeId,
      mapping_source: mapping.source,
      event_type: type,
      subscription_activated: {
        node_id: nodeId,
        plan_code: planCodeForResponse(storedPlanCode),
        invoice_id: invoiceIdForIdempotency(object),
        stripe_subscription_id: stripeSubscriptionId,
      },
    };
  }

  if (type === 'invoice.paid') {
    const topup = await applyTopupGrant(nodeId, type, object);
    if (topup.handled) {
      if (!topup.applied && topup.reason === 'topup_velocity_limit_exceeded') {
        console.warn(JSON.stringify({
          msg: 'topup velocity limit exceeded',
          node_id: nodeId,
          pack_code: topup.pack_code,
          payment_reference: topup.payment_reference,
          grants_today: topup.grants_today,
          max_grants_per_day: topup.max_grants_per_day,
        }));
      }
      return { mapped: true, node_id: nodeId, mapping_source: mapping.source, event_type: type, topup };
    }
    const invoiceObject = await invoiceObjectWithLines(event);
    const invoiceId = invoiceIdForIdempotency(invoiceObject) ?? invoiceIdForIdempotency(object);
    const billingReason = nonEmptyString(invoiceObject?.billing_reason ?? object?.billing_reason);
    const proration = hasProrationLine(invoiceObject);

    const existing = await repo.getMe(nodeId);
    const existingStoredPlan = normalizePlanCode(existing?.plan_code) ?? 'free';
    const existingPlan = normalizePlanForComparison(planCodeForResponse(existingStoredPlan));

    const resolvedPlan = await resolvePlanCode(nodeId, event, 'basic', { preferStripePriceMap: true, avoidFreeFallback: true });
    const resolvedPlanNorm = normalizePlanForComparison(resolvedPlan);
    let effectivePlan = resolvedPlanNorm;

    const isDowngradeUpdate = planRank(resolvedPlanNorm) < planRank(existingPlan)
      && (billingReason === 'subscription_update' || proration);
    if (isDowngradeUpdate) {
      effectivePlan = existingPlan;
      console.info(JSON.stringify({
        msg: 'stripe downgrade deferred until renewal',
        node_id: nodeId,
        invoice_id: invoiceId,
        from_plan: existingPlan,
        requested_plan: resolvedPlanNorm,
        billing_reason: billingReason,
      }));
    }

    const storedPlanCode = planCodeForStorage(effectivePlan);
    const { periodStart, periodEnd } = await resolveInvoicePeriodWindow(invoiceObject, object, stripeSubscriptionId);
    await repo.upsertSubscription(nodeId, storedPlanCode, 'active', periodStart, periodEnd, stripeCustomerId, stripeSubscriptionId);

    if (!(await repo.monthlyCreditGranted(nodeId, periodStart))) {
      await repo.addCredit(nodeId, 'grant_subscription_monthly', planCredits[effectivePlan] ?? 0, { period_start: periodStart });
    }

    const isUpgradeProration = planRank(effectivePlan) > planRank(existingPlan)
      && (billingReason === 'subscription_update' || proration);
    const upgradeDelta = (planCredits[effectivePlan] ?? 0) - (planCredits[existingPlan] ?? 0);
    if (isUpgradeProration && upgradeDelta > 0 && invoiceId) {
      await repo.addCreditIdempotent(
        nodeId,
        'adjustment_manual',
        upgradeDelta,
        {
          reason: 'upgrade_proration_delta',
          invoice_id: invoiceId,
          from_plan: existingPlan,
          to_plan: effectivePlan,
        },
        `invoice:${invoiceId}:upgrade`,
      );
    }

    const referralPaymentReference = invoiceId
      ? `invoice:${invoiceId}`
      : (stripeSubscriptionId ? `subscription:${stripeSubscriptionId}` : `event:${String(event.id ?? 'unknown')}`);
    await repo.awardReferralFirstPaid(nodeId, 100, referralPaymentReference, {
      invoice_id: invoiceId ?? null,
      stripe_subscription_id: stripeSubscriptionId ?? null,
    });
    return {
      mapped: true,
      node_id: nodeId,
      mapping_source: mapping.source,
      event_type: type,
      subscription_activated: {
        node_id: nodeId,
        plan_code: effectivePlan,
        invoice_id: invoiceId,
        stripe_subscription_id: stripeSubscriptionId,
      },
    };
  }

  if (type === 'invoice.payment_failed') {
    const planCode = await resolvePlanCode(nodeId, event, 'free');
    const storedPlanCode = planCodeForStorage(planCode);
    await repo.upsertSubscription(nodeId, storedPlanCode, 'past_due', stripeTimeToIso(object.current_period_start), stripeTimeToIso(object.current_period_end), stripeCustomerId, stripeSubscriptionId);
    return { mapped: true, node_id: nodeId, mapping_source: mapping.source, event_type: type };
  }

  return { mapped: true, node_id: nodeId, mapping_source: mapping.source, event_type: type };
};
