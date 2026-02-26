import crypto from 'node:crypto';
import Fastify, { FastifyRequest } from 'fastify';
import { errorEnvelope } from './http.js';

type AppInstance = ReturnType<typeof Fastify>;

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'fabric-marketplace';
const SERVER_VERSION = '0.1.0';
const SERVER_DISPLAY_NAME = 'Fabric Marketplace';
const SERVER_HOMEPAGE = 'https://github.com/Fabric-Protocol/fabric';
const SERVER_ICON = 'https://raw.githubusercontent.com/Fabric-Protocol/fabric/main/icon.png';

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
    scope: { type: 'string' as const, enum: ['local_in_person', 'remote_online_service', 'ship_to', 'digital_delivery', 'OTHER'], description: 'Primary modality for the search (determines required filters).' },
    filters: { type: 'object' as const, description: 'Structured filters (category_ids_any, region, etc.).' },
    broadening: {
      type: 'object' as const,
      properties: { level: { type: 'number' as const, description: 'Broadening level (0 = none).' }, allow: { type: 'boolean' as const, description: 'Allow automatic broadening.' } },
      description: 'Optional broadening settings (deprecated, defaults to level 0).',
    },
    budget: {
      type: 'object' as const,
      properties: { credits_requested: { type: 'number' as const, description: 'Maximum credits to spend on this search call.' } },
      required: ['credits_requested'],
      description: 'Spend ceiling for this search.',
    },
    target: {
      type: 'object' as const,
      properties: {
        node_id: { type: ['string', 'null'] as const, description: 'Restrict search to a specific node by ID.' },
        username: { type: ['string', 'null'] as const, description: 'Restrict search to a specific node by display name.' },
      },
      description: 'Optional target constraint to search a specific node.',
    },
    limit: { type: 'number' as const, description: 'Results per page (1-100, default 20).' },
    cursor: { type: ['string', 'null'] as const, description: 'Pagination cursor from a previous search response.' },
  },
  required: ['scope', 'filters', 'budget'],
  additionalProperties: false,
};

const readOnlyAnnotation = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const searchAnnotation = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

const TOOLS = [
  {
    name: 'fabric_search_listings',
    description: 'Search published marketplace listings (supply side). Metered: costs credits per the budget contract. Returns matching public listings with scope-specific ranking.',
    inputSchema: searchInputSchema,
    annotations: searchAnnotation,
  },
  {
    name: 'fabric_search_requests',
    description: 'Search published marketplace requests (demand side). Metered: costs credits per the budget contract. Returns matching public requests with scope-specific ranking.',
    inputSchema: searchInputSchema,
    annotations: searchAnnotation,
  },
  {
    name: 'fabric_get_unit',
    description: 'Get a unit (resource) by ID. Returns full unit details including title, description, scope, condition, quantity, and publish status. Caller must own the unit.',
    inputSchema: {
      type: 'object' as const,
      properties: { unit_id: { type: 'string' as const, description: 'UUID of the unit to retrieve.' } },
      required: ['unit_id'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_get_request',
    description: 'Get a request (need) by ID. Returns full request details including title, description, scope, need_by, and publish status. Caller must own the request.',
    inputSchema: {
      type: 'object' as const,
      properties: { request_id: { type: 'string' as const, description: 'UUID of the request to retrieve.' } },
      required: ['request_id'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_get_offer',
    description: 'Get an offer by ID. Returns offer status, hold summary, expiry, and negotiation thread info. Caller must be a party to the offer.',
    inputSchema: {
      type: 'object' as const,
      properties: { offer_id: { type: 'string' as const, description: 'UUID of the offer to retrieve.' } },
      required: ['offer_id'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_get_events',
    description: 'Poll offer lifecycle events for the authenticated node. Returns events like offer_created, offer_accepted, offer_countered, etc. Uses opaque cursor with strictly-after semantics.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        since: { type: ['string', 'null'] as const, description: 'Opaque cursor from previous response for strictly-after pagination.' },
        limit: { type: 'number' as const, description: 'Max events to return (1-100, default 50).' },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_get_credits',
    description: 'Get the authenticated node\'s current credit balance and subscription status. Use before searches to check affordability.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      additionalProperties: false,
    },
    annotations: readOnlyAnnotation,
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

function validateToolArgs(toolName: string, args: Record<string, unknown>): string | null {
  const tool = TOOLS.find((t) => t.name === toolName);
  if (!tool) return null;
  const required = (tool.inputSchema as any).required;
  if (!Array.isArray(required)) return null;
  const missing = required.filter((field: string) => args[field] === undefined || args[field] === null);
  if (missing.length === 0) return null;
  return `Missing required argument(s): ${missing.join(', ')}`;
}

async function executeTool(
  app: AppInstance,
  authHeader: string,
  name: string,
  args: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  const argError = validateToolArgs(name, args);
  if (argError) {
    return { status: 422, body: errorEnvelope('validation_error', argError, { missing_args: (TOOLS.find((t) => t.name === name)?.inputSchema as any)?.required?.filter((f: string) => args[f] === undefined || args[f] === null) }) };
  }

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
        budget: args.budget ?? { credits_requested: 5 },
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
      url: `/v1/events${qs ? `?${qs}` : ''}`,
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
  app.get('/mcp', async (_req, reply) => {
    reply.header('Content-Type', 'text/event-stream');
    return reply.status(200).send('');
  });

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
        capabilities: { tools: {}, prompts: {}, resources: {} },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
          displayName: SERVER_DISPLAY_NAME,
          homepage: SERVER_HOMEPAGE,
          icon: SERVER_ICON,
        },
      });
    }

    if (method === 'notifications/initialized') {
      return reply.status(204).send();
    }

    if (method === 'prompts/list') {
      return jsonRpcResult(id, { prompts: [
        {
          name: 'fabric_quickstart',
          description: 'Step-by-step guide to bootstrap a node, publish a resource, search, and make your first offer on Fabric.',
        },
      ] });
    }

    if (method === 'prompts/get') {
      const params = (msg.params && typeof msg.params === 'object') ? msg.params : {};
      const promptName = String(params.name ?? '');
      if (promptName === 'fabric_quickstart') {
        return jsonRpcResult(id, {
          description: 'Fabric Marketplace quickstart guide',
          messages: [
            {
              role: 'user',
              content: { type: 'text', text: [
                'Walk me through using the Fabric Marketplace API:',
                '1. Bootstrap: POST /v1/bootstrap with display_name and legal acceptance to get an API key and 100 free credits.',
                '2. Create a unit: POST /v1/units with title, scope, and category.',
                '3. Publish it: POST /v1/units/{id}/publish to make it searchable.',
                '4. Search: POST /v1/search/listings with scope, filters, and budget.',
                '5. Make an offer: POST /v1/offers with unit_ids from search results.',
                '6. Accept: POST /v1/offers/{id}/accept — both sides must accept for mutual acceptance.',
                '7. Reveal contact: POST /v1/offers/{id}/reveal-contact after mutual acceptance.',
                '',
                'API base: https://fabric-api-393345198409.us-west1.run.app',
                'Docs: https://github.com/Fabric-Protocol/fabric',
              ].join('\n') },
            },
          ],
        });
      }
      return reply.status(200).send(jsonRpcError(id, -32602, `Unknown prompt: ${promptName}`));
    }

    if (method === 'resources/list') {
      return jsonRpcResult(id, { resources: [] });
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

      const rawApiKey = String(req.headers['api_key'] ?? req.headers['api-key'] ?? '');
      const authHeader = rawApiKey
        ? `ApiKey ${rawApiKey}`
        : String(req.headers.authorization ?? '');
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
