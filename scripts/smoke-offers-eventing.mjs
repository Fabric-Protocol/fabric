#!/usr/bin/env node
/**
 * Required env vars:
 * - BASE_URL
 * - NODE_A_API_KEY
 * - NODE_B_API_KEY
 *
 * Optional env vars:
 * - NODE_A_ID
 * - NODE_B_ID
 * - DATABASE_URL (required to verify event_webhook_deliveries in DB)
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const REQUIRED_ENV = ['BASE_URL', 'NODE_A_API_KEY', 'NODE_B_API_KEY'];
for (const key of REQUIRED_ENV) {
  if (!process.env[key] || String(process.env[key]).trim() === '') {
    throw new Error(`Missing required env var: ${key}`);
  }
}

const BASE_URL = String(process.env.BASE_URL).replace(/\/+$/, '');
const NODE_A_API_KEY = String(process.env.NODE_A_API_KEY);
const NODE_B_API_KEY = String(process.env.NODE_B_API_KEY);
const ARTIFACTS_DIR = path.resolve(process.cwd(), 'artifacts');
const SIGNER_HEADERS = ['x-fabric-timestamp', 'x-fabric-signature'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function idemKey(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function unitPayload(title, scopeNotes = 'smoke-offers-eventing') {
  return {
    title,
    description: 'smoke runner unit',
    type: 'service',
    condition: null,
    quantity: 1,
    estimated_value: null,
    measure: 'EA',
    custom_measure: null,
    scope_primary: 'OTHER',
    scope_secondary: [],
    scope_notes: scopeNotes,
    location_text_public: null,
    origin_region: null,
    dest_region: null,
    service_region: null,
    delivery_format: null,
    tags: [],
    category_ids: [],
    public_summary: title,
  };
}

async function apiRequest({
  method,
  routePath,
  apiKey,
  body,
  query = null,
  requireIdempotency = false,
}) {
  const url = new URL(routePath, `${BASE_URL}/`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      url.searchParams.set(k, String(v));
    }
  }
  const headers = {
    authorization: `ApiKey ${apiKey}`,
  };
  if (requireIdempotency) {
    headers['idempotency-key'] = idemKey(method.toLowerCase());
  }
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
  }

  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const raw = await res.text();
  let json = null;
  if (raw.length > 0) {
    try {
      json = JSON.parse(raw);
    } catch {
      json = { raw };
    }
  }
  return { status: res.status, json, headers: Object.fromEntries(res.headers.entries()) };
}

function assert2xx(result, context) {
  if (result.status >= 200 && result.status < 300) return;
  const code = result?.json?.error?.code ? ` error.code=${result.json.error.code}` : '';
  throw new Error(`${context} failed: status=${result.status}${code}`);
}

async function fetchMe(label, apiKey) {
  const me = await apiRequest({ method: 'GET', routePath: '/v1/me', apiKey });
  assert2xx(me, `${label} GET /v1/me`);
  if (!me?.json?.node?.id) throw new Error(`${label} /v1/me missing node.id`);
  if (me?.json?.node?.status !== 'ACTIVE') {
    throw new Error(`${label} node.status must be ACTIVE, got ${String(me?.json?.node?.status ?? 'unknown')}`);
  }
  return me.json;
}

async function fetchEvents(apiKey, since, limit = 100) {
  const out = await apiRequest({
    method: 'GET',
    routePath: '/events',
    apiKey,
    query: { since, limit },
  });
  assert2xx(out, 'GET /events');
  if (!Array.isArray(out?.json?.events)) throw new Error('GET /events response missing events[]');
  return out.json;
}

async function pollEventsForOffers({
  nodeLabel,
  apiKey,
  sinceCursor,
  offerIds,
  requiredTypes,
  timeoutMs = 30000,
}) {
  const seenById = new Map();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const page = await fetchEvents(apiKey, sinceCursor, 100);
    for (const event of page.events) {
      if (offerIds.has(event.offer_id)) seenById.set(event.id, event);
    }
    const seenEvents = [...seenById.values()];
    const seenTypes = new Set(seenEvents.map((e) => e.type));
    const complete = requiredTypes.every((t) => seenTypes.has(t));
    if (complete) {
      return { events: seenEvents, next_cursor: page.next_cursor ?? null };
    }
    await sleep(1500);
  }

  const seenEvents = [...seenById.values()];
  const seenTypes = [...new Set(seenEvents.map((e) => e.type))].sort();
  throw new Error(`${nodeLabel} events did not reach required types before timeout; seen=${seenTypes.join(',')}`);
}

async function loadDbQuery() {
  try {
    const clientModuleUrl = new URL('../dist/src/db/client.js', import.meta.url);
    const mod = await import(clientModuleUrl.href);
    if (typeof mod.query !== 'function') throw new Error('query() export missing');
    return mod.query;
  } catch (err) {
    throw new Error(`Unable to load DB query helper from dist build: ${err?.message ?? String(err)}`);
  }
}

async function verifyWebhookDeliveries({ nodeIds, offerIds }) {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required to verify event_webhook_deliveries');
  }
  const query = await loadDbQuery();
  const rows = await query(
    `select
       d.event_id::text as event_id,
       d.node_id::text as node_id,
       d.status_code,
       d.ok,
       d.attempt_number,
       to_char(d.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at
     from event_webhook_deliveries d
     join offer_events e on e.id=d.event_id
     where d.node_id = any($1::uuid[])
       and e.offer_id = any($2::uuid[])
     order by d.created_at asc`,
    [nodeIds, offerIds],
  );

  const byNode = Object.fromEntries(nodeIds.map((id) => [id, { rows: 0, success_rows: 0 }]));
  for (const row of rows) {
    const entry = byNode[row.node_id] ?? { rows: 0, success_rows: 0 };
    entry.rows += 1;
    const statusCode = Number(row.status_code ?? 0);
    if (row.ok === true && statusCode >= 200 && statusCode < 300) {
      entry.success_rows += 1;
    }
    byNode[row.node_id] = entry;
  }

  for (const nodeId of nodeIds) {
    const entry = byNode[nodeId] ?? { rows: 0, success_rows: 0 };
    if (entry.rows < 1) throw new Error(`No webhook delivery rows found for node ${nodeId}`);
    if (entry.success_rows < 1) throw new Error(`No successful webhook delivery row found for node ${nodeId}`);
  }

  return { rows, by_node: byNode };
}

async function main() {
  await fs.mkdir(ARTIFACTS_DIR, { recursive: true });

  if (process.env.SMOKE_DRY_RUN === '1') {
    const payloadSamples = {
      unit_create: unitPayload('dry-run-unit'),
      offer_create: { unit_ids: ['00000000-0000-0000-0000-000000000000'], thread_id: null, note: 'dry-run' },
      offer_counter: { unit_ids: ['00000000-0000-0000-0000-000000000000'], note: 'dry-run' },
      offer_accept: {},
      reveal_contact: {},
    };
    await fs.writeFile(
      path.join(ARTIFACTS_DIR, 'smoke-eventing-dry-run.json'),
      `${JSON.stringify({ signer_headers: SIGNER_HEADERS, payload_samples: payloadSamples }, null, 2)}\n`,
      'utf8',
    );
    console.log('Dry run complete: payload samples written to artifacts/smoke-eventing-dry-run.json');
    return;
  }

  const startIso = new Date().toISOString();
  const meA = await fetchMe('Node A', NODE_A_API_KEY);
  const meB = await fetchMe('Node B', NODE_B_API_KEY);
  const nodeAId = process.env.NODE_A_ID ? String(process.env.NODE_A_ID) : String(meA.node.id);
  const nodeBId = process.env.NODE_B_ID ? String(process.env.NODE_B_ID) : String(meB.node.id);

  if (process.env.NODE_A_ID && process.env.NODE_A_ID !== meA.node.id) {
    throw new Error(`NODE_A_ID mismatch: env=${process.env.NODE_A_ID} /me=${meA.node.id}`);
  }
  if (process.env.NODE_B_ID && process.env.NODE_B_ID !== meB.node.id) {
    throw new Error(`NODE_B_ID mismatch: env=${process.env.NODE_B_ID} /me=${meB.node.id}`);
  }

  console.log(`Node A: ${nodeAId} (credits_balance=${meA.credits_balance})`);
  console.log(`Node B: ${nodeBId} (credits_balance=${meB.credits_balance})`);

  const baselineA = await fetchEvents(NODE_A_API_KEY, null, 1);
  const baselineB = await fetchEvents(NODE_B_API_KEY, null, 1);
  const sinceA = baselineA.next_cursor ?? null;
  const sinceB = baselineB.next_cursor ?? null;

  const createdUnit = await apiRequest({
    method: 'POST',
    routePath: '/v1/units',
    apiKey: NODE_B_API_KEY,
    requireIdempotency: true,
    body: unitPayload(`smoke-offers-eventing-${Date.now()}`),
  });
  assert2xx(createdUnit, 'Node B POST /v1/units');
  const unitId = createdUnit?.json?.unit?.id;
  if (!unitId) throw new Error('Unit creation response missing unit.id');

  const createdOfferForCounter = await apiRequest({
    method: 'POST',
    routePath: '/v1/offers',
    apiKey: NODE_A_API_KEY,
    requireIdempotency: true,
    body: { unit_ids: [unitId], thread_id: null, note: 'smoke-counter-segment' },
  });
  assert2xx(createdOfferForCounter, 'Node A POST /v1/offers (counter segment)');
  const offerCounterId = createdOfferForCounter?.json?.offer?.id;
  if (!offerCounterId) throw new Error('Counter segment offer missing id');

  const counter = await apiRequest({
    method: 'POST',
    routePath: `/v1/offers/${offerCounterId}/counter`,
    apiKey: NODE_B_API_KEY,
    requireIdempotency: true,
    body: { unit_ids: [unitId], note: 'smoke-counter' },
  });
  assert2xx(counter, 'Node B POST /v1/offers/{offer_id}/counter');

  const createdOfferForAccept = await apiRequest({
    method: 'POST',
    routePath: '/v1/offers',
    apiKey: NODE_A_API_KEY,
    requireIdempotency: true,
    body: { unit_ids: [unitId], thread_id: null, note: 'smoke-accept-segment' },
  });
  assert2xx(createdOfferForAccept, 'Node A POST /v1/offers (accept segment)');
  const offerAcceptId = createdOfferForAccept?.json?.offer?.id;
  if (!offerAcceptId) throw new Error('Accept segment offer missing id');

  const acceptByB = await apiRequest({
    method: 'POST',
    routePath: `/v1/offers/${offerAcceptId}/accept`,
    apiKey: NODE_B_API_KEY,
    requireIdempotency: true,
  });
  assert2xx(acceptByB, 'Node B POST /v1/offers/{offer_id}/accept');

  const acceptByA = await apiRequest({
    method: 'POST',
    routePath: `/v1/offers/${offerAcceptId}/accept`,
    apiKey: NODE_A_API_KEY,
    requireIdempotency: true,
  });
  assert2xx(acceptByA, 'Node A POST /v1/offers/{offer_id}/accept');

  const reveal = await apiRequest({
    method: 'POST',
    routePath: `/v1/offers/${offerAcceptId}/reveal-contact`,
    apiKey: NODE_A_API_KEY,
    requireIdempotency: true,
  });
  assert2xx(reveal, 'Node A POST /v1/offers/{offer_id}/reveal-contact');

  const offerIds = new Set([offerCounterId, offerAcceptId]);
  const requiredTypes = ['offer_created', 'offer_countered', 'offer_accepted', 'offer_contact_revealed'];

  const eventsA = await pollEventsForOffers({
    nodeLabel: 'Node A',
    apiKey: NODE_A_API_KEY,
    sinceCursor: sinceA,
    offerIds,
    requiredTypes,
  });
  const eventsB = await pollEventsForOffers({
    nodeLabel: 'Node B',
    apiKey: NODE_B_API_KEY,
    sinceCursor: sinceB,
    offerIds,
    requiredTypes,
  });

  const deliveries = await verifyWebhookDeliveries({
    nodeIds: [nodeAId, nodeBId],
    offerIds: [offerCounterId, offerAcceptId],
  });

  const eventArtifact = {
    started_at: startIso,
    completed_at: new Date().toISOString(),
    base_url: BASE_URL,
    node_ids: { node_a: nodeAId, node_b: nodeBId },
    offer_ids: {
      counter_segment_offer_id: offerCounterId,
      accept_segment_offer_id: offerAcceptId,
    },
    cursors: {
      node_a_since: sinceA,
      node_b_since: sinceB,
      node_a_next_cursor: eventsA.next_cursor,
      node_b_next_cursor: eventsB.next_cursor,
    },
    signer_headers: SIGNER_HEADERS,
    events_observed: {
      node_a: eventsA.events.map((e) => ({ id: e.id, type: e.type, offer_id: e.offer_id, created_at: e.created_at })),
      node_b: eventsB.events.map((e) => ({ id: e.id, type: e.type, offer_id: e.offer_id, created_at: e.created_at })),
    },
  };
  const deliveryArtifact = {
    started_at: startIso,
    completed_at: new Date().toISOString(),
    signer_headers: SIGNER_HEADERS,
    summary: deliveries.by_node,
    rows: deliveries.rows,
  };

  const eventArtifactPath = path.join(ARTIFACTS_DIR, 'smoke-eventing.json');
  const deliveryArtifactPath = path.join(ARTIFACTS_DIR, 'smoke-webhook-deliveries.json');
  await fs.writeFile(eventArtifactPath, `${JSON.stringify(eventArtifact, null, 2)}\n`, 'utf8');
  await fs.writeFile(deliveryArtifactPath, `${JSON.stringify(deliveryArtifact, null, 2)}\n`, 'utf8');

  console.log(`Wrote ${eventArtifactPath}`);
  console.log(`Wrote ${deliveryArtifactPath}`);
  console.log(`Signer headers: ${SIGNER_HEADERS.join(', ')}`);
}

main().catch((err) => {
  console.error(`SMOKE FAILED: ${err?.message ?? String(err)}`);
  process.exitCode = 1;
});
