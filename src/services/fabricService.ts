import crypto from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import net from 'node:net';
import { config } from '../config.js';
import * as repo from '../db/fabricRepo.js';
import { sendEmail } from './emailProvider.js';

type DnsLookupAll = (hostname: string, options: { all: true; verbatim?: boolean }) => Promise<Array<{ address: string; family: number }>>;

let webhookDnsLookup: DnsLookupAll = dnsLookup as DnsLookupAll;
const webhookIpBlockList = new net.BlockList();

webhookIpBlockList.addAddress('0.0.0.0', 'ipv4');
webhookIpBlockList.addSubnet('10.0.0.0', 8, 'ipv4');
webhookIpBlockList.addSubnet('127.0.0.0', 8, 'ipv4');
webhookIpBlockList.addSubnet('169.254.0.0', 16, 'ipv4');
webhookIpBlockList.addSubnet('172.16.0.0', 12, 'ipv4');
webhookIpBlockList.addSubnet('192.168.0.0', 16, 'ipv4');
webhookIpBlockList.addAddress('::1', 'ipv6');
webhookIpBlockList.addSubnet('fe80::', 10, 'ipv6');
webhookIpBlockList.addSubnet('fc00::', 7, 'ipv6');

const SAFETY_DISCLAIMERS = {
  publish: 'By publishing, you confirm that the content does not include contact information, precise location, or anything that violates the Terms of Service. Published content is visible to all authenticated nodes on the marketplace.',
  offer: 'By creating or countering an offer, you agree to the Terms of Service. Contact information is only revealed after both parties accept. Settlement and fulfillment happen off-platform between participants. Fabric does not hold funds, intermediate payment, or provide escrow.',
  reveal: 'Contact information shown here is user-provided and unverified. Settlement and fulfillment happen entirely off-platform between participants. Fabric does not hold funds, intermediate payment, or guarantee fulfillment. Exercise appropriate due diligence.',
};

export function __setWebhookDnsLookupForTests(lookupFn: DnsLookupAll | null | undefined) {
  webhookDnsLookup = lookupFn ?? (dnsLookup as DnsLookupAll);
}

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
    messaging_handles?: Array<{ kind: string; handle: string; url: string | null }>;
    legal_version: string;
    legal_ip: string | null;
    legal_user_agent: string | null;
  }) {
    try {
      const messagingHandles = normalizeMessagingHandles(payload.messaging_handles);
      const node = await repo.createNode(payload.display_name, normalizeEmail(payload.email), payload.recovery_public_key, messagingHandles, {
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
          messaging_handles: messagingHandles,
          event_webhook_url: null,
          status: 'ACTIVE',
          plan: 'free',
          is_subscriber: false,
          created_at: node.created_at,
        },
        api_key: { key_id: apiKey.id, api_key: apiKey.api_key, created_at: apiKey.created_at },
        credits: { granted: config.signupGrantCredits, reason: 'SIGNUP_GRANT' },
        setup_incomplete: {
          event_webhook_url: 'Configure a webhook URL via PATCH /v1/me to receive real-time offer and subscription events. Without webhooks you must poll GET /v1/events, which adds latency and credit cost.',
        },
      };
    } catch (err: any) {
      if (isDisplayNameTakenError(err)) return { validationError: 'display_name_taken' };
      throw err;
    }
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
  async createCreditPackCheckoutSession(
    authedNodeId: string,
    payload: { node_id: string; pack_code: string; success_url: string; cancel_url: string },
    idempotencyKey: string | null,
  ) {
    if (payload.node_id !== authedNodeId) return { forbidden: true };
    const pack = creditPackQuoteByCode(payload.pack_code);
    if (!pack) return { validationError: 'unsupported_pack_code' };
    if (!pack.stripe_price_id) return { validationError: 'missing_credit_pack_price_mapping', pack_code: pack.pack_code };
    const missingStripeEnvVars = missingStripeCheckoutCoreEnvVars();
    if (missingStripeEnvVars.length > 0) {
      return { validationError: 'stripe_not_configured', missing: missingStripeEnvVars };
    }

    const checkoutSession = await createStripeCreditPackCheckoutSession({
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
    const incomplete: Record<string, string> = {};
    if (!me.event_webhook_url) {
      incomplete.event_webhook_url = 'Configure a webhook URL via PATCH /v1/me to receive real-time offer and subscription events instead of polling.';
    }
    if (!me.email) {
      incomplete.email = 'Add an email via PATCH /v1/me so counterparties can reach you after mutual acceptance.';
    }
    const result: Record<string, unknown> = {
      node: {
        id: me.id,
        display_name: me.display_name,
        email: me.email,
        email_verified_at: me.email_verified_at,
        recovery_public_key_configured: Boolean(me.recovery_public_key),
        messaging_handles: normalizeMessagingHandles(me.messaging_handles),
        event_webhook_url: me.event_webhook_url ?? null,
        status: me.status,
        plan: responsePlan,
        is_subscriber: me.sub_status === 'active',
        created_at: me.created_at,
      },
      subscription: { plan: responsePlan, status: me.sub_status, period_start: me.current_period_start, period_end: me.current_period_end, credits_rollover_enabled: true },
      credits_balance: balance,
    };
    if (Object.keys(incomplete).length > 0) {
      result.setup_incomplete = incomplete;
    }
    return result;
  },
  async patchMe(nodeId: string, payload: {
    display_name?: string | null;
    email?: string | null;
    recovery_public_key?: string | null;
    messaging_handles?: Array<{ kind: string; handle: string; url: string | null }> | null;
    event_webhook_url?: string | null;
    event_webhook_secret?: string | null;
  }) {
    const normalizedWebhookUrl = await normalizeWebhookUrl(payload.event_webhook_url);
    if (normalizedWebhookUrl.validationError) return { validationError: normalizedWebhookUrl.validationError };
    const normalizedWebhookSecret = normalizeWebhookSecretInput(payload.event_webhook_secret);
    if (normalizedWebhookSecret.validationError) return { validationError: normalizedWebhookSecret.validationError };

    try {
      await repo.updateMe(
        nodeId,
        payload.display_name,
        payload.email === undefined ? undefined : normalizeEmail(payload.email),
        payload.recovery_public_key,
        payload.messaging_handles === undefined ? undefined : normalizeMessagingHandles(payload.messaging_handles),
        normalizedWebhookUrl.value,
        normalizedWebhookSecret.value,
      );
    } catch (err: any) {
      if (isDisplayNameTakenError(err)) return { validationError: 'display_name_taken' };
      throw err;
    }
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
    if (method !== 'pubkey') return { validationError: 'email_recovery_not_supported' };
    const profile = await repo.getNodeRecoveryProfile(nodeId);
    if (!profile) return { notFound: true };
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
  },
  async completeRecovery(payload: { challenge_id: string; signature?: string; code?: string }) {
    if (payload.code) return { validationError: 'email_recovery_not_supported' };
    if (!payload.signature) return { validationError: 'signature_required' };

    const challenge = await repo.getRecoveryChallenge(payload.challenge_id);
    if (!challenge) return { notFound: true };

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
    const estimatedCost = config.searchCreditCost;
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
          broadening_cost: 0,
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
  async creditsLedger(nodeId: string, limit: number, cursor: string | null) { const entries = await repo.listLedger(nodeId, limit, cursor); const last = entries.length === limit ? entries[entries.length - 1] : null; return { entries, next_cursor: last ? `${new Date(last.created_at).toISOString()}|${last.id}` : null }; },
  async createUnit(nodeId: string, payload: any) {
    const created = await repo.createUnitWithMilestoneCredits(nodeId, payload);
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
  async createRequest(nodeId: string, payload: any) {
    const request = await repo.createResource('requests', nodeId, {
      ...payload,
      expires_at: requestExpiresAtIso(payload.ttl_minutes),
    });
    await repo.grantRequestMilestoneIfEligible(nodeId, {
      threshold: config.requestMilestoneThreshold,
      creditGrant: config.requestMilestoneCreditGrant,
    });
    return { request };
  },
  listRequests(nodeId: string, limit: number, cursor: string | null) { return repo.listResources('requests', nodeId, limit, cursor); },
  getRequest(nodeId: string, id: string) { return repo.getResource('requests', nodeId, id); },
  patchRequest(nodeId: string, id: string, version: number, payload: any) {
    const nextPayload = { ...payload };
    if (payload.ttl_minutes !== undefined) nextPayload.expires_at = requestExpiresAtIso(payload.ttl_minutes);
    return repo.patchResource('requests', nodeId, id, version, nextPayload);
  },
  deleteRequest(nodeId: string, id: string) { return repo.deleteResource('requests', nodeId, id); },
  async publish(kind: 'units' | 'requests', nodeId: string, id: string) {
    if (kind === 'requests') await repo.expireStaleRequests();
    const me = await repo.getMe(nodeId);
    if (!me) return { notFound: true };
    if (me.status !== 'ACTIVE' || me.suspended_at) return { forbidden: true };
    const row = await repo.getResource(kind, nodeId, id);
    if (!row) return { notFound: true };
    if (kind === 'requests' && new Date(row.expires_at).getTime() <= Date.now()) return { validationError: 'request_expired' };
    const failure = requirePublishFields(row);
    if (failure) return { validationError: failure };
    await repo.setPublished(kind, id, true);
    const updated = await repo.getResource(kind, nodeId, id);
    await repo.upsertProjection(kind, updated);
    return kind === 'units'
      ? { projection: { kind: 'listing', source_unit_id: id, published_at: new Date().toISOString() }, disclaimer: SAFETY_DISCLAIMERS.publish }
      : { projection: { kind: 'request', source_request_id: id, published_at: new Date().toISOString() }, disclaimer: SAFETY_DISCLAIMERS.publish };
  },
  async unpublish(kind: 'units' | 'requests', _nodeId: string, id: string) { await repo.setPublished(kind, id, false); await repo.removeProjection(kind, id); return { ok: true }; },
  async search(nodeId: string, kind: 'listings' | 'requests', body: any, idemKey: string) {
    if (kind === 'requests') await repo.expireStaleRequests();
    const searchDailyLimit = await prePurchaseSearchLimit(nodeId);
    if (searchDailyLimit) return { prepurchaseDailyLimit: searchDailyLimit };
    const targetResolution = await resolveSearchTargetNode(body.target ?? null);
    if (targetResolution.validationError) return { validationError: targetResolution.validationError };
    const targetNodeId = targetResolution.targetNodeId;
    const cursorFingerprint = searchCursorFingerprint(kind, body);
    const parsedCursor = decodeSearchCursor(body?.cursor ?? null, body?.scope, cursorFingerprint);
    if (parsedCursor.validationError) return { validationError: parsedCursor.validationError };
    const baseSearchCost = targetNodeId ? config.searchTargetCreditCost : config.searchCreditCost;
    const broadeningCost = 0;
    const pageIndex = parsedCursor.pageIndex;
    const pageCost = pageAddOnCost(pageIndex);
    const totalCost = baseSearchCost + broadeningCost + pageCost;
    const creditsRequested = Number(body?.budget?.credits_requested ?? 0);
    const limit = body.limit ?? 20;

    if (totalCost > creditsRequested) {
      return {
        search_id: crypto.randomUUID(),
        scope: body.scope,
        limit,
        cursor: null,
        broadening: { level: 0, allow: false },
        applied_filters: body.filters ?? {},
        budget: {
          credits_requested: creditsRequested,
          credits_charged: 0,
          breakdown: {
            base_search_cost: baseSearchCost,
            broadening_level: 0,
            broadening_cost: broadeningCost,
            page_index: pageIndex,
            page_cost: pageCost,
            base_cost: baseSearchCost,
            pagination_addons: pageCost,
            geo_addon: 0,
          },
          coverage: {
            page_index_executed: 0,
            broadening_level_executed: 0,
            items_returned: 0,
            executed_page_index: 0,
            executed_broadening_level: 0,
            returned_count: 0,
          },
          was_capped: true,
          cap_reason: `Needed ${totalCost} credits but budget cap is ${creditsRequested}`,
          guidance: `Increase budget.credits_requested to at least ${totalCost} to execute this search page.`,
          credit_pack_hint: 'If your balance is low, purchase credits via POST /v1/billing/crypto-credit-pack (crypto) or POST /v1/billing/credit-packs/checkout-session (Stripe credit pack) or POST /v1/billing/checkout-session (subscription). Check GET /v1/credits/balance for current balance.',
        },
        items: [],
        nodes: [],
        has_more: false,
      };
    }

    const balance = await repo.creditBalance(nodeId);
    if (balance < totalCost) return { creditsExhausted: { credits_required: totalCost, credits_balance: balance } };

    const categoryIdsAny = Array.isArray(body?.filters?.category_ids_any)
      ? body.filters.category_ids_any.filter((value: unknown) => Number.isInteger(value))
      : [];
    const rows = await repo.searchPublic(
      kind,
      body.scope,
      body?.q ?? null,
      body?.filters ?? {},
      limit,
      parsedCursor.after,
      nodeId,
      targetNodeId,
      categoryIdsAny,
    );
    const creditsCharged = totalCost;

    await repo.addCredit(nodeId, pageIndex > 1 ? 'debit_search_page' : 'debit_search', -creditsCharged, { scope: body.scope }, idemKey);
    await repo.logSearch(nodeId, kind, body.scope, body.q ?? null, body.filters ?? {}, 0, creditsCharged);

    const hasMore = rows.length === limit;
    const lastRow = rows[rows.length - 1];
    const nextCursor = hasMore
      ? encodeSearchCursor(
          {
            route_specificity_score: Number(lastRow?.route_specificity_score ?? 0),
            fts_rank: Number(lastRow?.fts_rank ?? 0),
            updated_at: lastRow?.updated_at ?? null,
            id: lastRow?.entity_id ?? null,
          },
          pageIndex + 1,
          body.scope,
          cursorFingerprint,
        )
      : null;
    const items = rows.map((r) => ({
      item: r.doc,
      rank: {
        sort_keys: {
          distance_miles: null,
          route_specificity_score: Number(r.route_specificity_score ?? 0),
          fts_rank: Number(r.fts_rank ?? 0),
          recency_score: Number(r.recency_score ?? 0),
        },
      },
    }));
    const searchId = crypto.randomUUID();
    if (items.length > 0) {
      const subjectKind: 'listing' | 'request' = kind === 'listings' ? 'listing' : 'request';
      const impressions = rows.flatMap((row, idx) => {
        const itemId = typeof row?.doc?.id === 'string' ? row.doc.id : null;
        if (!itemId) return [];
        return [{
          search_id: searchId,
          viewer_node_id: nodeId,
          subject_kind: subjectKind,
          item_id: itemId,
          position: idx + 1,
          scope: String(body.scope),
        }];
      });
      if (impressions.length > 0) await repo.addSearchImpressions(impressions);
    }

    return {
      search_id: searchId,
      scope: body.scope,
      limit,
      cursor: nextCursor,
      broadening: { level: 0, allow: false },
      applied_filters: body.filters ?? {},
      budget: {
        credits_requested: creditsRequested,
        credits_charged: creditsCharged,
        breakdown: {
          base_search_cost: baseSearchCost,
          broadening_level: 0,
          broadening_cost: broadeningCost,
          page_index: pageIndex,
          page_cost: pageCost,
          base_cost: baseSearchCost,
          pagination_addons: pageCost,
          geo_addon: 0,
        },
        coverage: {
          page_index_executed: pageIndex,
          broadening_level_executed: 0,
          items_returned: items.length,
          executed_page_index: pageIndex,
          executed_broadening_level: 0,
          returned_count: items.length,
        },
        was_capped: false,
        cap_reason: null,
        guidance: null,
      },
      items,
      nodes: await summarizeSearchNodes(rows),
      has_more: hasMore,
    };
  },
  async nodePublicInventory(nodeId: string, targetNodeId: string, kind: 'listings'|'requests', limit: number, cursor: string | null) {
    if (kind === 'requests') await repo.expireStaleRequests();
    const cost = config.searchCreditCost;
    const balance = await repo.creditBalance(nodeId);
    if (balance < cost) return { creditsExhausted: { credits_required: cost, credits_balance: balance } };
    const rows = await repo.listNodePublic(targetNodeId, kind, limit, cursor);
    await repo.addCredit(nodeId, 'debit_search_page', -cost, { kind: `public_nodes_${kind}` }, null);
    const hasMore = rows.length === limit;
    const nextCursor = hasMore ? rows[rows.length - 1]?.published_at ?? null : null;
    return { node_id: targetNodeId, limit, cursor: nextCursor, items: rows.map((r) => r.doc), has_more: hasMore };
  },
  async nodePublicInventoryByCategory(
    nodeId: string,
    targetNodeId: string,
    kind: 'listings' | 'requests',
    categoryId: number,
    limit: number,
    cursor: string | null,
    creditsMax?: number,
  ) {
    if (kind === 'requests') await repo.expireStaleRequests();
    const { publishedAt, pageIndex } = decodeDrilldownCursor(cursor);
    const cost = drilldownPageCost(pageIndex);

    if (creditsMax !== undefined && cost > creditsMax) {
      return {
        budgetCapExceeded: {
          needed: cost,
          max: creditsMax,
          breakdown: { page_index: pageIndex, page_cost: cost },
        },
      };
    }

    const balance = await repo.creditBalance(nodeId);
    if (balance < cost) return { creditsExhausted: { credits_required: cost, credits_balance: balance } };
    const rows = await repo.listNodePublicByCategory(targetNodeId, kind, categoryId, limit, publishedAt);
    await repo.addCredit(nodeId, 'debit_search_page', -cost, { kind: `public_nodes_${kind}_category`, category_id: categoryId, page_index: pageIndex }, null);
    const hasMore = rows.length === limit;
    const rawPublishedAt = rows[rows.length - 1]?.published_at ?? null;
    const lastPublishedAtIso = rawPublishedAt instanceof Date
      ? rawPublishedAt.toISOString()
      : typeof rawPublishedAt === 'string'
        ? rawPublishedAt
        : null;
    const nextCursor = hasMore && lastPublishedAtIso ? encodeDrilldownCursor(lastPublishedAtIso, pageIndex + 1) : null;
    return {
      node_id: targetNodeId,
      category_id: categoryId,
      limit,
      cursor: nextCursor,
      items: rows.map((r) => r.doc),
      has_more: hasMore,
      budget: {
        credits_charged: cost,
        breakdown: { page_index: pageIndex, page_cost: cost },
      },
    };
  },
  async nodePublicCategoriesSummary(_nodeId: string, nodeIds: string[], kind: 'listings' | 'requests' | 'both') {
    if (kind === 'requests' || kind === 'both') await repo.expireStaleRequests();
    const rows = await repo.listNodeCategorySummary(nodeIds, kind);
    const summaries: Record<string, { listings?: Array<{ category_id: number; count: number }>; requests?: Array<{ category_id: number; count: number }> }> = {};
    for (const nid of nodeIds) {
      summaries[nid] = {};
      if (kind === 'listings' || kind === 'both') summaries[nid].listings = [];
      if (kind === 'requests' || kind === 'both') summaries[nid].requests = [];
    }
    for (const row of rows) {
      if (!summaries[row.node_id]) summaries[row.node_id] = {};
      if (row.kind === 'listings') {
        (summaries[row.node_id].listings ??= []).push({ category_id: row.category_id, count: row.count });
      } else {
        (summaries[row.node_id].requests ??= []).push({ category_id: row.category_id, count: row.count });
      }
    }
    return { summaries };
  },
  async listEvents(nodeId: string, sinceCursor: string | null, limit: number) {
    const decoded = decodeEventCursor(sinceCursor);
    if (sinceCursor && !decoded) return { validationError: 'invalid_since_cursor' };
    const rows = await repo.listOfferLifecycleEvents(nodeId, limit, decoded);
    const events = rows.map((row) => ({
      id: row.id,
      type: row.event_type,
      offer_id: row.offer_id,
      actor_node_id: row.actor_node_id,
      recipient_node_id: row.recipient_node_id,
      payload: row.payload ?? {},
      created_at: row.created_at,
    }));
    const last = rows[rows.length - 1];
    return {
      events,
      next_cursor: rows.length === limit && last ? encodeEventCursor(last.created_at, last.id) : null,
    };
  },
  async adminDailyMetrics() {
    return repo.getDailyMetricsSnapshot(24);
  },
  async adminHealthPulse() {
    return repo.getHealthPulse(15);
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
    note: offer.note ?? null,
    accepted_by_from_at: offer.accepted_by_from_at,
    accepted_by_to_at: offer.accepted_by_to_at,
    held_unit_ids: hold.held_unit_ids,
    unheld_unit_ids: hold.unheld_unit_ids,
    hold_status: hold.hold_status,
    hold_expires_at: hold.hold_expires_at,
    expires_at: offer.expires_at,
    created_at: offer.created_at,
    updated_at: offer.updated_at,
    version: offer.row_version,
    unit_ids: lines.map((l) => l.unit_id),
  };
}

const OFFER_TTL_MINUTES_DEFAULT = 48 * 60;
const OFFER_TTL_MINUTES_MIN = 15;
const OFFER_TTL_MINUTES_MAX = 7 * 24 * 60;
// Temporarily set to 365 days to build marketplace density during early growth.
// Once request volume reaches critical mass, reduce to:
//   DEFAULT = 7 * 24 * 60  (7 days)
//   MAX     = 30 * 24 * 60 (30 days)
const REQUEST_TTL_MINUTES_DEFAULT = 365 * 24 * 60;
const REQUEST_TTL_MINUTES_MIN = 60;
const REQUEST_TTL_MINUTES_MAX = 365 * 24 * 60;

const PREPURCHASE_DAILY_SEARCH_LIMIT = 20;
const PREPURCHASE_DAILY_OFFER_CREATE_LIMIT = 3;
const PREPURCHASE_DAILY_OFFER_ACCEPT_LIMIT = 1;

(fabricService as any).createOffer = async (
  nodeId: string,
  unitIds: string[],
  threadId: string | null,
  note: string | null,
  ttlMinutes: number | undefined,
  options: { skipPrepurchaseDailyLimit?: boolean } = {},
) => {
  if (!(await hasCurrentLegalAssent(nodeId))) return { legalRequired: true };
  const owners = await repo.getUnitsOwners(unitIds);
  if (owners.length !== unitIds.length) return { conflict: 'invalid_units' };
  const uniqueOwners = new Set(owners.map((u) => u.node_id));
  if (uniqueOwners.size !== 1) return { conflict: 'multiple_owners' };
  const ownerByUnitId = new Map(owners.map((u) => [u.id, u.node_id]));
  const toNodeId = owners[0].node_id;
  if (!options.skipPrepurchaseDailyLimit) {
    const prepurchaseDailyLimit = await prePurchaseOfferCreateLimit(nodeId);
    if (prepurchaseDailyLimit) return { prepurchaseDailyLimit };
  }
  const th = threadId ?? crypto.randomUUID();
  const offerExpiresAt = offerExpiresAtIso(ttlMinutes);
  const offer = await repo.createOffer(nodeId, toNodeId, unitIds[0], th, note, offerExpiresAt);
  const offerExpiresAtIsoValue = toIsoString(offer.expires_at) ?? offerExpiresAt;
  const held: string[] = [];
  const unheld: string[] = [];
  for (const unitId of unitIds) {
    await repo.addOfferLine(offer.id, unitId);
    const ownerNodeId = ownerByUnitId.get(unitId);
    if (ownerNodeId !== nodeId) {
      unheld.push(unitId);
      continue;
    }
    if (await repo.activeHeld(unitId)) unheld.push(unitId);
    else {
      await repo.createHold(offer.id, unitId, offerExpiresAtIsoValue);
      held.push(unitId);
    }
  }
  const sum = await offerSummary(offer);
  sum.held_unit_ids = held;
  sum.unheld_unit_ids = unheld;
  await emitOfferLifecycleEvents({
    offerId: offer.id,
    eventType: 'offer_created',
    actorNodeId: nodeId,
    fromNodeId: offer.from_node_id,
    toNodeId: offer.to_node_id,
    payload: { status: offer.status, thread_id: offer.thread_id },
  });
  return { offer: sum, disclaimer: SAFETY_DISCLAIMERS.offer };
};

(fabricService as any).counterOffer = async (
  nodeId: string,
  offerId: string,
  unitIds: string[],
  note: string | null,
  ttlMinutes: number | undefined,
) => {
  if (!(await hasCurrentLegalAssent(nodeId))) return { legalRequired: true };
  await repo.expireStaleOffers();
  const prior = await repo.getOffer(offerId);
  if (!prior) return { notFound: true };
  if (![prior.from_node_id, prior.to_node_id].includes(nodeId)) return { notFound: true };
  const prepurchaseDailyLimit = await prePurchaseOfferCreateLimit(nodeId);
  if (prepurchaseDailyLimit) return { prepurchaseDailyLimit };
  await repo.setOfferStatus(prior.id, 'countered', { countered_at: new Date().toISOString() });
  await repo.releaseHolds(prior.id);
  await emitOfferLifecycleEvents({
    offerId: prior.id,
    eventType: 'offer_countered',
    actorNodeId: nodeId,
    fromNodeId: prior.from_node_id,
    toNodeId: prior.to_node_id,
    payload: { status: 'countered', thread_id: prior.thread_id },
  });
  const next = await (fabricService as any).createOffer(nodeId, unitIds, prior.thread_id, note, ttlMinutes, { skipPrepurchaseDailyLimit: true });
  return next;
};

(fabricService as any).acceptOffer = async (nodeId: string, offerId: string) => {
  if (!(await hasCurrentLegalAssent(nodeId))) return { legalRequired: true };
  await repo.expireStaleOffers();
  const offer = await repo.getOffer(offerId);
  if (!offer) return { notFound: true };
  if (![offer.from_node_id, offer.to_node_id].includes(nodeId)) return { forbidden: true };
  if (offer.status !== 'pending' && offer.status !== 'accepted_by_a' && offer.status !== 'accepted_by_b') return { conflict: true };
  const prepurchaseDailyLimit = await prePurchaseOfferAcceptLimit(nodeId);
  if (prepurchaseDailyLimit) return { prepurchaseDailyLimit };
  if (offer.to_node_id === nodeId) {
    const holdLock = await ensureSellerOwnedHolds(offerId, nodeId, toIsoString(offer.expires_at) ?? offerExpiresAtIso(undefined));
    if (!holdLock.ok) return { conflict: true };
  }
  const byFrom = offer.from_node_id === nodeId;
  if (byFrom) {
    if (offer.accepted_by_to_at) {
      const finalized = await repo.finalizeOfferMutualAcceptanceWithFees(
        offerId,
        'from',
        config.dealAcceptanceFeeCredits,
      );
      if ((finalized as any).notFound) return { notFound: true };
      if ((finalized as any).conflict) return { conflict: true };
      if ((finalized as any).creditsExhausted) return { creditsExhausted: (finalized as any).creditsExhausted };
      const updated = (finalized as any).offer;
      await emitOfferLifecycleEvents({
        offerId: updated.id,
        eventType: 'offer_accepted',
        actorNodeId: nodeId,
        fromNodeId: updated.from_node_id,
        toNodeId: updated.to_node_id,
        payload: { status: updated.status, thread_id: updated.thread_id },
      });
      return { offer: await offerSummary(updated) };
    }
    const updated = await repo.setOfferStatus(offerId, 'accepted_by_a', { accepted_by_from_at: new Date().toISOString() });
    await emitOfferLifecycleEvents({
      offerId: updated.id,
      eventType: 'offer_accepted',
      actorNodeId: nodeId,
      fromNodeId: updated.from_node_id,
      toNodeId: updated.to_node_id,
      payload: { status: updated.status, thread_id: updated.thread_id },
    });
    return { offer: await offerSummary(updated) };
  }
  if (offer.accepted_by_from_at) {
    const finalized = await repo.finalizeOfferMutualAcceptanceWithFees(
      offerId,
      'to',
      config.dealAcceptanceFeeCredits,
    );
    if ((finalized as any).notFound) return { notFound: true };
    if ((finalized as any).conflict) return { conflict: true };
    if ((finalized as any).creditsExhausted) return { creditsExhausted: (finalized as any).creditsExhausted };
    const updated = (finalized as any).offer;
    await emitOfferLifecycleEvents({
      offerId: updated.id,
      eventType: 'offer_accepted',
      actorNodeId: nodeId,
      fromNodeId: updated.from_node_id,
      toNodeId: updated.to_node_id,
      payload: { status: updated.status, thread_id: updated.thread_id },
    });
    return { offer: await offerSummary(updated) };
  }
  const updated = await repo.setOfferStatus(offerId, 'accepted_by_b', { accepted_by_to_at: new Date().toISOString() });
  await emitOfferLifecycleEvents({
    offerId: updated.id,
    eventType: 'offer_accepted',
    actorNodeId: nodeId,
    fromNodeId: updated.from_node_id,
    toNodeId: updated.to_node_id,
    payload: { status: updated.status, thread_id: updated.thread_id },
  });
  return { offer: await offerSummary(updated) };
};

(fabricService as any).rejectOffer = async (nodeId: string, offerId: string) => {
  await repo.expireStaleOffers();
  const offer = await repo.getOffer(offerId);
  if (!offer) return { notFound: true };
  if (![offer.from_node_id, offer.to_node_id].includes(nodeId)) return { forbidden: true };
  const updated = await repo.setOfferStatus(offerId, 'rejected', { rejected_at: new Date().toISOString() });
  await repo.releaseHolds(offerId);
  return { offer: await offerSummary(updated) };
};

(fabricService as any).cancelOffer = async (nodeId: string, offerId: string) => {
  if (!(await hasCurrentLegalAssent(nodeId))) return { legalRequired: true };
  await repo.expireStaleOffers();
  const offer = await repo.getOffer(offerId);
  if (!offer) return { notFound: true };
  if (offer.from_node_id !== nodeId) return { forbidden: true };
  const updated = await repo.setOfferStatus(offerId, 'cancelled', { cancelled_at: new Date().toISOString() });
  await repo.releaseHolds(offerId);
  await emitOfferLifecycleEvents({
    offerId: updated.id,
    eventType: 'offer_cancelled',
    actorNodeId: nodeId,
    fromNodeId: updated.from_node_id,
    toNodeId: updated.to_node_id,
    payload: { status: updated.status, thread_id: updated.thread_id },
  });
  return { offer: await offerSummary(updated) };
};

(fabricService as any).listOffers = async (nodeId: string, role: 'made' | 'received', limit: number, cursor: string | null) => {
  await repo.expireStaleOffers();
  const offers = await repo.listOffers(nodeId, role, limit, cursor);
  return { offers: await Promise.all(offers.map((o) => offerSummary(o))) };
};

(fabricService as any).getOffer = async (nodeId: string, offerId: string) => {
  await repo.expireStaleOffers();
  const offer = await repo.getOffer(offerId);
  if (!offer) return null;
  if (![offer.from_node_id, offer.to_node_id].includes(nodeId)) return null;
  return { offer: await offerSummary(offer) };
};

(fabricService as any).revealContact = async (nodeId: string, offerId: string) => {
  if (!(await hasCurrentLegalAssent(nodeId))) return { legalRequired: true };
  await repo.expireStaleOffers();
  const offer = await repo.getOffer(offerId);
  if (!offer) return { notFound: true };
  if (offer.status !== 'mutually_accepted') return { notAccepted: true };
  if (![offer.from_node_id, offer.to_node_id].includes(nodeId)) return { forbidden: true };
  const from = await repo.getMe(offer.from_node_id);
  const to = await repo.getMe(offer.to_node_id);
  const revealNode = offer.from_node_id === nodeId ? to : from;
  const messagingHandles = normalizeMessagingHandles(revealNode.messaging_handles);
  await repo.addContactReveal(offerId, nodeId, revealNode.id, revealNode.email, revealNode.phone, messagingHandles);
  await emitOfferLifecycleEvents({
    offerId: offer.id,
    eventType: 'offer_contact_revealed',
    actorNodeId: nodeId,
    fromNodeId: offer.from_node_id,
    toNodeId: offer.to_node_id,
    payload: { status: offer.status, thread_id: offer.thread_id },
  });
  return { contact: { email: revealNode.email ?? '', phone: revealNode.phone ?? null, messaging_handles: messagingHandles }, disclaimer: SAFETY_DISCLAIMERS.reveal };
};

(fabricService as any).getMyReferralCode = async (nodeId: string) => {
  const code = await repo.getOrCreateReferralCode(nodeId);
  return { referral_code: code };
};

(fabricService as any).getMyReferralStats = async (nodeId: string) => {
  const code = await repo.getOrCreateReferralCode(nodeId);
  const stats = await repo.getReferralStats(nodeId);
  return {
    referral_code: code,
    total_referrals: Number(stats?.total_claims ?? 0),
    awarded: Number(stats?.awarded_claims ?? 0),
    pending: Number(stats?.pending_claims ?? 0),
    credits_earned: Number(stats?.total_credits_earned ?? 0),
    cap: config.referralMaxGrantsPerReferrer,
    remaining: Math.max(0, config.referralMaxGrantsPerReferrer - Number(stats?.awarded_claims ?? 0)),
  };
};

(fabricService as any).claimReferral = async (nodeId: string, referralCode: string) => {
  const code = await repo.findReferralCode(referralCode);
  if (!code || !code.active) return { invalid: true };
  if (await repo.hasPaidStripeEvent(nodeId)) return { locked: true };
  if (await repo.hasReferralClaim(nodeId)) return { already: true, referrer_node_id: code.issuer_node_id };
  await repo.createReferralClaim(referralCode, nodeId, code.issuer_node_id);
  return { ok: true, referrer_node_id: code.issuer_node_id };
};

const planCredits: Record<string, number> = { free: 0, basic: 1000, pro: 3000, business: 10000 };
const freeLikePlans = new Set(['free', 'none']);
const creditsQuoteCache = new Map<string, { expiresAtMs: number; value: any }>();
const CREDITS_QUOTE_CACHE_TTL_MS = 60 * 1000;

type CreditPackQuote = {
  pack_code: string;
  name: string;
  credits: number;
  price_cents: number;
  currency: 'usd';
  stripe_price_id: string | null;
};

export function creditPackQuotes(): CreditPackQuote[] {
  return [
    {
      pack_code: 'credits_500',
      name: '500 Credit Pack',
      credits: config.creditPack500Credits,
      price_cents: config.creditPack500PriceCents,
      currency: 'usd',
      stripe_price_id: nonEmptyString(config.stripeCreditPackPrice500),
    },
    {
      pack_code: 'credits_1500',
      name: '1500 Credit Pack',
      credits: config.creditPack1500Credits,
      price_cents: config.creditPack1500PriceCents,
      currency: 'usd',
      stripe_price_id: nonEmptyString(config.stripeCreditPackPrice1500),
    },
    {
      pack_code: 'credits_4500',
      name: '4500 Credit Pack',
      credits: config.creditPack4500Credits,
      price_cents: config.creditPack4500PriceCents,
      currency: 'usd',
      stripe_price_id: nonEmptyString(config.stripeCreditPackPrice4500),
    },
  ];
}

export function creditPackQuoteByCode(packCode: string | null | undefined) {
  if (!packCode) return null;
  const normalized = packCode.trim().toLowerCase();
  return creditPackQuotes().find((pack) => pack.pack_code === normalized) ?? null;
}

async function ensureSellerOwnedHolds(offerId: string, sellerNodeId: string, offerExpiresAt: string) {
  const lines = await repo.getOfferLines(offerId);
  if (lines.length === 0) return { ok: true };
  const unitIds = lines.map((line) => line.unit_id);
  const owners = await repo.getUnitsOwners(unitIds);
  const ownerByUnitId = new Map(owners.map((owner) => [owner.id, owner.node_id]));
  for (const unitId of unitIds) {
    if (ownerByUnitId.get(unitId) !== sellerNodeId) {
      return { ok: false };
    }
    if (await repo.activeHeld(unitId)) continue;
    await repo.createHold(offerId, unitId, offerExpiresAt);
  }
  return { ok: true };
}

const SEARCH_CURSOR_PREFIX = 'pg1:';
const OFFER_EVENT_CURSOR_PREFIX = 'ev1:';

function searchCursorFingerprint(kind: 'listings' | 'requests', body: any) {
  const fingerprintPayload = {
    kind,
    scope: body?.scope ?? null,
    q: typeof body?.q === 'string' ? body.q.trim() : body?.q ?? null,
    filters: body?.filters ?? {},
    target: body?.target ?? null,
  };
  return crypto.createHash('sha256').update(stableStringify(fingerprintPayload)).digest('hex');
}

function stableStringify(value: any): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, val]) => `${JSON.stringify(key)}:${stableStringify(val)}`).join(',')}}`;
}

function decodeSearchCursor(
  cursor: string | null | undefined,
  expectedScope: string,
  expectedFingerprint: string,
): {
  after: repo.SearchAfterTuple | null;
  pageIndex: number;
  validationError?: 'invalid_cursor' | 'cursor_mismatch';
} {
  if (cursor == null || cursor === '') return { after: null, pageIndex: 1 };
  if (typeof cursor !== 'string' || !cursor.startsWith(SEARCH_CURSOR_PREFIX)) {
    return { after: null, pageIndex: 1, validationError: 'invalid_cursor' };
  }

  const encoded = cursor.slice(SEARCH_CURSOR_PREFIX.length);
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const pageIndex = Number(parsed?.p);
    if (!Number.isInteger(pageIndex) || pageIndex < 2) {
      return { after: null, pageIndex: 1, validationError: 'invalid_cursor' };
    }

    if (typeof parsed?.s !== 'string' || typeof parsed?.f !== 'string') {
      return { after: null, pageIndex: 1, validationError: 'invalid_cursor' };
    }
    if (parsed.s !== expectedScope || parsed.f !== expectedFingerprint) {
      return { after: null, pageIndex: 1, validationError: 'cursor_mismatch' };
    }

    const rawAfter = parsed?.a;
    const rawId = rawAfter?.id;
    const rawUpdatedAt = rawAfter?.updated_at;
    const rawFtsRank = Number(rawAfter?.fts_rank);
    const rawRouteScore = Number(rawAfter?.route_specificity_score ?? 0);
    const normalizedUpdatedAt = rawUpdatedAt instanceof Date
      ? rawUpdatedAt.toISOString()
      : typeof rawUpdatedAt === 'string'
        ? rawUpdatedAt
        : null;
    if (
      typeof rawId !== 'string'
      || !normalizedUpdatedAt
      || Number.isNaN(Date.parse(normalizedUpdatedAt))
      || !Number.isFinite(rawFtsRank)
      || !Number.isFinite(rawRouteScore)
    ) {
      return { after: null, pageIndex: 1, validationError: 'invalid_cursor' };
    }

    return {
      after: {
        id: rawId,
        updated_at: normalizedUpdatedAt,
        fts_rank: rawFtsRank,
        route_specificity_score: rawRouteScore,
      },
      pageIndex,
    };
  } catch {
    return { after: null, pageIndex: 1, validationError: 'invalid_cursor' };
  }
}

function encodeSearchCursor(
  after: { route_specificity_score: number; fts_rank: number; updated_at: unknown; id: unknown },
  nextPageIndex: number,
  scope: string,
  fingerprint: string,
): string | null {
  const asIso = after.updated_at instanceof Date
    ? after.updated_at.toISOString()
    : typeof after.updated_at === 'string'
      ? after.updated_at
      : null;
  if (
    !Number.isInteger(nextPageIndex)
    || nextPageIndex < 2
    || typeof scope !== 'string'
    || typeof fingerprint !== 'string'
    || typeof after.id !== 'string'
    || !asIso
    || Number.isNaN(Date.parse(asIso))
    || !Number.isFinite(Number(after.fts_rank))
    || !Number.isFinite(Number(after.route_specificity_score))
  ) {
    return null;
  }
  const payload = JSON.stringify({
    v: 2,
    s: scope,
    f: fingerprint,
    p: nextPageIndex,
    a: {
      id: after.id,
      updated_at: asIso,
      fts_rank: Number(after.fts_rank),
      route_specificity_score: Number(after.route_specificity_score),
    },
  });
  return `${SEARCH_CURSOR_PREFIX}${Buffer.from(payload, 'utf8').toString('base64url')}`;
}

function pageAddOnCost(pageIndex: number) {
  if (pageIndex <= 1) return 0;
  if (pageIndex >= config.searchPageProhibitiveFrom) return config.searchPageProhibitiveCost;
  return pageIndex;
}

const DRILLDOWN_CURSOR_PREFIX = 'dd1:';

function encodeDrilldownCursor(publishedAt: string, nextPage: number): string {
  return `${DRILLDOWN_CURSOR_PREFIX}${Buffer.from(JSON.stringify({ pa: publishedAt, p: nextPage }), 'utf8').toString('base64url')}`;
}

function decodeDrilldownCursor(cursor: string | null): { publishedAt: string | null; pageIndex: number } {
  if (!cursor) return { publishedAt: null, pageIndex: 1 };
  if (cursor.startsWith(DRILLDOWN_CURSOR_PREFIX)) {
    try {
      const parsed = JSON.parse(Buffer.from(cursor.slice(DRILLDOWN_CURSOR_PREFIX.length), 'base64url').toString('utf8'));
      if (typeof parsed.pa === 'string' && Number.isInteger(parsed.p) && parsed.p >= 2) {
        return { publishedAt: parsed.pa, pageIndex: parsed.p };
      }
    } catch { /* fall through */ }
    return { publishedAt: null, pageIndex: 1 };
  }
  // Legacy: treat raw string as published_at (page 2 for continuity)
  return { publishedAt: cursor, pageIndex: 2 };
}

function drilldownPageCost(pageIndex: number): number {
  return pageIndex < config.drilldownHighCostPageFrom
    ? config.nodeCategoryDrilldownCost
    : config.nodeCategoryDrilldownHighCost;
}

async function resolveSearchTargetNode(rawTarget: any): Promise<{ targetNodeId: string | null; validationError?: 'target_mismatch' | 'target_not_found' }> {
  if (!rawTarget) return { targetNodeId: null };

  const rawNodeId = typeof rawTarget.node_id === 'string' ? rawTarget.node_id : null;
  const rawUsername = typeof rawTarget.username === 'string' ? rawTarget.username.trim() : null;
  const hasNodeId = Boolean(rawNodeId);
  const hasUsername = Boolean(rawUsername);

  if (!hasNodeId && !hasUsername) return { targetNodeId: null, validationError: 'target_not_found' };

  const nodeById = hasNodeId ? await repo.findActiveNodeById(rawNodeId!) : null;
  if (hasNodeId && !nodeById) return { targetNodeId: null, validationError: 'target_not_found' };

  const nodeByUsername = hasUsername ? await repo.findActiveNodeByUsername(rawUsername!) : null;
  if (hasUsername && !nodeByUsername) return { targetNodeId: null, validationError: 'target_not_found' };

  if (nodeById && nodeByUsername && nodeById.id !== nodeByUsername.id) {
    return { targetNodeId: null, validationError: 'target_mismatch' };
  }

  return { targetNodeId: nodeById?.id ?? nodeByUsername?.id ?? null };
}

async function summarizeSearchNodes(rows: any[]) {
  const perNode = new Map<string, Map<string, number>>();

  for (const row of rows) {
    const nodeId = typeof row?.node_id === 'string'
      ? row.node_id
      : typeof row?.doc?.node_id === 'string'
        ? row.doc.node_id
        : null;
    if (!nodeId) continue;

    let categoryCounts = perNode.get(nodeId);
    if (!categoryCounts) {
      categoryCounts = new Map<string, number>();
      perNode.set(nodeId, categoryCounts);
    }

    const categoryIds = Array.isArray(row?.doc?.category_ids) ? row.doc.category_ids : [];
    for (const categoryId of categoryIds) {
      if (categoryId === null || categoryId === undefined) continue;
      const key = String(categoryId);
      if (!key) continue;
      categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1);
    }
  }

  const nodeIds = [...perNode.keys()];
  const displayNames = await repo.getNodeDisplayNames(nodeIds);

  return [...perNode.entries()]
    .map(([nodeId, categoryCounts]) => ({
      node_id: nodeId,
      display_name: displayNames.get(nodeId) ?? null,
      category_counts_nonzero: Object.fromEntries([...categoryCounts.entries()].filter(([, count]) => count > 0)),
    }))
    .sort((a, b) => a.node_id.localeCompare(b.node_id));
}

function isDisplayNameTakenError(err: any) {
  return err?.code === '23505' && err?.constraint === 'nodes_display_name_unique_idx';
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

  if (!nonEmptyString(config.stripeCreditPackPrice500)) missing.add('STRIPE_CREDIT_PACK_PRICE_500');
  if (!nonEmptyString(config.stripeCreditPackPrice1500)) missing.add('STRIPE_CREDIT_PACK_PRICE_1500');
  if (!nonEmptyString(config.stripeCreditPackPrice4500)) missing.add('STRIPE_CREDIT_PACK_PRICE_4500');

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

function isBlockedWebhookIp(address: string) {
  const family = net.isIP(address);
  if (family === 4) return webhookIpBlockList.check(address, 'ipv4');
  if (family === 6) return webhookIpBlockList.check(address, 'ipv6');
  return false;
}

async function normalizeWebhookUrl(value: string | null | undefined): Promise<{ value: string | null | undefined; validationError?: string }> {
  if (value === undefined) return { value: undefined };
  if (value === null) return { value: null };
  if (typeof value !== 'string') return { value: undefined, validationError: 'event_webhook_url_invalid' };

  const normalized = value.trim();
  if (!normalized) return { value: undefined, validationError: 'event_webhook_url_invalid' };
  if (normalized.length > 2048) return { value: undefined, validationError: 'event_webhook_url_too_long' };

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    return { value: undefined, validationError: 'event_webhook_url_invalid' };
  }

  if (parsed.protocol !== 'https:') return { value: undefined, validationError: 'event_webhook_url_https_required' };
  if (parsed.username || parsed.password) return { value: undefined, validationError: 'event_webhook_url_auth_not_allowed' };
  if (parsed.hash) return { value: undefined, validationError: 'event_webhook_url_fragment_not_allowed' };

  const hostname = parsed.hostname.trim().toLowerCase();
  if (!hostname) return { value: undefined, validationError: 'event_webhook_url_invalid' };
  if (hostname === 'localhost') return { value: undefined, validationError: 'event_webhook_url_ssrf_blocked' };

  if (net.isIP(hostname) > 0) {
    if (isBlockedWebhookIp(hostname)) return { value: undefined, validationError: 'event_webhook_url_ssrf_blocked' };
    return { value: normalized };
  }

  try {
    const resolved = await webhookDnsLookup(hostname, { all: true, verbatim: true });
    if (resolved.some((entry) => isBlockedWebhookIp(entry.address))) {
      return { value: undefined, validationError: 'event_webhook_url_ssrf_blocked' };
    }
  } catch {
    // Keep validation deterministic in offline/test environments while still checking
    // resolved addresses whenever DNS data is available.
  }

  return { value: normalized };
}

function normalizeWebhookSecretInput(value: string | null | undefined): { value: string | null | undefined; validationError?: string } {
  if (value === undefined) return { value: undefined };
  if (value === null) return { value: null };
  if (typeof value !== 'string') return { value: undefined, validationError: 'event_webhook_secret_invalid' };
  const normalized = value.trim();
  if (!normalized) return { value: undefined, validationError: 'event_webhook_secret_invalid' };
  if (normalized.length > 256) return { value: undefined, validationError: 'event_webhook_secret_too_long' };
  return { value: normalized };
}

function normalizeWebhookSecret(value: string | null | undefined) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function signEventWebhookBody(secret: string, timestamp: string, rawBody: string) {
  return crypto.createHmac('sha256', secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex');
}

function nextWebhookRetryDelayMs(attemptNumber: number) {
  const safeAttempt = Number.isFinite(attemptNumber) && attemptNumber > 0 ? attemptNumber : 1;
  const safeBase = Math.max(1, config.eventWebhookRetryBaseMs);
  const safeMax = Math.max(safeBase, config.eventWebhookRetryMaxMs);
  const exponential = safeBase * (2 ** Math.max(0, safeAttempt - 1));
  return Math.min(safeMax, exponential);
}

function recoveryCode() {
  return String(crypto.randomInt(100000, 1000000));
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

async function createStripeCreditPackCheckoutSession(payload: {
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
  form.set('metadata[pack_code]', payload.packCode);
  form.set('metadata[pack_credits]', String(payload.credits));

  const headers: Record<string, string> = {
    Authorization: `Bearer ${config.stripeSecretKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (payload.idempotencyKey) headers['Idempotency-Key'] = `fabric_credit_pack:${payload.nodeId}:${payload.idempotencyKey}`;

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

function creditPackFromStripeEventObject(object: any) {
  const packCode = nonEmptyString(object?.metadata?.pack_code ?? object?.metadata?.topup_pack_code ?? null);
  return creditPackQuoteByCode(packCode);
}

function creditPackPaymentReference(object: any) {
  return nonEmptyString(stripeId(object?.payment_intent))
    ?? nonEmptyString(stripeId(object?.invoice))
    ?? nonEmptyString(stripeId(object?.id));
}

function creditPackIdempotencyKey(paymentReference: string) {
  if (paymentReference.startsWith('pi_')) return `credit_pack:payment_intent:${paymentReference}`;
  if (paymentReference.startsWith('in_')) return `credit_pack:invoice:${paymentReference}`;
  return `credit_pack:session:${paymentReference}`;
}

async function applyCreditPackGrant(nodeId: string, eventType: string, eventObject: any) {
  const pack = creditPackFromStripeEventObject(eventObject);
  if (!pack) return { handled: false, reason: 'not_credit_pack_event' as const };
  if (eventType === 'checkout.session.completed') {
    const paymentStatus = nonEmptyString(eventObject?.payment_status);
    if (paymentStatus !== 'paid') {
      return { handled: true, applied: false, reason: 'credit_pack_payment_not_paid' as const, pack_code: pack.pack_code };
    }
  }

  const paymentReference = creditPackPaymentReference(eventObject);
  if (!paymentReference) return { handled: true, applied: false, reason: 'credit_pack_missing_payment_reference' as const, pack_code: pack.pack_code };

  const grantsToday = await repo.countCreditPackPurchasesSince(nodeId, utcDayStartIso());
  if (grantsToday >= config.creditPackMaxGrantsPerDay) {
    return {
      handled: true,
      applied: false,
      reason: 'credit_pack_velocity_limit_exceeded' as const,
      pack_code: pack.pack_code,
      payment_reference: paymentReference,
      grants_today: grantsToday,
      max_grants_per_day: config.creditPackMaxGrantsPerDay,
    };
  }

  const inserted = await repo.addCreditIdempotent(
    nodeId,
    'topup_purchase',
    pack.credits,
    { pack_code: pack.pack_code, payment_reference: paymentReference, event_type: eventType },
    creditPackIdempotencyKey(paymentReference),
  );
  return {
    handled: true,
    applied: inserted,
    reason: inserted ? 'credit_pack_granted' as const : 'credit_pack_idempotent_replay' as const,
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
    const creditPackResult = await applyCreditPackGrant(nodeId, type, object);
    if (creditPackResult.handled) {
      if (!creditPackResult.applied && creditPackResult.reason === 'credit_pack_velocity_limit_exceeded') {
        console.warn(JSON.stringify({
          msg: 'credit pack velocity limit exceeded',
          node_id: nodeId,
          pack_code: creditPackResult.pack_code,
          payment_reference: creditPackResult.payment_reference,
          grants_today: creditPackResult.grants_today,
          max_grants_per_day: creditPackResult.max_grants_per_day,
        }));
      }
      if (creditPackResult.applied) {
        const ref = creditPackResult.payment_reference ?? `checkout:${stripeId(object?.id) ?? 'unknown'}`;
        await repo.awardReferralFirstPaid(nodeId, 100, `credit_pack:${ref}`, config.referralMaxGrantsPerReferrer, {
          invoice_id: null,
          stripe_subscription_id: null,
        });
      }
      return { mapped: true, node_id: nodeId, mapping_source: mapping.source, event_type: type, credit_pack: creditPackResult };
    }
    const paymentStatus = nonEmptyString(object?.payment_status);
    if (paymentStatus !== 'paid') {
      const existing = await repo.getMe(nodeId);
      const existingPlan = normalizePlanCode(existing?.plan_code) ?? 'free';
      const existingStatus = nonEmptyString(existing?.sub_status) ?? 'none';
      await repo.upsertSubscription(
        nodeId,
        planCodeForStorage(existingPlan),
        existingStatus,
        existing?.current_period_start ?? null,
        existing?.current_period_end ?? null,
        stripeCustomerId,
        stripeSubscriptionId,
      );
      return {
        mapped: true,
        node_id: nodeId,
        mapping_source: mapping.source,
        event_type: type,
        subscription_pending: {
          node_id: nodeId,
          payment_status: paymentStatus ?? 'unknown',
          stripe_subscription_id: stripeSubscriptionId,
        },
      };
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
    const creditPackResult = await applyCreditPackGrant(nodeId, type, object);
    if (creditPackResult.handled) {
      if (!creditPackResult.applied && creditPackResult.reason === 'credit_pack_velocity_limit_exceeded') {
        console.warn(JSON.stringify({
          msg: 'credit pack velocity limit exceeded',
          node_id: nodeId,
          pack_code: creditPackResult.pack_code,
          payment_reference: creditPackResult.payment_reference,
          grants_today: creditPackResult.grants_today,
          max_grants_per_day: creditPackResult.max_grants_per_day,
        }));
      }
      if (creditPackResult.applied) {
        const ref = creditPackResult.payment_reference ?? `invoice:${invoiceIdForIdempotency(object) ?? 'unknown'}`;
        await repo.awardReferralFirstPaid(nodeId, 100, `credit_pack:${ref}`, config.referralMaxGrantsPerReferrer, {
          invoice_id: invoiceIdForIdempotency(object) ?? null,
          stripe_subscription_id: null,
        });
      }
      return { mapped: true, node_id: nodeId, mapping_source: mapping.source, event_type: type, credit_pack: creditPackResult };
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
      const monthlyAmount = planCredits[effectivePlan] ?? 0;
      const rolloverCap = monthlyAmount * 2;
      const subCreditBalance = await repo.subscriptionCreditBalance(nodeId);
      const grantAmount = rolloverCap > 0 ? Math.max(0, Math.min(monthlyAmount, rolloverCap - subCreditBalance)) : monthlyAmount;
      if (grantAmount > 0) {
        await repo.addCredit(nodeId, 'grant_subscription_monthly', grantAmount, { period_start: periodStart, full_amount: monthlyAmount, capped_by_rollover: grantAmount < monthlyAmount });
      } else {
        await repo.addCredit(nodeId, 'grant_subscription_monthly', 0, { period_start: periodStart, full_amount: monthlyAmount, capped_by_rollover: true, reason: 'rollover_cap_reached' });
      }
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
    await repo.awardReferralFirstPaid(nodeId, 100, referralPaymentReference, config.referralMaxGrantsPerReferrer, {
      invoice_id: invoiceId ?? null,
      stripe_subscription_id: stripeSubscriptionId ?? null,
    });
    await emitNodeEvent(nodeId, 'subscription_changed', {
      plan_code: effectivePlan,
      status: 'active',
      invoice_id: invoiceId,
      stripe_subscription_id: stripeSubscriptionId,
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
    await emitNodeEvent(nodeId, 'subscription_changed', {
      plan_code: storedPlanCode,
      status: 'past_due',
      invoice_id: String(object?.id ?? '') || null,
      stripe_subscription_id: stripeSubscriptionId ?? null,
    });
    return { mapped: true, node_id: nodeId, mapping_source: mapping.source, event_type: type };
  }

  return { mapped: true, node_id: nodeId, mapping_source: mapping.source, event_type: type };
};

function normalizeMessagingHandles(raw: unknown): Array<{ kind: string; handle: string; url: string | null }> {
  if (!Array.isArray(raw)) return [];
  const maxHandles = 10;
  const out: Array<{ kind: string; handle: string; url: string | null }> = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (out.length >= maxHandles) break;
    if (!entry || typeof entry !== 'object') continue;
    const kindRaw = String((entry as any).kind ?? '').trim().toLowerCase();
    const handleRaw = String((entry as any).handle ?? '').trim();
    const urlValue = (entry as any).url;
    const urlRaw = typeof urlValue === 'string' ? urlValue.trim() : '';
    if (!kindRaw || !handleRaw) continue;
    if (kindRaw.length > 32 || handleRaw.length > 128) continue;
    if (!/^[A-Za-z0-9._-]+$/.test(kindRaw)) continue;
    if (urlRaw) {
      try {
        const parsed = new URL(urlRaw);
        if (!parsed.protocol || !parsed.host) continue;
      } catch {
        continue;
      }
    }
    const dedupeKey = `${kindRaw}\u0000${handleRaw}\u0000${urlRaw}`.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push({
      kind: kindRaw,
      handle: handleRaw,
      url: urlRaw ? urlRaw : null,
    });
  }
  return out;
}

function toIsoString(value: unknown) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

function resolveOfferTtlMinutes(ttlMinutes: unknown) {
  const parsed = Number(ttlMinutes);
  if (!Number.isInteger(parsed)) return OFFER_TTL_MINUTES_DEFAULT;
  if (parsed < OFFER_TTL_MINUTES_MIN || parsed > OFFER_TTL_MINUTES_MAX) return OFFER_TTL_MINUTES_DEFAULT;
  return parsed;
}

function resolveRequestTtlMinutes(ttlMinutes: unknown) {
  const parsed = Number(ttlMinutes);
  if (!Number.isInteger(parsed)) return REQUEST_TTL_MINUTES_DEFAULT;
  if (parsed < REQUEST_TTL_MINUTES_MIN || parsed > REQUEST_TTL_MINUTES_MAX) return REQUEST_TTL_MINUTES_DEFAULT;
  return parsed;
}

function offerExpiresAtIso(ttlMinutes: unknown) {
  const ttl = resolveOfferTtlMinutes(ttlMinutes);
  return new Date(Date.now() + ttl * 60_000).toISOString();
}

function requestExpiresAtIso(ttlMinutes: unknown) {
  const ttl = resolveRequestTtlMinutes(ttlMinutes);
  return new Date(Date.now() + ttl * 60_000).toISOString();
}

async function hasCurrentLegalAssent(nodeId: string) {
  const me = await repo.getMe(nodeId);
  if (!me) return false;
  return Boolean(me.legal_accepted_at) && String(me.legal_version ?? '') === config.requiredLegalVersion;
}

async function prePurchaseSearchLimit(nodeId: string) {
  const usage = await repo.getPrepurchaseSearchUsage(nodeId);
  if (usage.hasPurchased || usage.usageToday < PREPURCHASE_DAILY_SEARCH_LIMIT) return null;
  return {
    action: 'search',
    window: 'utc_day',
    limit: PREPURCHASE_DAILY_SEARCH_LIMIT,
    used: usage.usageToday,
    until: 'first_purchase',
  };
}

async function prePurchaseOfferCreateLimit(nodeId: string) {
  const usage = await repo.getPrepurchaseOfferCreateUsage(nodeId);
  if (usage.hasPurchased || usage.usageToday < PREPURCHASE_DAILY_OFFER_CREATE_LIMIT) return null;
  return {
    action: 'offer_create',
    window: 'utc_day',
    limit: PREPURCHASE_DAILY_OFFER_CREATE_LIMIT,
    used: usage.usageToday,
    until: 'first_purchase',
  };
}

async function prePurchaseOfferAcceptLimit(nodeId: string) {
  const usage = await repo.getPrepurchaseOfferAcceptUsage(nodeId);
  if (usage.hasPurchased || usage.usageToday < PREPURCHASE_DAILY_OFFER_ACCEPT_LIMIT) return null;
  return {
    action: 'offer_accept',
    window: 'utc_day',
    limit: PREPURCHASE_DAILY_OFFER_ACCEPT_LIMIT,
    used: usage.usageToday,
    until: 'first_purchase',
  };
}

function encodeEventCursor(createdAt: unknown, id: unknown): string | null {
  const createdAtIso = createdAt instanceof Date
    ? createdAt.toISOString()
    : typeof createdAt === 'string'
      ? createdAt
      : null;
  const idValue = typeof id === 'string' ? id : null;
  if (!createdAtIso || !idValue) return null;
  const payload = JSON.stringify({ t: createdAtIso, id: idValue });
  return `${OFFER_EVENT_CURSOR_PREFIX}${Buffer.from(payload, 'utf8').toString('base64url')}`;
}

function decodeEventCursor(cursor: string | null | undefined): { created_at: string; id: string } | null {
  if (typeof cursor !== 'string' || cursor.length === 0) return null;
  if (!cursor.startsWith(OFFER_EVENT_CURSOR_PREFIX)) return null;
  const encoded = cursor.slice(OFFER_EVENT_CURSOR_PREFIX.length);
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    const createdAt = typeof parsed?.t === 'string' ? parsed.t : null;
    const id = typeof parsed?.id === 'string' ? parsed.id : null;
    if (!createdAt || !id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return null;
    return { created_at: createdAt, id };
  } catch {
    return null;
  }
}

async function emitNodeEvent(nodeId: string, eventType: string, payload: Record<string, unknown> = {}) {
  try {
    const eventRow = await repo.addNodeEvent(eventType, nodeId, payload);
    if (eventRow) await deliverOfferLifecycleWebhook(eventRow);
  } catch (err) {
    console.error(JSON.stringify({ msg: 'emitNodeEvent failed (non-fatal)', event_type: eventType, node_id: nodeId, error: String(err) }));
  }
}

async function emitOfferLifecycleEvents(input: {
  offerId: string;
  eventType: 'offer_created' | 'offer_countered' | 'offer_accepted' | 'offer_cancelled' | 'offer_contact_revealed';
  actorNodeId: string;
  fromNodeId: string;
  toNodeId: string;
  payload?: Record<string, unknown>;
}) {
  const events = await repo.addOfferLifecycleEvents(
    input.offerId,
    input.eventType,
    input.actorNodeId,
    [input.fromNodeId, input.toNodeId],
    {},
  );

  await Promise.all(events.map((event) => deliverOfferLifecycleWebhook(event)));
}

async function deliverOfferLifecycleWebhook(eventRow: any) {
  const nodeId = String(eventRow.recipient_node_id ?? '');
  if (!nodeId) return;
  const webhookConfig = await repo.getNodeEventWebhookConfig(nodeId);
  const webhookUrl = webhookConfig.event_webhook_url?.trim() ?? '';
  if (!webhookUrl) return;
  const webhookSecret = normalizeWebhookSecret(webhookConfig.event_webhook_secret);
  const firstAttemptAtMs = Date.now();
  const retryDeadlineMs = firstAttemptAtMs + (Math.max(0, config.eventWebhookRetryWindowMinutes) * 60 * 1000);

  const deliverAttempt = async (attemptNumber: number): Promise<void> => {
    let ok = false;
    let statusCode: number | null = null;
    let error: string | null = null;
    let nextRetryAt: string | null = null;
    let deliveredAt: string | null = null;
    const rawBody = JSON.stringify({
      id: eventRow.id,
      type: eventRow.event_type,
      offer_id: eventRow.offer_id,
      actor_node_id: eventRow.actor_node_id,
      recipient_node_id: eventRow.recipient_node_id,
      payload: {},
      created_at: eventRow.created_at,
    });
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (webhookSecret) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = signEventWebhookBody(webhookSecret, timestamp, rawBody);
      headers['x-fabric-timestamp'] = timestamp;
      headers['x-fabric-signature'] = `t=${timestamp},v1=${signature}`;
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers,
        body: rawBody,
      });
      statusCode = response.status;
      ok = response.ok;
      if (!response.ok) error = `http_${response.status}`;
    } catch (err: any) {
      error = err?.message ?? 'webhook_delivery_failed';
    }

    if (ok) {
      deliveredAt = new Date().toISOString();
    } else {
      const retryDelayMs = nextWebhookRetryDelayMs(attemptNumber);
      const retryAtMs = Date.now() + retryDelayMs;
      if (retryAtMs <= retryDeadlineMs) {
        nextRetryAt = new Date(retryAtMs).toISOString();
      }
    }

    await repo.addEventWebhookDelivery(
      eventRow.id,
      nodeId,
      webhookUrl,
      attemptNumber,
      nextRetryAt,
      deliveredAt,
      statusCode,
      ok,
      error,
    );

    if (!nextRetryAt) return;
    const waitMs = Math.max(0, new Date(nextRetryAt).getTime() - Date.now());
    const timer = setTimeout(() => {
      void deliverAttempt(attemptNumber + 1);
    }, waitMs);
    timer.unref?.();
  };

  await deliverAttempt(1);
}
