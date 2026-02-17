import crypto from 'node:crypto';
import { config } from '../config.js';
import * as repo from '../db/fabricRepo.js';

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
    legal_version: string;
    legal_ip: string | null;
    legal_user_agent: string | null;
  }) {
    const node = await repo.createNode(payload.display_name, payload.email, {
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
      node: { id: node.id, display_name: payload.display_name, email: payload.email, status: 'ACTIVE', plan: 'free', is_subscriber: false, created_at: node.created_at },
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
    if (!config.stripeSecretKey) return { validationError: 'stripe_not_configured' };

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
  listAuthKeys(nodeId: string) { return repo.listKeys(nodeId).then((keys) => ({ keys })); },
  revokeAuthKey(nodeId: string, keyId: string) { return repo.revokeKey(nodeId, keyId); },
  async me(nodeId: string) {
    const me = await repo.getMe(nodeId);
    const balance = await repo.creditBalance(nodeId);
    const responsePlan = planCodeForResponse(me.plan_code);
    return {
      node: { id: me.id, display_name: me.display_name, email: me.email, status: me.status, plan: responsePlan, is_subscriber: me.sub_status === 'active', created_at: me.created_at },
      subscription: { plan: responsePlan, status: me.sub_status, period_start: me.current_period_start, period_end: me.current_period_end, credits_rollover_enabled: true },
      credits_balance: balance,
    };
  },
  async patchMe(nodeId: string, payload: { display_name: string | null; email: string | null }) { await repo.updateMe(nodeId, payload.display_name, payload.email); return this.me(nodeId); },
  async creditsBalance(nodeId: string) {
    const me = await repo.getMe(nodeId);
    return { credits_balance: await repo.creditBalance(nodeId), subscription: { plan: planCodeForResponse(me.plan_code), status: me.sub_status, period_start: me.current_period_start, period_end: me.current_period_end, credits_rollover_enabled: true } };
  },
  async creditsLedger(nodeId: string, limit: number, cursor: string | null) { const entries = await repo.listLedger(nodeId, limit, cursor); return { entries, next_cursor: entries.length === limit ? entries[entries.length - 1].created_at : null }; },
  createUnit(nodeId: string, payload: any) { return repo.createResource('units', nodeId, payload).then((unit) => ({ unit })); },
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
  async search(nodeId: string, kind: 'listings' | 'requests', isSubscriber: boolean, body: any, idemKey: string) {
    if (!isSubscriber) return { forbidden: true };
    const cost = config.searchCreditCost + (body.broadening?.level ?? 0);
    const balance = await repo.creditBalance(nodeId);
    if (balance < cost) return { creditsExhausted: { credits_required: cost, credits_balance: balance } };
    const rows = await repo.searchPublic(kind, body.scope, body.limit ?? 20, body.cursor ?? null);
    await repo.addCredit(nodeId, body.cursor ? 'debit_search_page' : 'debit_search', -cost, { scope: body.scope }, idemKey);
    await repo.logSearch(nodeId, kind, body.scope, body.q ?? null, body.filters ?? {}, body.broadening?.level ?? 0, cost);
    return { search_id: crypto.randomUUID(), scope: body.scope, limit: body.limit ?? 20, cursor: body.cursor ?? null, broadening: body.broadening ?? { level: 0, allow: false }, applied_filters: body.filters ?? {}, items: rows.map((r) => ({ item: r.doc, rank: { sort_keys: { distance_miles: null, route_specificity_score: 0, fts_rank: 0, recency_score: 0 } } })), has_more: rows.length === (body.limit ?? 20) };
  },
  async nodePublicInventory(nodeId: string, targetNodeId: string, kind: 'listings'|'requests', isSubscriber: boolean, limit: number, cursor: string | null) {
    if (!isSubscriber) return { forbidden: true };
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

const planCredits: Record<string, number> = { free: 0, basic: 500, plus: 1500, pro: 1500, business: 5000 };
const freeLikePlans = new Set(['free', 'none']);

const stripePricePlanMap: Record<string, string[]> = {
  basic: config.stripePriceIdsBasic,
  plus: config.stripePriceIdsPlus,
  pro: config.stripePriceIdsPro,
  business: config.stripePriceIdsBusiness,
};
const paidPlanCodes = ['basic', 'plus', 'pro', 'business'] as const;
const paidPlanCodeSet = new Set<string>(paidPlanCodes);

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

function stripeId(value: any): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object' && typeof value.id === 'string') return value.id;
  return null;
}

function stripeTimeToIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return new Date(value * 1000).toISOString();
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return new Date(Number(value) * 1000).toISOString();
    return value;
  }
  return null;
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
  return planCode === 'plus' ? 'pro' : planCode;
}

function planCodeForResponse(planCode: string) {
  if (planCode === 'pro' && config.stripePriceIdsPlus.length > 0 && config.stripePriceIdsPro.length === 0) return 'plus';
  return planCode;
}

async function resolvePlanCode(nodeId: string, event: any, fallback: string, options: { preferStripePriceMap?: boolean; avoidFreeFallback?: boolean } = {}) {
  const explicitPlan = normalizePlanCode(event.data?.object?.metadata?.plan_code ?? event.data?.object?.plan_code ?? null);
  if (explicitPlan) return explicitPlan;

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
  const existingPlan = normalizePlanCode(me?.plan_code);
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
  return normalizePlanCode(fallback) ?? fallback;
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
    return { mapped: true, node_id: nodeId, mapping_source: mapping.source, event_type: type };
  }

  if (type === 'checkout.session.completed') {
    const planCode = await resolvePlanCode(nodeId, event, 'basic');
    const storedPlanCode = planCodeForStorage(planCode);
    await repo.upsertSubscription(nodeId, storedPlanCode, 'active', stripeTimeToIso(object.current_period_start), stripeTimeToIso(object.current_period_end), stripeCustomerId, stripeSubscriptionId);
    return { mapped: true, node_id: nodeId, mapping_source: mapping.source, event_type: type };
  }

  if (type === 'invoice.paid') {
    const planCode = await resolvePlanCode(nodeId, event, 'basic', { preferStripePriceMap: true, avoidFreeFallback: true });
    const storedPlanCode = planCodeForStorage(planCode);
    const periodStart = stripeTimeToIso(object.period_start) ?? new Date().toISOString();
    await repo.upsertSubscription(nodeId, storedPlanCode, 'active', periodStart, stripeTimeToIso(object.period_end), stripeCustomerId, stripeSubscriptionId);
    if (!(await repo.monthlyCreditGranted(nodeId, periodStart))) {
      await repo.addCredit(nodeId, 'grant_subscription_monthly', planCredits[planCode] ?? 0, { period_start: periodStart });
    }
    const claim = await repo.getReferralClaim(nodeId);
    if (claim) {
      await repo.addCredit(claim.issuer_node_id, 'grant_referral', 100, { claimer_node_id: nodeId, claim_id: claim.id });
      await repo.markReferralAwarded(claim.id);
    }
    return { mapped: true, node_id: nodeId, mapping_source: mapping.source, event_type: type };
  }

  if (type === 'invoice.payment_failed') {
    const planCode = await resolvePlanCode(nodeId, event, 'free');
    const storedPlanCode = planCodeForStorage(planCode);
    await repo.upsertSubscription(nodeId, storedPlanCode, 'past_due', stripeTimeToIso(object.current_period_start), stripeTimeToIso(object.current_period_end), stripeCustomerId, stripeSubscriptionId);
    return { mapped: true, node_id: nodeId, mapping_source: mapping.source, event_type: type };
  }

  return { mapped: true, node_id: nodeId, mapping_source: mapping.source, event_type: type };
};
