import crypto from 'node:crypto';
import process from 'node:process';

type JsonRpcId = string | number | null;
type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: any;
};

const SERVER_NAME = 'fabric-api-mcp-stdio';
const SERVER_VERSION = '0.1.0';
const DEFAULT_TIMEOUT_MS = 15_000;

const baseUrl = (process.env.FABRIC_API_BASE_URL ?? 'http://localhost:8080').replace(/\/+$/, '');
const apiKey = process.env.FABRIC_API_KEY ?? '';
const timeoutMs = Number(process.env.FABRIC_MCP_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);

const searchInputSchema = {
  type: 'object',
  properties: {
    q: { type: ['string', 'null'] },
    scope: { type: 'string', enum: ['local_in_person', 'remote_online_service', 'ship_to', 'digital_delivery', 'OTHER'] },
    filters: { type: 'object' },
    broadening: {
      type: 'object',
      properties: { level: { type: 'number' }, allow: { type: 'boolean' } },
    },
    budget: {
      type: 'object',
      properties: { credits_max: { type: 'number' } },
      required: ['credits_max'],
    },
    target: {
      type: 'object',
      properties: { node_id: { type: ['string', 'null'] }, username: { type: ['string', 'null'] } },
    },
    limit: { type: 'number' },
    cursor: { type: ['string', 'null'] },
  },
  required: ['scope', 'filters', 'budget'],
  additionalProperties: false,
};

const tools = [
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
      type: 'object',
      properties: { unit_id: { type: 'string' } },
      required: ['unit_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'fabric_get_request',
    description: 'Get a request by ID (caller must own the request).',
    inputSchema: {
      type: 'object',
      properties: { request_id: { type: 'string' } },
      required: ['request_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'fabric_get_offer',
    description: 'Get an offer by ID (caller must be a party to the offer).',
    inputSchema: {
      type: 'object',
      properties: { offer_id: { type: 'string' } },
      required: ['offer_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'fabric_get_events',
    description: 'Poll offer lifecycle events (webhook polling fallback).',
    inputSchema: {
      type: 'object',
      properties: {
        since: { type: ['string', 'null'] },
        limit: { type: 'number' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'fabric_get_credits',
    description: 'Get the authenticated node credit balance.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

function writeMessage(payload: any) {
  const body = JSON.stringify(payload);
  const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
  process.stdout.write(header);
  process.stdout.write(body);
}

function writeResult(id: JsonRpcId, result: any) {
  writeMessage({ jsonrpc: '2.0', id, result });
}

function writeError(id: JsonRpcId, code: number, message: string, data?: any) {
  writeMessage({ jsonrpc: '2.0', id, error: { code, message, data } });
}

function toolTextResult(payload: any, isError = false) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(payload, null, 2),
      },
    ],
    isError,
  };
}

function asObject(value: any) {
  if (!value || typeof value !== 'object') return {};
  return value;
}

function asNumber(value: any, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return fallback;
}

function asStringOrNull(value: any) {
  if (typeof value === 'string') return value;
  return null;
}

async function fabricRequest(
  path: string,
  options: { method?: 'GET' | 'POST'; body?: any; requireAuth?: boolean } = {},
) {
  const method = options.method ?? 'GET';
  const requireAuth = options.requireAuth ?? true;
  if (requireAuth && !apiKey) {
    throw new Error('FABRIC_API_KEY is required for this tool');
  }

  const headers: Record<string, string> = { Accept: 'application/json' };
  if (requireAuth) headers.Authorization = `ApiKey ${apiKey}`;
  if (method !== 'GET') {
    headers['Content-Type'] = 'application/json';
    headers['Idempotency-Key'] = `mcp:${Date.now()}:${crypto.randomUUID()}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: method === 'GET' ? undefined : JSON.stringify(options.body ?? {}),
      signal: controller.signal,
    });
    const responseText = await response.text();
    const responseJson = safeJsonParse(responseText);
    if (!response.ok) {
      throw new Error(`Fabric API ${method} ${path} failed (${response.status}): ${responseText}`);
    }
    return responseJson ?? responseText;
  } finally {
    clearTimeout(timer);
  }
}

function safeJsonParse(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

async function callTool(name: string, args: any) {
  if (name === 'fabric_search_listings' || name === 'fabric_search_requests') {
    const payload = asObject(args);
    const route = name === 'fabric_search_listings' ? '/v1/search/listings' : '/v1/search/requests';
    return await fabricRequest(route, {
      method: 'POST',
      body: {
        q: payload.q ?? null,
        scope: payload.scope,
        filters: payload.filters ?? {},
        broadening: payload.broadening ?? { level: 0, allow: false },
        budget: payload.budget ?? { credits_max: 5 },
        target: payload.target,
        limit: asNumber(payload.limit, 20),
        cursor: asStringOrNull(payload.cursor),
      },
    });
  }
  if (name === 'fabric_get_unit') {
    const unitId = String(asObject(args).unit_id ?? '');
    if (!unitId) throw new Error('unit_id is required');
    return await fabricRequest(`/v1/units/${encodeURIComponent(unitId)}`);
  }
  if (name === 'fabric_get_request') {
    const requestId = String(asObject(args).request_id ?? '');
    if (!requestId) throw new Error('request_id is required');
    return await fabricRequest(`/v1/requests/${encodeURIComponent(requestId)}`);
  }
  if (name === 'fabric_get_offer') {
    const offerId = String(asObject(args).offer_id ?? '');
    if (!offerId) throw new Error('offer_id is required');
    return await fabricRequest(`/v1/offers/${encodeURIComponent(offerId)}`);
  }
  if (name === 'fabric_get_events') {
    const payload = asObject(args);
    const params = new URLSearchParams();
    const since = asStringOrNull(payload.since);
    if (since) params.set('since', since);
    const limit = typeof payload.limit === 'number' ? payload.limit : 50;
    params.set('limit', String(limit));
    const qs = params.toString();
    return await fabricRequest(`/events${qs ? `?${qs}` : ''}`);
  }
  if (name === 'fabric_get_credits') {
    return await fabricRequest('/v1/credits/balance');
  }
  throw new Error(`Unknown tool: ${name}`);
}

async function handleMessage(message: JsonRpcRequest) {
  const method = message.method ?? '';
  const id = message.id ?? null;

  try {
    if (method === 'initialize') {
      writeResult(id, {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        serverInfo: {
          name: SERVER_NAME,
          version: SERVER_VERSION,
        },
      });
      return;
    }

    if (method === 'notifications/initialized') return;

    if (method === 'tools/list') {
      writeResult(id, { tools });
      return;
    }

    if (method === 'tools/call') {
      const params = asObject(message.params);
      const toolName = String(params.name ?? '');
      const toolArgs = asObject(params.arguments);
      try {
        const result = await callTool(toolName, toolArgs);
        writeResult(id, toolTextResult(result));
      } catch (err: any) {
        writeResult(id, toolTextResult({ error: err?.message ?? String(err), tool: toolName }, true));
      }
      return;
    }

    if (id !== null) writeError(id, -32601, `Method not found: ${method}`);
  } catch (err: any) {
    if (id !== null) writeError(id, -32603, err?.message ?? 'Internal server error');
  }
}

let inputBuffer = Buffer.alloc(0);

function drainBuffer() {
  while (true) {
    const headerEnd = inputBuffer.indexOf('\r\n\r\n');
    if (headerEnd < 0) return;
    const headerText = inputBuffer.slice(0, headerEnd).toString('utf8');
    const lengthMatch = /content-length:\s*(\d+)/i.exec(headerText);
    if (!lengthMatch) {
      inputBuffer = Buffer.alloc(0);
      return;
    }
    const bodyLength = Number(lengthMatch[1]);
    const frameLength = headerEnd + 4 + bodyLength;
    if (inputBuffer.length < frameLength) return;
    const body = inputBuffer.slice(headerEnd + 4, frameLength).toString('utf8');
    inputBuffer = inputBuffer.slice(frameLength);

    const parsed = safeJsonParse(body);
    if (!parsed) continue;
    void handleMessage(parsed);
  }
}

process.stdin.on('data', (chunk: Buffer) => {
  inputBuffer = Buffer.concat([inputBuffer, chunk]);
  drainBuffer();
});

process.stdin.on('error', (err) => {
  process.stderr.write(`stdin error: ${String(err)}\n`);
});
