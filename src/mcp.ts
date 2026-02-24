import crypto from 'node:crypto';
import Fastify, { FastifyRequest } from 'fastify';
import { errorEnvelope } from './http.js';

type AppInstance = ReturnType<typeof Fastify>;

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'fabric-api-readonly';
const SERVER_VERSION = '0.1.0';

type JsonRpcId = string | number | null;
type JsonRpcMessage = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

const searchInputSchema = {
  type: 'object' as const,
  properties: {
    q: { type: ['string', 'null'] as const, description: 'Free-text query (nullable).' },
    scope: { type: 'string' as const, enum: ['local_in_person', 'remote_online_service', 'ship_to', 'digital_delivery', 'OTHER'] },
    filters: { type: 'object' as const, description: 'Structured filters (category_ids_any, region, etc.).' },
    broadening: {
      type: 'object' as const,
      properties: { level: { type: 'number' as const }, allow: { type: 'boolean' as const } },
    },
    budget: {
      type: 'object' as const,
      properties: { credits_max: { type: 'number' as const, description: 'Maximum credits to spend.' } },
      required: ['credits_max'],
    },
    target: {
      type: 'object' as const,
      properties: {
        node_id: { type: ['string', 'null'] as const },
        username: { type: ['string', 'null'] as const },
      },
    },
    limit: { type: 'number' as const, description: 'Results per page (1-100, default 20).' },
    cursor: { type: ['string', 'null'] as const, description: 'Pagination cursor.' },
  },
  required: ['scope', 'filters', 'budget'],
  additionalProperties: false,
};

const TOOLS = [
  {
    name: 'fabric_search_listings',
    description: 'Search published listings. Metered: costs credits per the budget contract.',
    inputSchema: searchInputSchema,
  },
  {
    name: 'fabric_search_requests',
    description: 'Search published requests. Metered: costs credits per the budget contract.',
    inputSchema: searchInputSchema,
  },
  {
    name: 'fabric_get_unit',
    description: 'Get a unit by ID (caller must own the unit).',
    inputSchema: {
      type: 'object' as const,
      properties: { unit_id: { type: 'string' as const, description: 'UUID of the unit.' } },
      required: ['unit_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'fabric_get_request',
    description: 'Get a request by ID (caller must own the request).',
    inputSchema: {
      type: 'object' as const,
      properties: { request_id: { type: 'string' as const, description: 'UUID of the request.' } },
      required: ['request_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'fabric_get_offer',
    description: 'Get an offer by ID (caller must be a party to the offer).',
    inputSchema: {
      type: 'object' as const,
      properties: { offer_id: { type: 'string' as const, description: 'UUID of the offer.' } },
      required: ['offer_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'fabric_get_events',
    description: 'Poll offer lifecycle events (webhook polling fallback). Uses opaque cursor with strictly-after semantics.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        since: { type: ['string', 'null'] as const, description: 'Opaque cursor for strictly-after pagination.' },
        limit: { type: 'number' as const, description: 'Max events to return (1-100, default 50).' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'fabric_get_credits',
    description: 'Get the authenticated node credit balance.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      additionalProperties: false,
    },
  },
];

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  return { jsonrpc: '2.0' as const, id, error: { code, message, ...(data !== undefined ? { data } : {}) } };
}

function jsonRpcResult(id: JsonRpcId, result: unknown) {
  return { jsonrpc: '2.0' as const, id, result };
}

function toolContent(payload: unknown, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    isError,
  };
}

async function executeTool(
  app: AppInstance,
  authHeader: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  if (name === 'fabric_search_listings' || name === 'fabric_search_requests') {
    const route = name === 'fabric_search_listings' ? '/v1/search/listings' : '/v1/search/requests';
    const res = await app.inject({
      method: 'POST',
      url: route,
      headers: {
        authorization: authHeader,
        'content-type': 'application/json',
        'idempotency-key': `mcp:${Date.now()}:${crypto.randomUUID()}`,
      },
      payload: {
        q: args.q ?? null,
        scope: args.scope,
        filters: args.filters ?? {},
        broadening: args.broadening ?? { level: 0, allow: false },
        budget: args.budget ?? { credits_max: 5 },
        target: args.target,
        limit: typeof args.limit === 'number' ? args.limit : 20,
        cursor: typeof args.cursor === 'string' ? args.cursor : null,
      },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_unit') {
    const unitId = String(args.unit_id ?? '');
    if (!unitId) return { status: 422, body: errorEnvelope('validation_error', 'unit_id is required') };
    const res = await app.inject({
      method: 'GET',
      url: `/v1/units/${encodeURIComponent(unitId)}`,
      headers: { authorization: authHeader },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_request') {
    const requestId = String(args.request_id ?? '');
    if (!requestId) return { status: 422, body: errorEnvelope('validation_error', 'request_id is required') };
    const res = await app.inject({
      method: 'GET',
      url: `/v1/requests/${encodeURIComponent(requestId)}`,
      headers: { authorization: authHeader },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_offer') {
    const offerId = String(args.offer_id ?? '');
    if (!offerId) return { status: 422, body: errorEnvelope('validation_error', 'offer_id is required') };
    const res = await app.inject({
      method: 'GET',
      url: `/v1/offers/${encodeURIComponent(offerId)}`,
      headers: { authorization: authHeader },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_events') {
    const params = new URLSearchParams();
    if (typeof args.since === 'string') params.set('since', args.since);
    if (typeof args.limit === 'number') params.set('limit', String(args.limit));
    const qs = params.toString();
    const res = await app.inject({
      method: 'GET',
      url: `/events${qs ? `?${qs}` : ''}`,
      headers: { authorization: authHeader },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_credits') {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/credits/balance',
      headers: { authorization: authHeader },
    });
    return { status: res.statusCode, body: res.json() };
  }

  return { status: 400, body: errorEnvelope('unknown_tool', `Unknown tool: ${name}`) };
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function registerMcpRoute(app: AppInstance) {
  app.post('/mcp', async (req, reply) => {
    const raw = typeof req.body === 'string' ? safeJsonParse(req.body) : req.body;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return reply.status(200).send(jsonRpcError(null, -32700, 'Parse error'));
    }

    const msg = raw as JsonRpcMessage;
    const id = msg.id ?? null;
    const method = msg.method ?? '';

    if (method === 'initialize') {
      return jsonRpcResult(id, {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
    }

    if (method === 'notifications/initialized') {
      return reply.status(204).send();
    }

    if (method === 'tools/list') {
      return jsonRpcResult(id, { tools: TOOLS });
    }

    if (method === 'tools/call') {
      const params = (msg.params && typeof msg.params === 'object') ? msg.params : {};
      const toolName = String(params.name ?? '');
      const toolArgs = (params.arguments && typeof params.arguments === 'object')
        ? params.arguments as Record<string, unknown>
        : {};

      if (!TOOL_NAMES.has(toolName)) {
        return jsonRpcResult(id, toolContent(
          { error: 'unknown_tool', message: `Tool not in allowlist: ${toolName}` },
          true,
        ));
      }

      const authHeader = String(req.headers.authorization ?? '');
      try {
        const result = await executeTool(app, authHeader, toolName, toolArgs);
        const isError = result.status < 200 || result.status >= 300;
        return jsonRpcResult(id, toolContent(result.body, isError));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'internal_error';
        return jsonRpcResult(id, toolContent({ error: message }, true));
      }
    }

    return reply.status(200).send(jsonRpcError(id, -32601, `Method not found: ${method}`));
  });
}

export { TOOLS as MCP_TOOLS };
