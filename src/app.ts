import crypto from 'node:crypto';
import Fastify, { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { config } from './config.js';
import { errorEnvelope } from './http.js';
import { fabricService } from './services/fabricService.js';
import * as repo from './db/fabricRepo.js';
import { query } from './db/client.js';
import { getSafeDbEnvDiagnostics } from './dbEnvDiagnostics.js';

type AuthedRequest = FastifyRequest & { nodeId?: string; plan?: string; isSubscriber?: boolean; idem?: { key: string; hash: string; keyScope: string } };
type StripeWebhookLogContext = { event_id: string | null; event_type: string | null; stripe_signature_present: boolean };
type StripeWebhookRequest = FastifyRequest & { stripeWebhookLogContext?: StripeWebhookLogContext };

const nonGet = new Set(['POST', 'PATCH', 'DELETE', 'PUT']);
const anonIdem = new Map<string, { hash: string; status: number; response: unknown }>();
let startupDbEnvCheckLogged = false;

const resourceSchema = z.object({
  title: z.string(), description: z.string().nullable().optional(), type: z.string().nullable().optional(), condition: z.enum(['new', 'like_new', 'good', 'fair', 'poor', 'unknown']).nullable().optional(),
  quantity: z.number().nullable().optional(), measure: z.enum(['EA','KG','LB','L','GAL','M','FT','HR','DAY','LOT','CUSTOM']).nullable().optional(), custom_measure: z.string().nullable().optional(),
  scope_primary: z.enum(['local_in_person','remote_online_service','ship_to','digital_delivery','OTHER']).nullable().optional(), scope_secondary: z.array(z.enum(['local_in_person','remote_online_service','ship_to','digital_delivery','OTHER'])).nullable().optional(),
  scope_notes: z.string().nullable().optional(), location_text_public: z.string().nullable().optional(), origin_region: z.any().optional(), dest_region: z.any().optional(), service_region: z.any().optional(),
  delivery_format: z.string().nullable().optional(), tags: z.array(z.string()).optional(), category_ids: z.array(z.number()).optional(), public_summary: z.string().nullable().optional(), need_by: z.string().nullable().optional(), accept_substitutions: z.boolean().optional(),
});

const searchSchema = z.object({
  q: z.string().nullable(), scope: z.enum(['local_in_person','remote_online_service','ship_to','digital_delivery','OTHER']), filters: z.record(z.any()), broadening: z.object({ level: z.number(), allow: z.boolean() }), limit: z.number().min(1).max(100).default(20), cursor: z.string().nullable(),
});

function validateScopeFilters(scope: string, filters: Record<string, unknown>) {
  const keys = Object.keys(filters ?? {});
  const allowed: Record<string, string[]> = {
    local_in_person: ['center', 'radius_miles', 'regions'],
    remote_online_service: ['regions', 'languages'],
    ship_to: ['ship_to_regions', 'ships_from_regions', 'max_ship_days'],
    digital_delivery: ['regions', 'delivery_methods'],
    OTHER: ['scope_notes'],
  };
  if (keys.some((k) => !allowed[scope].includes(k))) return { ok: false, reason: 'unknown_keys' };
  if (scope === 'local_in_person') {
    const hasCenter = !!(filters as any).center && typeof (filters as any).radius_miles === 'number';
    const hasRegions = Array.isArray((filters as any).regions) && (filters as any).regions.length > 0;
    const radius = (filters as any).radius_miles;
    if (!hasCenter && !hasRegions) return { ok: false, reason: 'local_requires_center_or_regions' };
    if (radius !== undefined && (radius < 1 || radius > 200)) return { ok: false, reason: 'radius_out_of_range' };
  }
  if (scope === 'remote_online_service') {
    const hasRegions = Array.isArray((filters as any).regions) && (filters as any).regions.length > 0;
    const hasLanguages = Array.isArray((filters as any).languages) && (filters as any).languages.length > 0;
    if (!hasRegions && !hasLanguages) return { ok: false, reason: 'remote_requires_regions_or_languages' };
  }
  if (scope === 'ship_to') {
    const shipTo = (filters as any).ship_to_regions;
    if (!Array.isArray(shipTo) || shipTo.length === 0) return { ok: false, reason: 'ship_to_regions_required' };
    const d = (filters as any).max_ship_days;
    if (d !== undefined && (d < 1 || d > 30)) return { ok: false, reason: 'max_ship_days_out_of_range' };
  }
  if (scope === 'OTHER') {
    if (typeof (filters as any).scope_notes !== 'string' || !(filters as any).scope_notes) return { ok: false, reason: 'scope_notes_required' };
  }
  return { ok: true, reason: null };
}

function rawBodyBuffer(body: unknown) {
  if (Buffer.isBuffer(body)) return body;
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  return null;
}

function parseStripeSignature(sigHeader: string) {
  let tValue = '';
  const v1Values: string[] = [];
  for (const part of sigHeader.split(',')) {
    const [k, ...rest] = part.trim().split('=');
    const value = rest.join('=').trim();
    if (k === 't') tValue = value;
    if (k === 'v1' && value) v1Values.push(value);
  }
  const t = Number(tValue);
  if (!t || v1Values.length === 0) return null;
  return { t, v1Values };
}

function timingSafeHexEqual(aHex: string, bHex: string) {
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function hasStripeSignatureHeader(req: FastifyRequest) {
  const sigHeader = req.headers['stripe-signature'];
  if (Array.isArray(sigHeader)) return sigHeader.length > 0;
  return typeof sigHeader === 'string' && sigHeader.length > 0;
}

function setStripeWebhookLogContext(req: FastifyRequest, update: Partial<StripeWebhookLogContext>) {
  const webhookReq = req as StripeWebhookRequest;
  webhookReq.stripeWebhookLogContext = {
    event_id: webhookReq.stripeWebhookLogContext?.event_id ?? null,
    event_type: webhookReq.stripeWebhookLogContext?.event_type ?? null,
    stripe_signature_present: webhookReq.stripeWebhookLogContext?.stripe_signature_present ?? hasStripeSignatureHeader(req),
    ...update,
  };
}

function requestErrorLogFields(req: FastifyRequest) {
  const fields: Record<string, unknown> = {
    req_method: req.method,
    req_url: req.url,
    req_id: req.id,
  };
  if (req.url !== '/v1/webhooks/stripe') return fields;
  const ctx = (req as StripeWebhookRequest).stripeWebhookLogContext;
  fields.stripe_signature_present = ctx?.stripe_signature_present ?? hasStripeSignatureHeader(req);
  if (ctx?.event_id) fields.event_id = ctx.event_id;
  if (ctx?.event_type) fields.event_type = ctx.event_type;
  return fields;
}

export function buildApp() {
  const app = Fastify({ logger: true });

  if (!startupDbEnvCheckLogged) {
    startupDbEnvCheckLogged = true;
    app.log.info({ ...getSafeDbEnvDiagnostics(), check_point: 'startup' }, 'db env check');
  }

  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => {
    done(null, body);
  });

  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err, ...requestErrorLogFields(req) }, 'unhandled error');
    if (reply.sent) return;
    reply.send(err);
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('X-RateLimit-Limit', String(config.defaultRateLimitLimit));
    reply.header('X-RateLimit-Remaining', String(config.defaultRateLimitLimit));
    reply.header('X-RateLimit-Reset', String(Math.floor(Date.now() / 1000) + 60));
    reply.header('X-Credits-Remaining', '0');
    reply.header('X-Credits-Charged', '0');
    reply.header('X-Credits-Plan', 'unknown');

    if (req.url === '/v1/bootstrap' || req.url === '/v1/webhooks/stripe' || req.url === '/healthz') return;

    if (req.url.startsWith('/v1/admin/')) {
      if (req.headers['x-admin-key'] !== config.adminKey) return reply.status(401).send(errorEnvelope('unauthorized', 'Invalid admin key'));
      return;
    }

    const auth = req.headers.authorization;
    if (!auth?.startsWith('ApiKey ')) return reply.status(401).send(errorEnvelope('unauthorized', 'Missing or invalid API key'));
    const found = await repo.findApiKey(auth.slice('ApiKey '.length));
    if (!found) return reply.status(401).send(errorEnvelope('unauthorized', 'Invalid API key'));
    (req as AuthedRequest).nodeId = found.node_id;
    (req as AuthedRequest).plan = found.plan_code;
    (req as AuthedRequest).isSubscriber = found.status === 'active';
    reply.header('X-Credits-Plan', found.plan_code ?? 'unknown');
    reply.header('X-Credits-Remaining', String(await repo.creditBalance(found.node_id)));
  });

  app.addHook('preHandler', async (req, reply) => {
    if (!nonGet.has(req.method) || req.url === '/v1/webhooks/stripe') return;
    const idemKey = req.headers['idempotency-key'];
    if (!idemKey) return reply.status(422).send(errorEnvelope('validation_error', 'Idempotency-Key required'));
    const hash = crypto.createHash('sha256').update(JSON.stringify(req.body ?? {})).digest('hex');

    if (req.url === '/v1/bootstrap') {
      const keyScope = `${req.method}:${req.routeOptions.url}:${String(idemKey)}`;
      const existing = anonIdem.get(keyScope);
      if (existing) {
        if (existing.hash !== hash) return reply.status(409).send(errorEnvelope('idempotency_key_reuse_conflict', 'Idempotency key used with different payload'));
        return reply.status(existing.status).send(existing.response);
      }
      (req as AuthedRequest).idem = { key: String(idemKey), hash, keyScope };
      return;
    }

    const nodeId = (req as AuthedRequest).nodeId;
    if (!nodeId) return;
    const existing = await repo.getIdempotency(nodeId, String(idemKey), req.method, req.routeOptions.url);
    if (existing) {
      if (existing.request_hash !== hash) return reply.status(409).send(errorEnvelope('idempotency_key_reuse_conflict', 'Idempotency key used with different payload'));
      return reply.status(existing.status_code).send(existing.response_json);
    }
    (req as AuthedRequest).idem = { key: String(idemKey), hash, keyScope: `${nodeId}:${req.routeOptions.url}` };
  });

  app.addHook('onSend', async (req, reply, payload) => {
    if (!nonGet.has(req.method) || req.url === '/v1/webhooks/stripe') return payload;
    const idem = (req as AuthedRequest).idem;
    if (!idem) return payload;
    const responseJson = typeof payload === 'string' ? JSON.parse(payload) : payload;
    if (req.url === '/v1/bootstrap') {
      anonIdem.set(idem.keyScope, { hash: idem.hash, status: reply.statusCode, response: responseJson });
      return payload;
    }
    const nodeId = (req as AuthedRequest).nodeId;
    if (nodeId) await repo.saveIdempotency(nodeId, idem.key, req.method, req.routeOptions.url, idem.hash, reply.statusCode, responseJson);
    return payload;
  });

  app.post('/v1/bootstrap', async (req, reply) => {
    const schema = z.object({ display_name: z.string(), email: z.string().nullable(), referral_code: z.string().nullable() });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', parsed.error.flatten()));
    return fabricService.bootstrap(parsed.data);
  });

  app.post('/v1/auth/keys', async (req, reply) => {
    const parsed = z.object({ label: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    return fabricService.createAuthKey((req as AuthedRequest).nodeId!, parsed.data.label);
  });
  app.get('/v1/auth/keys', async (req) => fabricService.listAuthKeys((req as AuthedRequest).nodeId!));
  app.delete('/v1/auth/keys/:key_id', async (req, reply) => {
    const ok = await fabricService.revokeAuthKey((req as AuthedRequest).nodeId!, (req.params as any).key_id);
    if (!ok) return reply.status(404).send(errorEnvelope('not_found', 'Key not found'));
    return { ok: true };
  });

  app.get('/v1/me', async (req) => fabricService.me((req as AuthedRequest).nodeId!));
  app.patch('/v1/me', async (req, reply) => {
    const parsed = z.object({ display_name: z.string().nullable(), email: z.string().nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    return fabricService.patchMe((req as AuthedRequest).nodeId!, parsed.data);
  });

  app.get('/v1/credits/balance', async (req) => fabricService.creditsBalance((req as AuthedRequest).nodeId!));
  app.get('/v1/credits/ledger', async (req) => {
    const q = req.query as any;
    return fabricService.creditsLedger((req as AuthedRequest).nodeId!, Number(q.limit ?? 20), q.cursor ?? null);
  });
  app.post('/v1/billing/checkout-session', async (req, reply) => {
    const parsed = z.object({
      node_id: z.string().uuid(),
      plan_code: z.enum(['basic', 'plus', 'pro', 'business']),
      success_url: z.string().url(),
      cancel_url: z.string().url(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload', parsed.error.flatten()));
    const out = await fabricService.createBillingCheckoutSession(
      (req as AuthedRequest).nodeId!,
      parsed.data,
      (req as AuthedRequest).idem?.key ?? null,
    );
    if ((out as any).forbidden) {
      return reply.status(403).send(errorEnvelope('forbidden', 'Cannot create checkout session for another node'));
    }
    if ((out as any).validationError) {
      return reply.status(422).send(errorEnvelope('validation_error', 'Unable to create checkout session', {
        reason: (out as any).validationError,
        stripe_status: (out as any).stripe_status ?? undefined,
        plan_code: (out as any).plan_code ?? parsed.data.plan_code,
      }));
    }
    return out;
  });

  app.post('/v1/units', async (req, reply) => {
    const parsed = resourceSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    return fabricService.createUnit((req as AuthedRequest).nodeId!, parsed.data);
  });
  app.get('/v1/units', async (req) => {
    const q = req.query as any;
    return fabricService.listUnits((req as AuthedRequest).nodeId!, Number(q.limit ?? 20), q.cursor ?? null);
  });
  app.get('/v1/units/:unit_id', async (req, reply) => {
    const unit = await fabricService.getUnit((req as AuthedRequest).nodeId!, (req.params as any).unit_id);
    if (!unit) return reply.status(404).send(errorEnvelope('not_found', 'Unit not found'));
    return unit;
  });
  app.patch('/v1/units/:unit_id', async (req, reply) => {
    const ifMatch = req.headers['if-match'];
    if (!ifMatch) return reply.status(422).send(errorEnvelope('validation_error', 'If-Match required'));
    const parsed = resourceSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const unit = await fabricService.patchUnit((req as AuthedRequest).nodeId!, (req.params as any).unit_id, Number(ifMatch), parsed.data);
    if (!unit) return reply.status(409).send(errorEnvelope('stale_write_conflict', 'Version conflict'));
    return unit;
  });
  app.delete('/v1/units/:unit_id', async (req, reply) => {
    const ok = await fabricService.deleteUnit((req as AuthedRequest).nodeId!, (req.params as any).unit_id);
    if (!ok) return reply.status(404).send(errorEnvelope('not_found', 'Unit not found'));
    return { ok: true };
  });

  app.post('/v1/requests', async (req, reply) => {
    const parsed = resourceSchema.extend({ need_by: z.string().nullable().optional(), accept_substitutions: z.boolean().optional() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    return fabricService.createRequest((req as AuthedRequest).nodeId!, parsed.data);
  });
  app.get('/v1/requests', async (req) => {
    const q = req.query as any;
    return fabricService.listRequests((req as AuthedRequest).nodeId!, Number(q.limit ?? 20), q.cursor ?? null);
  });
  app.get('/v1/requests/:request_id', async (req, reply) => {
    const item = await fabricService.getRequest((req as AuthedRequest).nodeId!, (req.params as any).request_id);
    if (!item) return reply.status(404).send(errorEnvelope('not_found', 'Request not found'));
    return item;
  });
  app.patch('/v1/requests/:request_id', async (req, reply) => {
    const ifMatch = req.headers['if-match'];
    if (!ifMatch) return reply.status(422).send(errorEnvelope('validation_error', 'If-Match required'));
    const parsed = resourceSchema.partial().safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const item = await fabricService.patchRequest((req as AuthedRequest).nodeId!, (req.params as any).request_id, Number(ifMatch), parsed.data);
    if (!item) return reply.status(409).send(errorEnvelope('stale_write_conflict', 'Version conflict'));
    return item;
  });
  app.delete('/v1/requests/:request_id', async (req, reply) => {
    const ok = await fabricService.deleteRequest((req as AuthedRequest).nodeId!, (req.params as any).request_id);
    if (!ok) return reply.status(404).send(errorEnvelope('not_found', 'Request not found'));
    return { ok: true };
  });

  app.post('/v1/units/:unit_id/publish', async (req, reply) => {
    const out = await fabricService.publish('units', (req as AuthedRequest).nodeId!, (req.params as any).unit_id);
    if ((out as any).notFound) return reply.status(404).send(errorEnvelope('not_found', 'Unit not found'));
    if ((out as any).validationError) return reply.status(422).send(errorEnvelope('validation_error', 'Publish requirements not met', { reason: (out as any).validationError }));
    return out;
  });
  app.post('/v1/units/:unit_id/unpublish', async (req) => fabricService.unpublish('units', (req as AuthedRequest).nodeId!, (req.params as any).unit_id));
  app.post('/v1/requests/:request_id/publish', async (req, reply) => {
    const out = await fabricService.publish('requests', (req as AuthedRequest).nodeId!, (req.params as any).request_id);
    if ((out as any).notFound) return reply.status(404).send(errorEnvelope('not_found', 'Request not found'));
    if ((out as any).validationError) return reply.status(422).send(errorEnvelope('validation_error', 'Publish requirements not met', { reason: (out as any).validationError }));
    return out;
  });
  app.post('/v1/requests/:request_id/unpublish', async (req) => fabricService.unpublish('requests', (req as AuthedRequest).nodeId!, (req.params as any).request_id));

  app.post('/v1/search/listings', async (req, reply) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const vf = validateScopeFilters(parsed.data.scope, parsed.data.filters);
    if (!vf.ok) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid filters', { reason: vf.reason }));
    const out = await fabricService.search((req as AuthedRequest).nodeId!, 'listings', !!(req as AuthedRequest).isSubscriber, parsed.data, (req as AuthedRequest).idem!.key);
    if ((out as any).forbidden) return reply.status(403).send(errorEnvelope('subscriber_required', 'Subscriber required'));
    if ((out as any).creditsExhausted) return reply.status(402).send(errorEnvelope('credits_exhausted', 'Not enough credits', (out as any).creditsExhausted));
    return out;
  });
  app.post('/v1/search/requests', async (req, reply) => {
    const parsed = searchSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const vf = validateScopeFilters(parsed.data.scope, parsed.data.filters);
    if (!vf.ok) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid filters', { reason: vf.reason }));
    const out = await fabricService.search((req as AuthedRequest).nodeId!, 'requests', !!(req as AuthedRequest).isSubscriber, parsed.data, (req as AuthedRequest).idem!.key);
    if ((out as any).forbidden) return reply.status(403).send(errorEnvelope('subscriber_required', 'Subscriber required'));
    if ((out as any).creditsExhausted) return reply.status(402).send(errorEnvelope('credits_exhausted', 'Not enough credits', (out as any).creditsExhausted));
    return out;
  });

  app.get('/v1/public/nodes/:node_id/listings', async (req, reply) => {
    const q = req.query as any;
    const out = await fabricService.nodePublicInventory((req as AuthedRequest).nodeId!, (req.params as any).node_id, 'listings', !!(req as AuthedRequest).isSubscriber, Number(q.limit ?? 20), q.cursor ?? null);
    if ((out as any).forbidden) return reply.status(403).send(errorEnvelope('subscriber_required', 'Subscriber required'));
    if ((out as any).creditsExhausted) return reply.status(402).send(errorEnvelope('credits_exhausted', 'Not enough credits', (out as any).creditsExhausted));
    return out;
  });
  app.get('/v1/public/nodes/:node_id/requests', async (req, reply) => {
    const q = req.query as any;
    const out = await fabricService.nodePublicInventory((req as AuthedRequest).nodeId!, (req.params as any).node_id, 'requests', !!(req as AuthedRequest).isSubscriber, Number(q.limit ?? 20), q.cursor ?? null);
    if ((out as any).forbidden) return reply.status(403).send(errorEnvelope('subscriber_required', 'Subscriber required'));
    if ((out as any).creditsExhausted) return reply.status(402).send(errorEnvelope('credits_exhausted', 'Not enough credits', (out as any).creditsExhausted));
    return out;
  });

  app.get('/v1/offers', async (req) => {
    const q = req.query as any;
    return (fabricService as any).listOffers((req as AuthedRequest).nodeId!, q.role === 'received' ? 'received' : 'made', Number(q.limit ?? 20), q.cursor ?? null);
  });
  app.get('/v1/offers/:offer_id', async (req, reply) => {
    const out = await (fabricService as any).getOffer((req as AuthedRequest).nodeId!, (req.params as any).offer_id);
    if (!out) return reply.status(404).send(errorEnvelope('not_found', 'Offer not found'));
    return out;
  });
  app.post('/v1/offers', async (req, reply) => {
    const parsed = z.object({ unit_ids: z.array(z.string()).min(1), thread_id: z.string().nullable(), note: z.string().nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const out = await (fabricService as any).createOffer((req as AuthedRequest).nodeId!, !!(req as AuthedRequest).isSubscriber, parsed.data.unit_ids, parsed.data.thread_id, parsed.data.note);
    if (out.forbidden) return reply.status(403).send(errorEnvelope('subscriber_required', 'Subscriber required'));
    if (out.conflict) return reply.status(409).send(errorEnvelope('conflict', 'Offer conflict', { reason: out.conflict }));
    return out;
  });
  app.post('/v1/offers/:offer_id/counter', async (req, reply) => {
    const parsed = z.object({ unit_ids: z.array(z.string()).min(1), note: z.string().nullable() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const out = await (fabricService as any).counterOffer((req as AuthedRequest).nodeId!, !!(req as AuthedRequest).isSubscriber, (req.params as any).offer_id, parsed.data.unit_ids, parsed.data.note);
    if (out.forbidden) return reply.status(403).send(errorEnvelope('subscriber_required', 'Subscriber required'));
    if (out.notFound) return reply.status(404).send(errorEnvelope('not_found', 'Offer not found'));
    return out;
  });
  app.post('/v1/offers/:offer_id/accept', async (req, reply) => {
    const out = await (fabricService as any).acceptOffer((req as AuthedRequest).nodeId!, !!(req as AuthedRequest).isSubscriber, (req.params as any).offer_id);
    if (out.forbidden) return reply.status(403).send(errorEnvelope('subscriber_required', 'Subscriber required'));
    if (out.notFound) return reply.status(404).send(errorEnvelope('not_found', 'Offer not found'));
    if (out.conflict) return reply.status(409).send(errorEnvelope('invalid_state_transition', 'Invalid transition'));
    return out;
  });
  app.post('/v1/offers/:offer_id/reject', async (req, reply) => {
    const out = await (fabricService as any).rejectOffer((req as AuthedRequest).nodeId!, (req.params as any).offer_id);
    if (out.notFound) return reply.status(404).send(errorEnvelope('not_found', 'Offer not found'));
    if (out.forbidden) return reply.status(403).send(errorEnvelope('forbidden', 'Not allowed'));
    return out;
  });
  app.post('/v1/offers/:offer_id/cancel', async (req, reply) => {
    const out = await (fabricService as any).cancelOffer((req as AuthedRequest).nodeId!, (req.params as any).offer_id);
    if (out.notFound) return reply.status(404).send(errorEnvelope('not_found', 'Offer not found'));
    if (out.forbidden) return reply.status(403).send(errorEnvelope('forbidden', 'Not allowed'));
    return out;
  });
  app.post('/v1/offers/:offer_id/reveal-contact', async (req, reply) => {
    const out = await (fabricService as any).revealContact((req as AuthedRequest).nodeId!, !!(req as AuthedRequest).isSubscriber, (req.params as any).offer_id);
    if (out.notFound) return reply.status(404).send(errorEnvelope('not_found', 'Offer not found'));
    if (out.notAccepted) return reply.status(409).send(errorEnvelope('offer_not_mutually_accepted', 'Offer not mutually accepted'));
    if (out.subscriberRequired) return reply.status(403).send(errorEnvelope('subscriber_required', 'Subscriber required'));
    if (out.forbidden) return reply.status(403).send(errorEnvelope('forbidden', 'Not allowed'));
    return out;
  });

  app.post('/v1/referrals/claim', async (req, reply) => {
    const parsed = z.object({ referral_code: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const out = await (fabricService as any).claimReferral((req as AuthedRequest).nodeId!, parsed.data.referral_code);
    if (out.invalid) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid referral code'));
    if (out.locked) return reply.status(409).send(errorEnvelope('invalid_state_transition', 'Referral locked after paid event'));
    return { ok: true, referrer_node_id: out.referrer_node_id };
  });

  app.register(async (webhookApp) => {
    webhookApp.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body);
    });

    webhookApp.post('/v1/webhooks/stripe', async (req, reply) => {
      req.log.info({ ...getSafeDbEnvDiagnostics(), check_point: 'stripe_webhook' }, 'db env check');
      setStripeWebhookLogContext(req, {
        event_id: null,
        event_type: null,
        stripe_signature_present: hasStripeSignatureHeader(req),
      });
      try {
        const sigHeader = (req.headers['stripe-signature'] as string | undefined) ?? '';
        if (!sigHeader) {
          webhookApp.log.warn({ signature_verified: false, reason: 'missing_signature_header', event_type: null, event_id: null }, 'Stripe webhook signature verification failed');
          return reply.status(400).send(errorEnvelope('validation_error', 'Missing Stripe-Signature'));
        }
        const parsedSig = parseStripeSignature(sigHeader);
        if (!parsedSig) {
          webhookApp.log.warn({ signature_verified: false, reason: 'invalid_signature_header', event_type: null, event_id: null }, 'Stripe webhook signature verification failed');
          return reply.status(400).send(errorEnvelope('validation_error', 'Invalid Stripe-Signature'));
        }
        const { t, v1Values } = parsedSig;
        if (Math.abs(Math.floor(Date.now() / 1000) - t) > 300) {
          webhookApp.log.warn({ signature_verified: false, reason: 'timestamp_out_of_tolerance', event_type: null, event_id: null }, 'Stripe webhook signature verification failed');
          return reply.status(400).send(errorEnvelope('validation_error', 'Stripe signature timestamp out of tolerance'));
        }
        const bodyBuffer = rawBodyBuffer(req.body);
        if (bodyBuffer === null) {
          webhookApp.log.warn({ signature_verified: false, reason: 'invalid_raw_body', event_type: null, event_id: null }, 'Stripe webhook signature verification failed');
          return reply.status(400).send(errorEnvelope('validation_error', 'Invalid webhook payload'));
        }
        if (!config.stripeWebhookSecret) {
          webhookApp.log.warn({ signature_verified: false, reason: 'missing_webhook_secret', event_type: null, event_id: null }, 'Stripe webhook signature verification failed');
          return reply.status(400).send(errorEnvelope('validation_error', 'Stripe signature verification failed'));
        }

        const payload = Buffer.concat([Buffer.from(String(t), 'utf8'), Buffer.from('.', 'utf8'), bodyBuffer]);
        const expected = crypto.createHmac('sha256', config.stripeWebhookSecret).update(payload).digest('hex');
        const signatureVerified = v1Values.some((v1) => timingSafeHexEqual(v1, expected));

        let event: any;
        try {
          event = JSON.parse(bodyBuffer.toString('utf8'));
        } catch {
          webhookApp.log.warn({ signature_verified: false, reason: 'invalid_json_payload', event_type: null, event_id: null }, 'Stripe webhook signature verification failed');
          return reply.status(400).send(errorEnvelope('validation_error', 'Invalid webhook JSON payload'));
        }

        const eventId = String(event.id ?? '');
        const eventType = String(event.type ?? 'unknown');
        setStripeWebhookLogContext(req, { event_id: eventId || null, event_type: eventType || null });
        if (!signatureVerified) {
          webhookApp.log.warn({ signature_verified: false, reason: 'signature_mismatch', event_type: eventType, event_id: eventId || null }, 'Stripe webhook signature verification failed');
          return reply.status(400).send(errorEnvelope('validation_error', 'Stripe signature verification failed'));
        }
        webhookApp.log.info({ signature_verified: true, event_type: eventType, event_id: eventId || null }, 'Stripe webhook signature verified');

        if (!eventId) return reply.status(422).send(errorEnvelope('validation_error', 'Missing stripe event id'));
        await repo.insertStripeEvent(eventId, eventType, event);
        try {
          const processing = await (fabricService as any).processStripeEvent(event);
          await repo.markStripeProcessed(eventId);
          if (processing?.mapped === false && processing?.reason === 'unmapped_stripe_customer') {
            webhookApp.log.warn(
              {
                signature_verified: true,
                reason: 'unmapped_stripe_customer',
                event_type: eventType,
                event_id: eventId,
                stripe_customer_id: processing?.stripe_customer_id ?? null,
                stripe_subscription_id: processing?.stripe_subscription_id ?? null,
              },
              'Stripe webhook processed without node mapping',
            );
          }
          webhookApp.log.info({ signature_verified: true, event_type: eventType, event_id: eventId }, 'Stripe webhook processed');
          return { ok: true };
        } catch (err: any) {
          await repo.markStripeError(eventId, err?.message ?? 'processing_error');
          webhookApp.log.warn({ signature_verified: true, reason: 'processing_error', event_type: eventType, event_id: eventId }, 'Stripe webhook processing failed');
          return { ok: true };
        }
      } catch (err) {
        req.log.error({ err, ...requestErrorLogFields(req) }, 'stripe webhook handler failed');
        return reply.code(500).send({ ok: false });
      }
    });
  });

  app.post('/v1/admin/takedown', async (req, reply) => {
    const parsed = z.object({ target_type: z.enum(['public_listing', 'public_request', 'node']), target_id: z.string(), reason: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const dbType = parsed.data.target_type === 'public_listing' ? 'listing' : parsed.data.target_type === 'public_request' ? 'request' : 'node';
    await query('insert into takedowns(target_type,target_id,reason) values($1,$2,$3)', [dbType, parsed.data.target_id, parsed.data.reason]);
    return { ok: true };
  });
  app.post('/v1/admin/credits/adjust', async (req, reply) => {
    const parsed = z.object({ node_id: z.string(), delta: z.number(), reason: z.string() }).safeParse(req.body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    await repo.addCredit(parsed.data.node_id, 'adjustment_manual', parsed.data.delta, { reason: parsed.data.reason });
    return { ok: true };
  });
  app.post('/v1/admin/nodes/:nodeId/api-keys', async (req, reply) => {
    const params = z.object({ nodeId: z.string().uuid() }).safeParse(req.params);
    if (!params.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid params'));
    const body = typeof req.body === 'object' && req.body !== null ? req.body : {};
    const parsed = z.object({ label: z.string().optional() }).safeParse(body);
    if (!parsed.success) return reply.status(422).send(errorEnvelope('validation_error', 'Invalid payload'));
    const node = await repo.getMe(params.data.nodeId);
    if (!node) return reply.status(404).send(errorEnvelope('not_found', 'Node not found'));
    const created = await fabricService.createAuthKey(params.data.nodeId, parsed.data.label ?? 'post-tls-verify');
    return {
      api_key: created.api_key,
      key_prefix: created.api_key.slice(0, 8),
      node_id: params.data.nodeId,
    };
  });
  app.post('/v1/admin/projections/rebuild', async (req) => {
    const q = req.query as any;
    const kind = q.kind ?? 'all';
    const mode = q.mode ?? 'full';
    const started_at = new Date().toISOString();
    if (kind === 'all' || kind === 'listings') {
      await query('truncate table public_listings');
      await query(`insert into public_listings(unit_id,node_id,doc,published_at)
        select u.id,u.node_id,jsonb_build_object('id',u.id,'node_id',u.node_id,'scope_primary',u.scope_primary,'scope_secondary',u.scope_secondary,'title',u.title,'description',u.description,'public_summary',u.public_summary,'quantity',u.quantity,'measure',u.measure,'custom_measure',u.custom_measure,'category_ids',u.category_ids,'tags',u.tags,'type',u.type,'condition',u.condition,'location_text_public',u.location_text_public,'origin_region',u.origin_region,'dest_region',u.dest_region,'service_region',u.service_region,'delivery_format',u.delivery_format,'photos',u.photos,'published_at',u.published_at,'updated_at',u.updated_at),u.published_at
        from units u join nodes n on n.id=u.node_id where u.published_at is not null and u.deleted_at is null and n.status='ACTIVE' and n.deleted_at is null and not exists (select 1 from takedowns t where t.target_type='listing' and t.target_id=u.id and t.reversed_at is null) and not exists (select 1 from takedowns t where t.target_type='node' and t.target_id=u.node_id and t.reversed_at is null)`);
    }
    if (kind === 'all' || kind === 'requests') {
      await query('truncate table public_requests');
      await query(`insert into public_requests(request_id,node_id,doc,published_at)
        select r.id,r.node_id,jsonb_build_object('id',r.id,'node_id',r.node_id,'scope_primary',r.scope_primary,'scope_secondary',r.scope_secondary,'title',r.title,'description',r.description,'public_summary',r.public_summary,'desired_quantity',r.desired_quantity,'measure',r.measure,'custom_measure',r.custom_measure,'category_ids',r.category_ids,'tags',r.tags,'type',r.type,'condition',r.condition,'location_text_public',r.location_text_public,'origin_region',r.origin_region,'dest_region',r.dest_region,'service_region',r.service_region,'delivery_format',r.delivery_format,'need_by',r.need_by,'accept_substitutions',r.accept_substitutions,'published_at',r.published_at,'updated_at',r.updated_at),r.published_at
        from requests r join nodes n on n.id=r.node_id where r.published_at is not null and r.deleted_at is null and n.status='ACTIVE' and n.deleted_at is null and not exists (select 1 from takedowns t where t.target_type='request' and t.target_id=r.id and t.reversed_at is null) and not exists (select 1 from takedowns t where t.target_type='node' and t.target_id=r.node_id and t.reversed_at is null)`);
    }
    const listingsCount = Number((await query<{ c: string }>('select count(*)::text as c from public_listings'))[0].c);
    const requestsCount = Number((await query<{ c: string }>('select count(*)::text as c from public_requests'))[0].c);
    return { ok: true, kind, mode, started_at, finished_at: new Date().toISOString(), counts: { public_listings_written: listingsCount, public_requests_written: requestsCount } };
  });

  app.get('/healthz', async () => ({ ok: true }));

  return app;
}
