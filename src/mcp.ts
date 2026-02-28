import crypto from 'node:crypto';
import Fastify, { FastifyRequest } from 'fastify';
import { errorEnvelope } from './http.js';

type AppInstance = ReturnType<typeof Fastify>;

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'fabric-marketplace';
const SERVER_VERSION = '0.2.0';
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

/* ---------- annotation presets ---------- */

const readOnlyAnnotation = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const searchAnnotation = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const createAnnotation = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
const idempotentMutationAnnotation = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/* ---------- shared input schemas ---------- */

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

const scopeEnum = ['local_in_person', 'remote_online_service', 'ship_to', 'digital_delivery', 'OTHER'];

const unitCreateSchema = {
  type: 'object' as const,
  properties: {
    title: { type: 'string' as const, description: 'Title of the unit/resource.' },
    description: { type: ['string', 'null'] as const, description: 'Detailed description.' },
    type: { type: ['string', 'null'] as const, description: 'Type of resource (e.g. "goods", "service"). Required at publish time.' },
    condition: { type: ['string', 'null'] as const, enum: ['new', 'like_new', 'good', 'fair', 'poor', 'unknown', null], description: 'Condition of the item.' },
    quantity: { type: ['number', 'null'] as const, description: 'Quantity available.' },
    estimated_value: { type: ['number', 'null'] as const, description: 'Estimated value (informational only).' },
    measure: { type: ['string', 'null'] as const, enum: ['EA', 'KG', 'LB', 'L', 'GAL', 'M', 'FT', 'HR', 'DAY', 'LOT', 'CUSTOM', null], description: 'Unit of measure.' },
    custom_measure: { type: ['string', 'null'] as const, description: 'Custom measure label (when measure=CUSTOM).' },
    scope_primary: { type: ['string', 'null'] as const, enum: [...scopeEnum, null], description: 'Primary scope. Required at publish time.' },
    scope_secondary: { type: ['array', 'null'] as const, description: 'Secondary scopes (array of scope strings).' },
    scope_notes: { type: ['string', 'null'] as const, description: 'Notes for OTHER scope.' },
    location_text_public: { type: ['string', 'null'] as const, description: 'Public location text (required for local_in_person).' },
    origin_region: { type: ['object', 'null'] as const, description: 'Origin region object {country_code, admin1, ...} (required for ship_to).' },
    dest_region: { type: ['object', 'null'] as const, description: 'Destination region object (required for ship_to).' },
    service_region: { type: ['object', 'null'] as const, description: 'Service region {country_code, admin1} (required for remote_online_service).' },
    delivery_format: { type: ['string', 'null'] as const, enum: ['file', 'license_key', 'download_link', 'other', null], description: 'Delivery format (required for digital_delivery).' },
    tags: { type: ['array', 'null'] as const, description: 'Tags (array of strings).' },
    category_ids: { type: ['array', 'null'] as const, description: 'Category IDs (array of integers). Use fabric_get_categories to discover valid IDs.' },
    public_summary: { type: ['string', 'null'] as const, description: 'Public summary shown in search results.' },
  },
  required: ['title'],
  additionalProperties: false,
};

const requestCreateSchema = {
  type: 'object' as const,
  properties: {
    ...unitCreateSchema.properties,
    need_by: { type: ['string', 'null'] as const, description: 'ISO date by which the need must be fulfilled.' },
    accept_substitutions: { type: ['boolean', 'null'] as const, description: 'Whether substitutes are acceptable (default true).' },
    ttl_minutes: { type: ['number', 'null'] as const, description: 'Time-to-live in minutes (60-525600, default 525600 = 365 days).' },
  },
  required: ['title'],
  additionalProperties: false,
};

/* ---------- unauthenticated tools ---------- */

const UNAUTH_TOOL_NAMES = new Set(['fabric_bootstrap', 'fabric_get_meta', 'fabric_get_categories', 'fabric_get_regions']);

/* ---------- tool definitions ---------- */

const TOOLS = [
  // --- Phase A: Bootstrap + Identity (unauthenticated) ---
  {
    name: 'fabric_bootstrap',
    description: 'Create a new Fabric node and receive an API key + 100 free credits. No authentication required. Provide a display_name to get started. The tool auto-accepts the current legal version. Returns your node profile, API key, and initial credit grant.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        display_name: { type: 'string' as const, description: 'Display name for the new node.' },
        email: { type: ['string', 'null'] as const, description: 'Optional email for account recovery.' },
        referral_code: { type: ['string', 'null'] as const, description: 'Optional referral code from another node.' },
      },
      required: ['display_name'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_get_meta',
    description: 'Get Fabric service metadata: current legal version, API version, category/docs/legal URLs. No authentication required. Call this before bootstrap to discover the service.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_get_categories',
    description: 'Get the full category registry with IDs, slugs, names, descriptions, and examples. No authentication required. Use category IDs when creating units/requests.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_get_regions',
    description: 'Get supported region codes for search filters and scope fields. No authentication required. Returns ISO 3166-1/2 codes (e.g. "US", "US-CA").',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotation,
  },

  // --- Existing: Search (metered) ---
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

  // --- Phase B: Inventory Creation + Publishing ---
  {
    name: 'fabric_create_unit',
    description: 'Create a new unit (resource/listing). At minimum provide a title. Add type, scope_primary, and category_ids before publishing. Use fabric_get_categories for valid category IDs.',
    inputSchema: unitCreateSchema,
    annotations: createAnnotation,
  },
  {
    name: 'fabric_publish_unit',
    description: 'Publish a unit to make it visible in marketplace search. The unit must have title, type, and scope_primary set. Scope-specific fields are validated at publish time.',
    inputSchema: {
      type: 'object' as const,
      properties: { unit_id: { type: 'string' as const, description: 'UUID of the unit to publish.' } },
      required: ['unit_id'],
      additionalProperties: false,
    },
    annotations: idempotentMutationAnnotation,
  },
  {
    name: 'fabric_unpublish_unit',
    description: 'Remove a unit from public marketplace search. The unit remains in your inventory as a draft.',
    inputSchema: {
      type: 'object' as const,
      properties: { unit_id: { type: 'string' as const, description: 'UUID of the unit to unpublish.' } },
      required: ['unit_id'],
      additionalProperties: false,
    },
    annotations: idempotentMutationAnnotation,
  },
  {
    name: 'fabric_create_request',
    description: 'Create a new request (need/want). At minimum provide a title. Add type, scope_primary, and category_ids before publishing. Optionally set need_by date and ttl_minutes.',
    inputSchema: requestCreateSchema,
    annotations: createAnnotation,
  },
  {
    name: 'fabric_publish_request',
    description: 'Publish a request to make it visible in marketplace search. The request must have title, type, and scope_primary set.',
    inputSchema: {
      type: 'object' as const,
      properties: { request_id: { type: 'string' as const, description: 'UUID of the request to publish.' } },
      required: ['request_id'],
      additionalProperties: false,
    },
    annotations: idempotentMutationAnnotation,
  },
  {
    name: 'fabric_unpublish_request',
    description: 'Remove a request from public marketplace search. The request remains in your inventory as a draft.',
    inputSchema: {
      type: 'object' as const,
      properties: { request_id: { type: 'string' as const, description: 'UUID of the request to unpublish.' } },
      required: ['request_id'],
      additionalProperties: false,
    },
    annotations: idempotentMutationAnnotation,
  },
  {
    name: 'fabric_list_units',
    description: 'List your own units (resources/listings). Returns both draft and published units, excluding deleted.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cursor: { type: ['string', 'null'] as const, description: 'Pagination cursor.' },
        limit: { type: 'number' as const, description: 'Results per page (default 20).' },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_list_requests',
    description: 'List your own requests (needs/wants). Returns both draft and published requests, excluding deleted.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cursor: { type: ['string', 'null'] as const, description: 'Pagination cursor.' },
        limit: { type: 'number' as const, description: 'Results per page (default 20).' },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotation,
  },

  // --- Existing: Read tools ---
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
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotation,
  },

  // --- Phase C: Offer Lifecycle ---
  {
    name: 'fabric_create_offer',
    description: 'Create an offer on one or more units owned by another node. Specify unit_ids from search results. Optionally set a note and ttl_minutes (15-10080, default 2880 = 48h). Creates holds on the units immediately.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        unit_ids: { type: 'array' as const, items: { type: 'string' as const }, description: 'Array of unit UUIDs to include in the offer (must all belong to same owner).' },
        thread_id: { type: ['string', 'null'] as const, description: 'Optional thread UUID for counter-offers within an existing negotiation.' },
        note: { type: ['string', 'null'] as const, description: 'Optional note/message to include with the offer.' },
        ttl_minutes: { type: ['number', 'null'] as const, description: 'Time-to-live in minutes (15-10080, default 2880 = 48h).' },
      },
      required: ['unit_ids'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_counter_offer',
    description: 'Counter an existing offer with different unit_ids. Creates a new offer in the same negotiation thread and marks the original as countered. Releases old holds and creates new ones.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        offer_id: { type: 'string' as const, description: 'UUID of the offer to counter.' },
        unit_ids: { type: 'array' as const, items: { type: 'string' as const }, description: 'Array of unit UUIDs for the counter-offer.' },
        note: { type: ['string', 'null'] as const, description: 'Optional note/message.' },
        ttl_minutes: { type: ['number', 'null'] as const, description: 'Time-to-live in minutes (15-10080, default 2880).' },
      },
      required: ['offer_id', 'unit_ids'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_accept_offer',
    description: 'Accept an offer. Both sides must accept for mutual acceptance. On mutual acceptance: units are unpublished, holds become committed, 1 credit is charged to each side, and contact reveal becomes available.',
    inputSchema: {
      type: 'object' as const,
      properties: { offer_id: { type: 'string' as const, description: 'UUID of the offer to accept.' } },
      required: ['offer_id'],
      additionalProperties: false,
    },
    annotations: idempotentMutationAnnotation,
  },
  {
    name: 'fabric_reject_offer',
    description: 'Reject an offer (terminal). Releases all holds immediately. Either party can reject.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        offer_id: { type: 'string' as const, description: 'UUID of the offer to reject.' },
        reason: { type: ['string', 'null'] as const, description: 'Optional reason for rejection.' },
      },
      required: ['offer_id'],
      additionalProperties: false,
    },
    annotations: idempotentMutationAnnotation,
  },
  {
    name: 'fabric_cancel_offer',
    description: 'Cancel an offer you created. Releases all holds immediately. Only the offer creator can cancel.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        offer_id: { type: 'string' as const, description: 'UUID of the offer to cancel.' },
        reason: { type: ['string', 'null'] as const, description: 'Optional reason for cancellation.' },
      },
      required: ['offer_id'],
      additionalProperties: false,
    },
    annotations: idempotentMutationAnnotation,
  },
  {
    name: 'fabric_reveal_contact',
    description: 'Reveal counterparty contact info after mutual acceptance. Returns email, phone, and messaging handles. Only available when offer status is mutually_accepted.',
    inputSchema: {
      type: 'object' as const,
      properties: { offer_id: { type: 'string' as const, description: 'UUID of the mutually accepted offer.' } },
      required: ['offer_id'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_list_offers',
    description: 'List offers you have made or received. Filter by role to see sent offers (made) or incoming offers (received).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        role: { type: 'string' as const, enum: ['made', 'received'], description: 'Filter: "made" for offers you sent, "received" for offers sent to you.' },
        cursor: { type: ['string', 'null'] as const, description: 'Pagination cursor.' },
        limit: { type: 'number' as const, description: 'Results per page (default 20).' },
      },
      required: ['role'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotation,
  },

  // --- Phase D: Billing + Credits ---
  {
    name: 'fabric_get_credit_quote',
    description: 'Get your credit balance, estimated search costs, available credit packs with prices, and subscription plans. Use this to understand pricing and check affordability before spending credits.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_buy_credit_pack_stripe',
    description: 'Start a Stripe checkout to buy a credit pack. Returns a checkout_url to complete payment. Pack options: credits_500 ($9.99), credits_1500 ($19.99), credits_4500 ($49.99).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pack_code: { type: 'string' as const, enum: ['credits_500', 'credits_1500', 'credits_4500'], description: 'Which credit pack to purchase.' },
        success_url: { type: 'string' as const, description: 'URL to redirect to after successful payment.' },
        cancel_url: { type: 'string' as const, description: 'URL to redirect to if payment is cancelled.' },
      },
      required: ['pack_code', 'success_url', 'cancel_url'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_subscribe_stripe',
    description: 'Start a Stripe checkout for a subscription plan. Returns a checkout_url to complete signup. Plans: basic ($9.99/mo, 1000 credits), pro ($19.99/mo, 3000 credits), business ($49.99/mo, 10000 credits).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        plan_code: { type: 'string' as const, enum: ['basic', 'pro', 'business'], description: 'Subscription plan to sign up for.' },
        success_url: { type: 'string' as const, description: 'URL to redirect to after successful signup.' },
        cancel_url: { type: 'string' as const, description: 'URL to redirect to if signup is cancelled.' },
      },
      required: ['plan_code', 'success_url', 'cancel_url'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_buy_credit_pack_crypto',
    description: 'Create a crypto payment invoice for a credit pack. Returns a pay_address and pay_amount — send the exact amount to complete purchase. Fully agent-native, no browser needed. Use fabric_get_crypto_currencies to see available currencies.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pack_code: { type: 'string' as const, enum: ['credits_500', 'credits_1500', 'credits_4500'], description: 'Which credit pack to purchase.' },
        pay_currency: { type: 'string' as const, description: 'Crypto currency to pay with (e.g. "usdcsol", "btc", "eth"). Use fabric_get_crypto_currencies for the full list.' },
      },
      required: ['pack_code', 'pay_currency'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_get_crypto_currencies',
    description: 'List available crypto currencies for credit pack purchases.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotation,
  },

  // --- Phase E: Profile + Account ---
  {
    name: 'fabric_get_profile',
    description: 'Get your node profile including display name, email, subscription status, plan, and credit balance.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_update_profile',
    description: 'Update your node profile. You can change display_name, email, messaging_handles (for contact reveal), and event_webhook_url (for offer event notifications).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        display_name: { type: ['string', 'null'] as const, description: 'New display name.' },
        email: { type: ['string', 'null'] as const, description: 'New email address.' },
        messaging_handles: {
          type: ['array', 'null'] as const,
          description: 'Array of {kind, handle, url} objects for contact reveal (max 10). Example: [{kind:"telegram", handle:"@mybot"}].',
        },
        event_webhook_url: { type: ['string', 'null'] as const, description: 'URL to receive offer lifecycle event webhooks.' },
        event_webhook_secret: { type: ['string', 'null'] as const, description: 'Secret for webhook signature verification (write-only, set null to clear).' },
      },
      additionalProperties: false,
    },
    annotations: idempotentMutationAnnotation,
  },
  {
    name: 'fabric_get_ledger',
    description: 'Get your credit ledger: a history of all credit grants, debits, and adjustments.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        cursor: { type: ['string', 'null'] as const, description: 'Pagination cursor.' },
        limit: { type: 'number' as const, description: 'Results per page (default 20).' },
      },
      additionalProperties: false,
    },
    annotations: readOnlyAnnotation,
  },
];

const TOOL_NAMES = new Set(TOOLS.map((t) => t.name));

/* ---------- helpers ---------- */

function idemKey(): string {
  return `mcp:${Date.now()}:${crypto.randomUUID()}`;
}

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

function authedHeaders(authHeader: string) {
  return { authorization: authHeader, 'content-type': 'application/json' };
}

function postHeaders(authHeader: string) {
  return { ...authedHeaders(authHeader), 'idempotency-key': idemKey() };
}

/* ---------- tool execution ---------- */

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

  // --- Phase A: Bootstrap + Identity (unauthenticated) ---

  if (name === 'fabric_bootstrap') {
    const metaRes = await app.inject({ method: 'GET', url: '/v1/meta' });
    const metaBody = metaRes.json() as Record<string, unknown>;
    const legalVersion = String(metaBody.required_legal_version ?? '2026-02-17');

    const res = await app.inject({
      method: 'POST',
      url: '/v1/bootstrap',
      headers: { 'content-type': 'application/json', 'idempotency-key': idemKey() },
      payload: {
        display_name: args.display_name,
        email: args.email ?? null,
        referral_code: args.referral_code ?? null,
        recovery_public_key: null,
        messaging_handles: [],
        legal: { accepted: true, version: legalVersion },
      },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_meta') {
    const res = await app.inject({ method: 'GET', url: '/v1/meta' });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_categories') {
    const res = await app.inject({ method: 'GET', url: '/v1/categories' });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_regions') {
    const res = await app.inject({ method: 'GET', url: '/v1/regions' });
    return { status: res.statusCode, body: res.json() };
  }

  // --- Search ---

  if (name === 'fabric_search_listings' || name === 'fabric_search_requests') {
    const route = name === 'fabric_search_listings' ? '/v1/search/listings' : '/v1/search/requests';
    const res = await app.inject({
      method: 'POST',
      url: route,
      headers: postHeaders(authHeader),
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

  // --- Phase B: Inventory Creation + Publishing ---

  if (name === 'fabric_create_unit') {
    const payload: Record<string, unknown> = { title: args.title };
    const optionalFields = [
      'description', 'type', 'condition', 'quantity', 'estimated_value', 'measure',
      'custom_measure', 'scope_primary', 'scope_secondary', 'scope_notes',
      'location_text_public', 'origin_region', 'dest_region', 'service_region',
      'delivery_format', 'tags', 'category_ids', 'public_summary',
    ];
    for (const f of optionalFields) {
      if (args[f] !== undefined) payload[f] = args[f];
    }
    const res = await app.inject({ method: 'POST', url: '/v1/units', headers: postHeaders(authHeader), payload });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_publish_unit') {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/units/${encodeURIComponent(String(args.unit_id))}/publish`,
      headers: postHeaders(authHeader),
      payload: {},
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_unpublish_unit') {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/units/${encodeURIComponent(String(args.unit_id))}/unpublish`,
      headers: postHeaders(authHeader),
      payload: {},
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_create_request') {
    const payload: Record<string, unknown> = { title: args.title };
    const optionalFields = [
      'description', 'type', 'condition', 'quantity', 'estimated_value', 'measure',
      'custom_measure', 'scope_primary', 'scope_secondary', 'scope_notes',
      'location_text_public', 'origin_region', 'dest_region', 'service_region',
      'delivery_format', 'tags', 'category_ids', 'public_summary',
      'need_by', 'accept_substitutions', 'ttl_minutes',
    ];
    for (const f of optionalFields) {
      if (args[f] !== undefined) payload[f] = args[f];
    }
    const res = await app.inject({ method: 'POST', url: '/v1/requests', headers: postHeaders(authHeader), payload });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_publish_request') {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/requests/${encodeURIComponent(String(args.request_id))}/publish`,
      headers: postHeaders(authHeader),
      payload: {},
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_unpublish_request') {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/requests/${encodeURIComponent(String(args.request_id))}/unpublish`,
      headers: postHeaders(authHeader),
      payload: {},
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_list_units') {
    const params = new URLSearchParams();
    if (typeof args.cursor === 'string') params.set('cursor', args.cursor);
    if (typeof args.limit === 'number') params.set('limit', String(args.limit));
    const qs = params.toString();
    const res = await app.inject({ method: 'GET', url: `/v1/units${qs ? `?${qs}` : ''}`, headers: authedHeaders(authHeader) });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_list_requests') {
    const params = new URLSearchParams();
    if (typeof args.cursor === 'string') params.set('cursor', args.cursor);
    if (typeof args.limit === 'number') params.set('limit', String(args.limit));
    const qs = params.toString();
    const res = await app.inject({ method: 'GET', url: `/v1/requests${qs ? `?${qs}` : ''}`, headers: authedHeaders(authHeader) });
    return { status: res.statusCode, body: res.json() };
  }

  // --- Existing: Read tools ---

  if (name === 'fabric_get_unit') {
    const res = await app.inject({ method: 'GET', url: `/v1/units/${encodeURIComponent(String(args.unit_id))}`, headers: authedHeaders(authHeader) });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_request') {
    const res = await app.inject({ method: 'GET', url: `/v1/requests/${encodeURIComponent(String(args.request_id))}`, headers: authedHeaders(authHeader) });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_offer') {
    const res = await app.inject({ method: 'GET', url: `/v1/offers/${encodeURIComponent(String(args.offer_id))}`, headers: authedHeaders(authHeader) });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_events') {
    const params = new URLSearchParams();
    if (typeof args.since === 'string') params.set('since', args.since);
    if (typeof args.limit === 'number') params.set('limit', String(args.limit));
    const qs = params.toString();
    const res = await app.inject({ method: 'GET', url: `/v1/events${qs ? `?${qs}` : ''}`, headers: authedHeaders(authHeader) });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_credits') {
    const res = await app.inject({ method: 'GET', url: '/v1/credits/balance', headers: authedHeaders(authHeader) });
    return { status: res.statusCode, body: res.json() };
  }

  // --- Phase C: Offer Lifecycle ---

  if (name === 'fabric_create_offer') {
    const payload: Record<string, unknown> = { unit_ids: args.unit_ids };
    if (args.thread_id !== undefined) payload.thread_id = args.thread_id;
    if (args.note !== undefined) payload.note = args.note;
    if (args.ttl_minutes !== undefined) payload.ttl_minutes = args.ttl_minutes;
    const res = await app.inject({ method: 'POST', url: '/v1/offers', headers: postHeaders(authHeader), payload });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_counter_offer') {
    const payload: Record<string, unknown> = { unit_ids: args.unit_ids };
    if (args.note !== undefined) payload.note = args.note;
    if (args.ttl_minutes !== undefined) payload.ttl_minutes = args.ttl_minutes;
    const res = await app.inject({
      method: 'POST',
      url: `/v1/offers/${encodeURIComponent(String(args.offer_id))}/counter`,
      headers: postHeaders(authHeader),
      payload,
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_accept_offer') {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/offers/${encodeURIComponent(String(args.offer_id))}/accept`,
      headers: postHeaders(authHeader),
      payload: {},
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_reject_offer') {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/offers/${encodeURIComponent(String(args.offer_id))}/reject`,
      headers: postHeaders(authHeader),
      payload: { reason: args.reason ?? null },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_cancel_offer') {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/offers/${encodeURIComponent(String(args.offer_id))}/cancel`,
      headers: postHeaders(authHeader),
      payload: { reason: args.reason ?? null },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_reveal_contact') {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/offers/${encodeURIComponent(String(args.offer_id))}/reveal-contact`,
      headers: postHeaders(authHeader),
      payload: {},
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_list_offers') {
    const params = new URLSearchParams();
    params.set('role', String(args.role));
    if (typeof args.cursor === 'string') params.set('cursor', args.cursor);
    if (typeof args.limit === 'number') params.set('limit', String(args.limit));
    const qs = params.toString();
    const res = await app.inject({ method: 'GET', url: `/v1/offers?${qs}`, headers: authedHeaders(authHeader) });
    return { status: res.statusCode, body: res.json() };
  }

  // --- Phase D: Billing + Credits ---

  if (name === 'fabric_get_credit_quote') {
    const res = await app.inject({ method: 'GET', url: '/v1/credits/quote', headers: authedHeaders(authHeader) });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_buy_credit_pack_stripe') {
    const meRes = await app.inject({ method: 'GET', url: '/v1/me', headers: authedHeaders(authHeader) });
    const meBody = meRes.json() as Record<string, unknown>;
    const nodeId = (meBody.node as any)?.id;
    if (!nodeId) return { status: meRes.statusCode, body: meBody };

    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/credit-packs/checkout-session',
      headers: postHeaders(authHeader),
      payload: { node_id: nodeId, pack_code: args.pack_code, success_url: args.success_url, cancel_url: args.cancel_url },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_subscribe_stripe') {
    const meRes = await app.inject({ method: 'GET', url: '/v1/me', headers: authedHeaders(authHeader) });
    const meBody = meRes.json() as Record<string, unknown>;
    const nodeId = (meBody.node as any)?.id;
    if (!nodeId) return { status: meRes.statusCode, body: meBody };

    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout-session',
      headers: postHeaders(authHeader),
      payload: { node_id: nodeId, plan_code: args.plan_code, success_url: args.success_url, cancel_url: args.cancel_url },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_buy_credit_pack_crypto') {
    const meRes = await app.inject({ method: 'GET', url: '/v1/me', headers: authedHeaders(authHeader) });
    const meBody = meRes.json() as Record<string, unknown>;
    const nodeId = (meBody.node as any)?.id;
    if (!nodeId) return { status: meRes.statusCode, body: meBody };

    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/crypto-credit-pack',
      headers: postHeaders(authHeader),
      payload: { node_id: nodeId, pack_code: args.pack_code, pay_currency: args.pay_currency },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_crypto_currencies') {
    const res = await app.inject({ method: 'GET', url: '/v1/billing/crypto-currencies', headers: authedHeaders(authHeader) });
    return { status: res.statusCode, body: res.json() };
  }

  // --- Phase E: Profile + Account ---

  if (name === 'fabric_get_profile') {
    const res = await app.inject({ method: 'GET', url: '/v1/me', headers: authedHeaders(authHeader) });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_update_profile') {
    const payload: Record<string, unknown> = {};
    if (args.display_name !== undefined) payload.display_name = args.display_name;
    if (args.email !== undefined) payload.email = args.email;
    if (args.messaging_handles !== undefined) payload.messaging_handles = args.messaging_handles;
    if (args.event_webhook_url !== undefined) payload.event_webhook_url = args.event_webhook_url;
    if (args.event_webhook_secret !== undefined) payload.event_webhook_secret = args.event_webhook_secret;
    const res = await app.inject({
      method: 'PATCH',
      url: '/v1/me',
      headers: postHeaders(authHeader),
      payload,
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_ledger') {
    const params = new URLSearchParams();
    if (typeof args.cursor === 'string') params.set('cursor', args.cursor);
    if (typeof args.limit === 'number') params.set('limit', String(args.limit));
    const qs = params.toString();
    const res = await app.inject({ method: 'GET', url: `/v1/credits/ledger${qs ? `?${qs}` : ''}`, headers: authedHeaders(authHeader) });
    return { status: res.statusCode, body: res.json() };
  }

  return { status: 400, body: errorEnvelope('unknown_tool', `Unknown tool: ${name}`) };
}

/* ---------- JSON-RPC helpers ---------- */

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ---------- quickstart prompt ---------- */

const QUICKSTART_PROMPT = [
  'Fabric Marketplace — Complete MCP Onboarding Guide',
  '',
  'You can do everything through MCP tools. Here is the full lifecycle:',
  '',
  '== Step 1: Discover ==',
  'Call fabric_get_meta to see the current API version and legal URLs.',
  'Call fabric_get_categories to see what categories are available (goods, services, etc.).',
  'Call fabric_get_regions to see supported region codes for search filters.',
  '',
  '== Step 2: Sign Up ==',
  'Call fabric_bootstrap with a display_name to create your node.',
  'You will receive an API key and 100 free credits.',
  'IMPORTANT: Save the api_key from the response — you need it for all subsequent calls.',
  'Set it as your Authorization header: "ApiKey <your_key>"',
  '',
  '== Step 3: Create Inventory ==',
  'Call fabric_create_unit to create a resource/listing (at minimum: title, type, scope_primary, category_ids).',
  'Call fabric_publish_unit with the unit_id to make it searchable.',
  'Or call fabric_create_request + fabric_publish_request to post a need/want.',
  '',
  '== Step 4: Search ==',
  'Call fabric_search_listings to find resources (supply side) — costs credits.',
  'Call fabric_search_requests to find needs (demand side) — costs credits.',
  'Use fabric_get_credits or fabric_get_credit_quote to check your balance first.',
  '',
  '== Step 5: Make a Deal ==',
  'Call fabric_create_offer with unit_ids from search results to make an offer.',
  'The other side sees it via fabric_list_offers (role: "received") or fabric_get_events.',
  'Either side can fabric_counter_offer, fabric_accept_offer, or fabric_reject_offer.',
  'Both sides must accept for mutual acceptance (1 credit charged to each side).',
  '',
  '== Step 6: Complete the Trade ==',
  'After mutual acceptance, call fabric_reveal_contact to get counterparty contact info.',
  'Settlement happens off-platform between you and the counterparty.',
  '',
  '== Credits & Billing ==',
  'You start with 100 free credits. When they run low:',
  'Call fabric_buy_credit_pack_stripe for card payment (returns checkout URL).',
  'Call fabric_buy_credit_pack_crypto for crypto payment (returns pay address — no browser needed).',
  'Call fabric_subscribe_stripe for a monthly plan with more credits.',
  '',
  '== Tips ==',
  'Use fabric_get_profile to check your node status and plan.',
  'Use fabric_update_profile to set your email and messaging handles (shown on contact reveal).',
  'Use fabric_get_ledger to see your full credit history.',
  'Free users have daily limits (20 searches, 3 offers, 1 accept). Any purchase removes limits permanently.',
].join('\n');

/* ---------- route registration ---------- */

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
          description: 'Complete guide to onboard via MCP: bootstrap, create inventory, search, negotiate, and trade on Fabric.',
        },
      ] });
    }

    if (method === 'prompts/get') {
      const params = (msg.params && typeof msg.params === 'object') ? msg.params : {};
      const promptName = String(params.name ?? '');
      if (promptName === 'fabric_quickstart') {
        return jsonRpcResult(id, {
          description: 'Fabric Marketplace — Complete MCP Onboarding Guide',
          messages: [
            { role: 'user', content: { type: 'text', text: QUICKSTART_PROMPT } },
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

      if (!authHeader && !UNAUTH_TOOL_NAMES.has(toolName)) {
        return jsonRpcResult(id, toolContent(
          { error: 'auth_required', message: 'This tool requires authentication. Provide an API key via the Authorization header or api_key header. Use fabric_bootstrap to create a node and get an API key.' },
          true,
        ));
      }

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
