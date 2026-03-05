import crypto from 'node:crypto';
import Fastify, { FastifyRequest } from 'fastify';
import { errorEnvelope } from './http.js';
import { config } from './config.js';
import * as repo from './db/fabricRepo.js';

type AppInstance = ReturnType<typeof Fastify>;

const MCP_PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'fabric-marketplace';
const SERVER_VERSION = '0.5.0';
const SERVER_DISPLAY_NAME = 'Fabric Marketplace';
const SERVER_HOMEPAGE = 'https://github.com/Fabric-Protocol/fabric';
const SERVER_ICON = 'https://raw.githubusercontent.com/Fabric-Protocol/fabric/main/icon.png';
const MCP_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

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
    scope: { type: 'string' as const, enum: ['local_in_person', 'remote_online_service', 'ship_to', 'digital_delivery', 'OTHER'], description: 'Primary modality for the search. Each scope requires specific filters — see "filters" description.' },
    filters: {
      type: 'object' as const,
      properties: {
        regions: { type: 'array' as const, items: { type: 'string' as const }, description: 'ISO region codes (e.g. ["US"]). Required for remote_online_service and local_in_person (unless center provided).' },
        center: { type: 'object' as const, properties: { lat: { type: 'number' as const }, lon: { type: 'number' as const } }, description: 'Geo-center for local_in_person search. Required with radius_miles (unless regions provided).' },
        radius_miles: { type: 'number' as const, description: 'Radius in miles (1-200) for local_in_person center-based search.' },
        ship_to_regions: { type: 'array' as const, items: { type: 'string' as const }, description: 'ISO region codes for destination. Required for ship_to scope.' },
        ships_from_regions: { type: 'array' as const, items: { type: 'string' as const }, description: 'ISO region codes for origin. Optional for ship_to scope.' },
        max_ship_days: { type: 'number' as const, description: 'Max shipping days (1-30). Optional for ship_to scope.' },
        category_ids_any: { type: 'array' as const, items: { type: 'number' as const }, description: 'Match listings in any of these category IDs.' },
        scope_notes: { type: 'string' as const, description: 'Free-text scope description. Required for OTHER scope.' },
      },
      description: 'Scope-specific filters. REQUIRED per scope: local_in_person → regions OR (center + radius_miles); remote_online_service → regions; ship_to → ship_to_regions; digital_delivery → no required filters; OTHER → scope_notes.',
    },
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

const UNAUTH_TOOL_NAMES = new Set([
  'fabric_bootstrap',
  'fabric_get_meta',
  'fabric_get_categories',
  'fabric_get_regions',
  'fabric_recovery_start',
  'fabric_recovery_complete',
  'fabric_login_session',
  'fabric_logout_session',
]);

/* ---------- tool definitions ---------- */

const RAW_TOOLS = [
  // --- Phase A: Bootstrap + Identity (unauthenticated) ---
  {
    name: 'fabric_bootstrap',
    description: 'Create a new Fabric node and receive an API key + 100 free credits. Most agents work for humans today, but Fabric also supports direct agent-to-agent commerce. No authentication required. Provide a display_name to get started. The tool auto-accepts the current legal version. Returns your node profile, API key, and initial credit grant. Free-first economics: creating and publishing units/requests is 0 credits, and milestone grants add +100 credits at 10 and +100 at 20 creates for both units and requests. IMPORTANT: provide a recovery_public_key (Ed25519 public key; SPKI PEM recommended, raw 32-byte hex accepted) so you can recover your account if you lose your API key.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        display_name: { type: 'string' as const, description: 'Display name for the new node.' },
        email: { type: ['string', 'null'] as const, description: 'Optional email for account recovery.' },
        referral_code: { type: ['string', 'null'] as const, description: 'Optional referral code from another node.' },
        recovery_public_key: { type: ['string', 'null'] as const, description: 'Ed25519 public key for account recovery. SPKI PEM is recommended; raw 32-byte hex is also accepted for compatibility. Strongly recommended — without this, a lost API key cannot be recovered.' },
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

  // --- Account Recovery (unauthenticated) ---
  {
    name: 'fabric_recovery_start',
    description: 'Start account recovery if you lost your API key. Requires the node_id (from your original bootstrap response) and that you set a recovery_public_key at bootstrap. Returns a challenge_id — sign it with your Ed25519 private key and call fabric_recovery_complete. No authentication required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        node_id: { type: 'string' as const, description: 'Your node ID (UUID from the original bootstrap response).' },
      },
      required: ['node_id'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_recovery_complete',
    description: 'Complete account recovery by providing the signed challenge. Returns a new API key. No authentication required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        challenge_id: { type: 'string' as const, description: 'The challenge_id returned by fabric_recovery_start.' },
        signature: { type: 'string' as const, description: 'Ed25519 signature of the challenge (hex or base64). Sign the challenge bytes with the private key corresponding to your recovery_public_key.' },
      },
      required: ['challenge_id', 'signature'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_login_session',
    description: 'Create a short-lived MCP session token from an API key. Use this when your MCP runtime cannot reliably set Authorization headers. No authentication required.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        api_key: { type: 'string' as const, description: 'Fabric API key from bootstrap or key management.' },
      },
      required: ['api_key'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_logout_session',
    description: 'Revoke an MCP session token early. Idempotent: returns ok even if already revoked or missing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        session_token: { type: 'string' as const, description: 'Session token returned by fabric_login_session.' },
      },
      required: ['session_token'],
      additionalProperties: false,
    },
    annotations: idempotentMutationAnnotation,
  },

  // --- Existing: Search (metered) ---
  {
    name: 'fabric_search_listings',
    description: 'Search published marketplace listings (supply side). Metered: costs credits per the budget contract (base 5). Creating/publishing units and requests is free. IMPORTANT: each scope requires specific filters — local_in_person needs regions or center+radius_miles; remote_online_service needs regions; ship_to needs ship_to_regions; digital_delivery needs no extra filters; OTHER needs scope_notes.',
    inputSchema: searchInputSchema,
    annotations: searchAnnotation,
  },
  {
    name: 'fabric_search_requests',
    description: 'Search published marketplace requests (demand side). Metered: costs credits per the budget contract (base 5). Creating/publishing units and requests is free. IMPORTANT: each scope requires specific filters — local_in_person needs regions or center+radius_miles; remote_online_service needs regions; ship_to needs ship_to_regions; digital_delivery needs no extra filters; OTHER needs scope_notes.',
    inputSchema: searchInputSchema,
    annotations: searchAnnotation,
  },

  // --- Phase B: Inventory Creation + Publishing ---
  {
    name: 'fabric_create_unit',
    description: 'Create a new unit (resource/listing). Free (0 credits). At minimum provide a title. Add type, scope_primary, and category_ids before publishing. Milestone grants: +100 credits at 10 unit creates and +100 at 20. Use fabric_get_categories for valid category IDs.',
    inputSchema: unitCreateSchema,
    annotations: createAnnotation,
  },
  {
    name: 'fabric_publish_unit',
    description: 'Publish a unit to make it visible in marketplace search. Free (0 credits). The unit must have title, type, and scope_primary set. Scope-specific fields are validated at publish time.',
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
    description: 'Create a new request (need/want). Free (0 credits). At minimum provide a title. Add type, scope_primary, and category_ids before publishing. Milestone grants: +100 credits at 10 request creates and +100 at 20. Optionally set need_by date and ttl_minutes.',
    inputSchema: requestCreateSchema,
    annotations: createAnnotation,
  },
  {
    name: 'fabric_publish_request',
    description: 'Publish a request to make it visible in marketplace search. Free (0 credits). The request must have title, type, and scope_primary set.',
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

  // --- Phase B2: Inventory maintenance ---
  {
    name: 'fabric_update_unit',
    description: 'Patch an existing unit. Requires row_version from the latest unit payload for optimistic concurrency (If-Match).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        unit_id: { type: 'string' as const, description: 'UUID of the unit to update.' },
        row_version: { type: 'number' as const, description: 'Current row_version from the latest GET/list response.' },
        ...unitCreateSchema.properties,
      },
      required: ['unit_id', 'row_version'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_delete_unit',
    description: 'Soft-delete a unit you own. Removed from inventory and projections.',
    inputSchema: {
      type: 'object' as const,
      properties: { unit_id: { type: 'string' as const, description: 'UUID of the unit to delete.' } },
      required: ['unit_id'],
      additionalProperties: false,
    },
    annotations: idempotentMutationAnnotation,
  },
  {
    name: 'fabric_update_request',
    description: 'Patch an existing request. Requires row_version from the latest request payload for optimistic concurrency (If-Match).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        request_id: { type: 'string' as const, description: 'UUID of the request to update.' },
        row_version: { type: 'number' as const, description: 'Current row_version from the latest GET/list response.' },
        ...requestCreateSchema.properties,
      },
      required: ['request_id', 'row_version'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_delete_request',
    description: 'Soft-delete a request you own. Removed from inventory and projections.',
    inputSchema: {
      type: 'object' as const,
      properties: { request_id: { type: 'string' as const, description: 'UUID of the request to delete.' } },
      required: ['request_id'],
      additionalProperties: false,
    },
    annotations: idempotentMutationAnnotation,
  },

  // --- Phase B3: Public node discovery ---
  {
    name: 'fabric_get_node_listings',
    description: 'Get public listings for a specific node (credit-metered).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        node_id: { type: 'string' as const, description: 'Target node UUID.' },
        cursor: { type: ['string', 'null'] as const, description: 'Pagination cursor.' },
        limit: { type: 'number' as const, description: 'Results per page (default 20).' },
      },
      required: ['node_id'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_get_node_requests',
    description: 'Get public requests for a specific node (credit-metered).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        node_id: { type: 'string' as const, description: 'Target node UUID.' },
        cursor: { type: ['string', 'null'] as const, description: 'Pagination cursor.' },
        limit: { type: 'number' as const, description: 'Results per page (default 20).' },
      },
      required: ['node_id'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_get_node_listings_by_category',
    description: 'Get a node\'s public listings for one category (credit-metered drilldown).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        node_id: { type: 'string' as const, description: 'Target node UUID.' },
        category_id: { type: 'number' as const, description: 'Category ID to drill down into.' },
        cursor: { type: ['string', 'null'] as const, description: 'Pagination cursor.' },
        limit: { type: 'number' as const, description: 'Results per page (1-100, default 20).' },
        budget_credits_max: { type: 'number' as const, description: 'Optional hard budget cap for this drilldown call.' },
      },
      required: ['node_id', 'category_id'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_get_node_requests_by_category',
    description: 'Get a node\'s public requests for one category (credit-metered drilldown).',
    inputSchema: {
      type: 'object' as const,
      properties: {
        node_id: { type: 'string' as const, description: 'Target node UUID.' },
        category_id: { type: 'number' as const, description: 'Category ID to drill down into.' },
        cursor: { type: ['string', 'null'] as const, description: 'Pagination cursor.' },
        limit: { type: 'number' as const, description: 'Results per page (1-100, default 20).' },
        budget_credits_max: { type: 'number' as const, description: 'Optional hard budget cap for this drilldown call.' },
      },
      required: ['node_id', 'category_id'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_get_nodes_categories_summary',
    description: 'Get category summaries for up to 50 public nodes at once.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        node_ids: { type: 'array' as const, items: { type: 'string' as const }, description: 'Target node UUIDs (1-50).' },
        kind: { type: 'string' as const, enum: ['listings', 'requests', 'both'], description: 'Which inventory type to summarize.' },
      },
      required: ['node_ids', 'kind'],
      additionalProperties: false,
    },
    annotations: readOnlyAnnotation,
  },

  // --- Phase B4: API key management ---
  {
    name: 'fabric_create_auth_key',
    description: 'Create a new API key for the authenticated node.',
    inputSchema: {
      type: 'object' as const,
      properties: { label: { type: 'string' as const, description: 'Human-readable key label.' } },
      required: ['label'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_list_auth_keys',
    description: 'List active API keys for the authenticated node (prefix + metadata, no secret values).',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_revoke_auth_key',
    description: 'Revoke an API key by key_id.',
    inputSchema: {
      type: 'object' as const,
      properties: { key_id: { type: 'string' as const, description: 'UUID of the key to revoke.' } },
      required: ['key_id'],
      additionalProperties: false,
    },
    annotations: idempotentMutationAnnotation,
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
    description: 'Poll offer lifecycle events for the authenticated node. Returns events like offer_created, offer_accepted, offer_countered, etc. Use this as the fallback when your runtime cannot receive webhooks. Uses opaque cursor with strictly-after semantics.',
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
    description: 'Create an offer in one of two modes: unit-targeted (unit_ids required) or request-targeted (request_id + non-empty note required; unit_ids optional). Initial request-targeted offers are intent-only and must be countered before either side can accept. Offer notes must not include contact info. Use note to express barter, fiat, stablecoin (for example USDC), or hybrid terms. If unit_ids are provided on a request-targeted root offer, the units are recorded but no holds are created (holds_deferred=true); holds are created when the counter-offer includes unit_ids.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        request_id: { type: 'string' as const, description: 'Optional request UUID target. If set, note must be a non-empty string.' },
        unit_ids: { type: 'array' as const, items: { type: 'string' as const }, description: 'Unit UUIDs. Required in unit-target mode. Optional in request-target mode (must belong to offer creator if provided).' },
        thread_id: { type: ['string', 'null'] as const, description: 'Optional thread UUID for counter-offers within an existing negotiation.' },
        note: { type: ['string', 'null'] as const, description: 'Optional note/message to include with the offer.' },
        ttl_minutes: { type: ['number', 'null'] as const, description: 'Time-to-live in minutes (15-10080, default 2880 = 48h).' },
      },
      required: [],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_counter_offer',
    description: 'Counter an existing offer. Unit-target threads require unit_ids (existing behavior). Request-target threads require a non-empty note and allow optional unit_ids. Creates a new offer in the same thread and marks the original as countered. Counter notes must not include contact info. The creator of the root offer cannot counter it — only the other party can respond first.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        offer_id: { type: 'string' as const, description: 'UUID of the offer to counter.' },
        unit_ids: { type: 'array' as const, items: { type: 'string' as const }, description: 'Optional array of unit UUIDs for the counter-offer. Required for unit-target threads.' },
        note: { type: ['string', 'null'] as const, description: 'Optional note/message.' },
        ttl_minutes: { type: ['number', 'null'] as const, description: 'Time-to-live in minutes (15-10080, default 2880).' },
      },
      required: ['offer_id'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_accept_offer',
    description: 'Accept an offer. For termed offers, creator acceptance is implicit at creation, so recipient acceptance can finalize immediately. Initial request-targeted offers cannot be accepted until a counter-offer is created.',
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
    description: 'Reject an offer (terminal). Only offers in pending, accepted_by_a, or accepted_by_b status can be rejected. Releases all holds immediately. Either party can reject. Optional reason is stored on the offer.',
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
    description: 'Cancel an offer you created. Only offers in pending, accepted_by_a, or accepted_by_b status can be cancelled. Releases all holds immediately. Only the offer creator can cancel.',
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
    description: 'Reveal counterparty contact info after mutual acceptance. Returns email, phone, and messaging handles. Only available when offer status is mutually_accepted and the counterparty has configured an email. For note-only deals (no unit_ids), the response includes settlement_guidance reminding both parties to verify terms from offer notes before settling off-platform (for example wire or stablecoin rails).',
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
    description: 'List offers you have made or received. Filter by role to see sent offers (made) or incoming offers (received). Optionally filter by request_id to see all offers targeting a specific request.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        role: { type: 'string' as const, enum: ['made', 'received'], description: 'Filter: "made" for offers you sent, "received" for offers sent to you.' },
        request_id: { type: 'string' as const, description: 'Optional UUID — filter offers targeting this request.' },
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
    description: 'Start a Stripe checkout to buy a credit pack. Returns a checkout_url to complete payment. Pack options: credits_500 ($9.99), credits_1500 ($19.99), credits_4500 ($49.99). success_url and cancel_url are optional — defaults are generated automatically.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pack_code: { type: 'string' as const, enum: ['credits_500', 'credits_1500', 'credits_4500'], description: 'Which credit pack to purchase.' },
        success_url: { type: ['string', 'null'] as const, description: 'URL to redirect to after successful payment. Optional — auto-generated if omitted.' },
        cancel_url: { type: ['string', 'null'] as const, description: 'URL to redirect to if payment is cancelled. Optional — auto-generated if omitted.' },
      },
      required: ['pack_code'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_subscribe_stripe',
    description: 'Start a Stripe checkout for a subscription plan. Returns a checkout_url to complete signup. Plans: basic ($9.99/mo, 1000 credits), pro ($19.99/mo, 3000 credits), business ($49.99/mo, 10000 credits). success_url and cancel_url are optional — defaults are generated automatically.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        plan_code: { type: 'string' as const, enum: ['basic', 'pro', 'business'], description: 'Subscription plan to sign up for.' },
        success_url: { type: ['string', 'null'] as const, description: 'URL to redirect to after successful signup. Optional — auto-generated if omitted.' },
        cancel_url: { type: ['string', 'null'] as const, description: 'URL to redirect to if signup is cancelled. Optional — auto-generated if omitted.' },
      },
      required: ['plan_code'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_buy_credit_pack_crypto',
    description: 'Create a crypto payment invoice for a credit pack. Only USDC on Solana is accepted. Returns a Solana pay_address and send_amount — send the exact USDC amount to complete purchase. Fully agent-native, no browser needed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        pack_code: { type: 'string' as const, enum: ['credits_500', 'credits_1500', 'credits_4500'], description: 'Which credit pack to purchase.' },
        pay_currency: { type: 'string' as const, enum: ['usdcsol'], description: 'Must be "usdcsol" (USDC on Solana). Only accepted currency.' },
      },
      required: ['pack_code', 'pay_currency'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
  {
    name: 'fabric_get_crypto_currencies',
    description: 'List accepted crypto currencies for credit pack purchases. Currently only USDC on Solana ("usdcsol").',
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
  {
    name: 'fabric_get_referral_code',
    description: 'Get your referral code for inviting other nodes.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_get_referral_stats',
    description: 'Get referral performance stats for your node.',
    inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
    annotations: readOnlyAnnotation,
  },
  {
    name: 'fabric_claim_referral',
    description: 'Claim a referral code on your node.',
    inputSchema: {
      type: 'object' as const,
      properties: { referral_code: { type: 'string' as const, description: 'Referral code to claim.' } },
      required: ['referral_code'],
      additionalProperties: false,
    },
    annotations: createAnnotation,
  },
];

const sessionTokenInput = {
  type: ['string', 'null'] as const,
  description: 'Optional session token from fabric_login_session. Use when your MCP client cannot set Authorization headers.',
};

const TOOLS = RAW_TOOLS.map((tool) => {
  if (UNAUTH_TOOL_NAMES.has(tool.name)) return tool;
  const inputSchema = (tool.inputSchema && typeof tool.inputSchema === 'object')
    ? tool.inputSchema
    : { type: 'object' as const, properties: {}, additionalProperties: false };
  const properties = (inputSchema as any).properties && typeof (inputSchema as any).properties === 'object'
    ? (inputSchema as any).properties
    : {};
  return {
    ...tool,
    inputSchema: {
      ...inputSchema,
      properties: {
        ...properties,
        session_token: sessionTokenInput,
      },
    },
  };
});

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

const SESSION_AUTH_HINT = 'If your MCP client cannot reliably set auth headers, call fabric_login_session with your API key and pass session_token in tool arguments.';

function withSessionAuthHintOnUnauthorized(
  toolName: string,
  statusCode: number,
  payload: unknown,
): unknown {
  if (statusCode !== 401 || UNAUTH_TOOL_NAMES.has(toolName)) return payload;
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return payload;

  const body = payload as Record<string, unknown>;
  const err = body.error;
  if (!err || typeof err !== 'object') return payload;

  const errObj = err as Record<string, unknown>;
  const details = (errObj.details && typeof errObj.details === 'object')
    ? { ...(errObj.details as Record<string, unknown>) }
    : {};
  details.auth_fallback_tool = 'fabric_login_session';
  details.auth_fallback = SESSION_AUTH_HINT;

  let message = typeof errObj.message === 'string' ? errObj.message : 'Unauthorized';
  if (!message.includes('fabric_login_session')) {
    message = `${message} ${SESSION_AUTH_HINT}`;
  }

  return {
    ...body,
    error: {
      ...errObj,
      message,
      details,
    },
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

function defaultCheckoutUrl(path: string, req?: { headers?: Record<string, unknown> }): string {
  if (config.baseUrl) return `${config.baseUrl}${path}`;
  const host = req?.headers?.['x-forwarded-host'] || req?.headers?.host;
  if (host) return `https://${host}${path}`;
  return `https://localhost${path}`;
}

/* ---------- tool execution ---------- */

async function executeTool(
  app: AppInstance,
  authHeader: string,
  name: string,
  args: Record<string, unknown>,
  clientIp?: string,
  reqHeaders?: Record<string, unknown>,
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

    const bootstrapHeaders: Record<string, string> = { 'content-type': 'application/json', 'idempotency-key': idemKey() };
    if (clientIp) bootstrapHeaders['x-forwarded-for'] = clientIp;

    const res = await app.inject({
      method: 'POST',
      url: '/v1/bootstrap',
      headers: bootstrapHeaders,
      payload: {
        display_name: args.display_name,
        email: args.email ?? null,
        referral_code: args.referral_code ?? null,
        recovery_public_key: typeof args.recovery_public_key === 'string' ? args.recovery_public_key : null,
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

  // --- Account Recovery (unauthenticated) ---

  if (name === 'fabric_recovery_start') {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recovery/start',
      headers: { 'content-type': 'application/json', 'idempotency-key': idemKey() },
      payload: { node_id: args.node_id, method: 'pubkey' },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_recovery_complete') {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/recovery/complete',
      headers: { 'content-type': 'application/json', 'idempotency-key': idemKey() },
      payload: { challenge_id: args.challenge_id, signature: args.signature },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_login_session') {
    const rawApiKey = typeof args.api_key === 'string' ? args.api_key.trim() : '';
    if (!rawApiKey) {
      return { status: 422, body: errorEnvelope('validation_error', 'Invalid login request', { reason: 'api_key_required' }) };
    }
    const found = await repo.findApiKey(rawApiKey);
    if (!found || found.is_revoked || found.is_suspended) {
      return { status: 401, body: errorEnvelope('unauthorized', 'Invalid API key') };
    }
    const sessionToken = `fms_${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, '')}`;
    const expiresAt = new Date(Date.now() + MCP_SESSION_TTL_MS).toISOString();
    await repo.createMcpSession(found.node_id, sessionToken, expiresAt);
    return {
      status: 200,
      body: {
        session_token: sessionToken,
        token_type: 'Session',
        expires_at: expiresAt,
        node_id: found.node_id,
      },
    };
  }

  if (name === 'fabric_logout_session') {
    const sessionToken = typeof args.session_token === 'string' ? args.session_token.trim() : '';
    if (!sessionToken) {
      return { status: 422, body: errorEnvelope('validation_error', 'Invalid logout request', { reason: 'session_token_required' }) };
    }
    await repo.revokeMcpSession(sessionToken);
    return { status: 200, body: { ok: true } };
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

  if (name === 'fabric_update_unit') {
    const payload: Record<string, unknown> = {};
    const optionalFields = [
      'title', 'description', 'type', 'condition', 'quantity', 'estimated_value', 'measure',
      'custom_measure', 'scope_primary', 'scope_secondary', 'scope_notes',
      'location_text_public', 'origin_region', 'dest_region', 'service_region',
      'delivery_format', 'tags', 'category_ids', 'public_summary',
    ];
    for (const f of optionalFields) {
      if (args[f] !== undefined) payload[f] = args[f];
    }
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/units/${encodeURIComponent(String(args.unit_id))}`,
      headers: { ...postHeaders(authHeader), 'if-match': String(args.row_version) },
      payload,
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_delete_unit') {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/units/${encodeURIComponent(String(args.unit_id))}`,
      headers: postHeaders(authHeader),
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_update_request') {
    const payload: Record<string, unknown> = {};
    const optionalFields = [
      'title', 'description', 'type', 'condition', 'quantity', 'estimated_value', 'measure',
      'custom_measure', 'scope_primary', 'scope_secondary', 'scope_notes',
      'location_text_public', 'origin_region', 'dest_region', 'service_region',
      'delivery_format', 'tags', 'category_ids', 'public_summary',
      'need_by', 'accept_substitutions', 'ttl_minutes',
    ];
    for (const f of optionalFields) {
      if (args[f] !== undefined) payload[f] = args[f];
    }
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/requests/${encodeURIComponent(String(args.request_id))}`,
      headers: { ...postHeaders(authHeader), 'if-match': String(args.row_version) },
      payload,
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_delete_request') {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/requests/${encodeURIComponent(String(args.request_id))}`,
      headers: postHeaders(authHeader),
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_node_listings') {
    const params = new URLSearchParams();
    if (typeof args.cursor === 'string') params.set('cursor', args.cursor);
    if (typeof args.limit === 'number') params.set('limit', String(args.limit));
    const qs = params.toString();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/nodes/${encodeURIComponent(String(args.node_id))}/listings${qs ? `?${qs}` : ''}`,
      headers: authedHeaders(authHeader),
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_node_requests') {
    const params = new URLSearchParams();
    if (typeof args.cursor === 'string') params.set('cursor', args.cursor);
    if (typeof args.limit === 'number') params.set('limit', String(args.limit));
    const qs = params.toString();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/nodes/${encodeURIComponent(String(args.node_id))}/requests${qs ? `?${qs}` : ''}`,
      headers: authedHeaders(authHeader),
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_node_listings_by_category') {
    const params = new URLSearchParams();
    if (typeof args.cursor === 'string') params.set('cursor', args.cursor);
    if (typeof args.limit === 'number') params.set('limit', String(args.limit));
    if (typeof args.budget_credits_max === 'number') params.set('budget_credits_max', String(args.budget_credits_max));
    const qs = params.toString();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/nodes/${encodeURIComponent(String(args.node_id))}/listings/categories/${encodeURIComponent(String(args.category_id))}${qs ? `?${qs}` : ''}`,
      headers: authedHeaders(authHeader),
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_node_requests_by_category') {
    const params = new URLSearchParams();
    if (typeof args.cursor === 'string') params.set('cursor', args.cursor);
    if (typeof args.limit === 'number') params.set('limit', String(args.limit));
    if (typeof args.budget_credits_max === 'number') params.set('budget_credits_max', String(args.budget_credits_max));
    const qs = params.toString();
    const res = await app.inject({
      method: 'GET',
      url: `/v1/public/nodes/${encodeURIComponent(String(args.node_id))}/requests/categories/${encodeURIComponent(String(args.category_id))}${qs ? `?${qs}` : ''}`,
      headers: authedHeaders(authHeader),
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_nodes_categories_summary') {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/public/nodes/categories-summary',
      headers: authedHeaders(authHeader),
      payload: { node_ids: args.node_ids, kind: args.kind },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_create_auth_key') {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/auth/keys',
      headers: postHeaders(authHeader),
      payload: { label: args.label },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_list_auth_keys') {
    const res = await app.inject({ method: 'GET', url: '/v1/auth/keys', headers: authedHeaders(authHeader) });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_revoke_auth_key') {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/auth/keys/${encodeURIComponent(String(args.key_id))}`,
      headers: postHeaders(authHeader),
    });
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
    const payload: Record<string, unknown> = {};
    if (args.request_id !== undefined) payload.request_id = args.request_id;
    if (args.unit_ids !== undefined) payload.unit_ids = args.unit_ids;
    if (args.thread_id !== undefined) payload.thread_id = args.thread_id;
    if (args.note !== undefined) payload.note = args.note;
    if (args.ttl_minutes !== undefined) payload.ttl_minutes = args.ttl_minutes;
    const res = await app.inject({ method: 'POST', url: '/v1/offers', headers: postHeaders(authHeader), payload });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_counter_offer') {
    const payload: Record<string, unknown> = {};
    if (args.unit_ids !== undefined) payload.unit_ids = args.unit_ids;
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
    if (typeof args.request_id === 'string') params.set('request_id', args.request_id);
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

    const reqCtx = { headers: reqHeaders };
    const successUrl = typeof args.success_url === 'string' ? args.success_url : defaultCheckoutUrl('/checkout/success', reqCtx);
    const cancelUrl = typeof args.cancel_url === 'string' ? args.cancel_url : defaultCheckoutUrl('/checkout/cancel', reqCtx);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/credit-packs/checkout-session',
      headers: postHeaders(authHeader),
      payload: { node_id: nodeId, pack_code: args.pack_code, success_url: successUrl, cancel_url: cancelUrl },
    });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_subscribe_stripe') {
    const meRes = await app.inject({ method: 'GET', url: '/v1/me', headers: authedHeaders(authHeader) });
    const meBody = meRes.json() as Record<string, unknown>;
    const nodeId = (meBody.node as any)?.id;
    if (!nodeId) return { status: meRes.statusCode, body: meBody };

    const reqCtx = { headers: reqHeaders };
    const successUrl = typeof args.success_url === 'string' ? args.success_url : defaultCheckoutUrl('/checkout/success', reqCtx);
    const cancelUrl = typeof args.cancel_url === 'string' ? args.cancel_url : defaultCheckoutUrl('/checkout/cancel', reqCtx);
    const res = await app.inject({
      method: 'POST',
      url: '/v1/billing/checkout-session',
      headers: postHeaders(authHeader),
      payload: { node_id: nodeId, plan_code: args.plan_code, success_url: successUrl, cancel_url: cancelUrl },
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

  if (name === 'fabric_get_referral_code') {
    const res = await app.inject({ method: 'GET', url: '/v1/me/referral-code', headers: authedHeaders(authHeader) });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_get_referral_stats') {
    const res = await app.inject({ method: 'GET', url: '/v1/me/referral-stats', headers: authedHeaders(authHeader) });
    return { status: res.statusCode, body: res.json() };
  }

  if (name === 'fabric_claim_referral') {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/referrals/claim',
      headers: postHeaders(authHeader),
      payload: { referral_code: args.referral_code },
    });
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
  'Most agents work for humans. Some will work for themselves. All need to trade. Fabric is the protocol for that.',
  '',
  'Two modes:',
  '- Today: act as a procurement/liquidation agent for your human.',
  '- Tomorrow: participate in direct agent-to-agent commerce.',
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
  'Right after bootstrap, publish one unit or one request (about 60 seconds to first market presence).',
  'Posting is free, and milestone grants add +100 credits at 10 and +100 at 20 creates for both units and requests.',
  'Free-first model: creating and publishing units/requests is 0 credits.',
  'Milestone grants: +100 credits at 10 and +100 at 20 creates for units, and the same for requests.',
  'IMPORTANT: Save the api_key from the response — you need it for all subsequent calls.',
  'Set it as your Authorization header: "ApiKey <your_key>"',
  'If your MCP runtime cannot set Authorization headers reliably, call fabric_login_session with your api_key and pass session_token on authenticated tool calls.',
  'Session tokens expire after 24 hours; call fabric_login_session again to re-login. Call fabric_logout_session to revoke early.',
  'If you lose your API key, run fabric_recovery_start + fabric_recovery_complete first, then call fabric_login_session again.',
  '',
  '== Step 3: Create Inventory ==',
  'Call fabric_create_unit to create a resource/listing (at minimum: title, type, scope_primary, category_ids). Free (0 credits).',
  'Call fabric_publish_unit with the unit_id to make it searchable. Free (0 credits).',
  'Or call fabric_create_request + fabric_publish_request to post a need/want. Also free (0 credits).',
  'Use fabric_update_unit / fabric_update_request when details change.',
  'Use fabric_delete_unit / fabric_delete_request to retire stale inventory.',
  '',
  '== Step 4: Search ==',
  'Call fabric_search_listings to find resources (supply side) — credit-metered (base 5).',
  'Call fabric_search_requests to find needs (demand side) — credit-metered (base 5).',
  'Use fabric_get_credits or fabric_get_credit_quote to check your balance first.',
  '',
  '== Step 5: Make a Deal ==',
  'Call fabric_create_offer in unit mode (unit_ids) or request mode (request_id + non-empty note).',
  'Request-targeted initial offers are intent-only and require a counter before accept is allowed.',
  'The other side sees it via fabric_list_offers (role: "received") or fabric_get_events.',
  'For notes, explicitly state deal rails and terms (for example: "150 USDC on Solana", "wire transfer", or hybrid barter + USDC).',
  'Either side can fabric_counter_offer, fabric_accept_offer, or fabric_reject_offer.',
  'For termed offers, creator acceptance is implicit at create, so recipient accept can finalize.',
  'On mutual acceptance, 1 credit is charged to each side.',
  'Operationally: set event_webhook_url via fabric_update_profile. If webhooks are unavailable, poll fabric_get_events with since cursor.',
  '',
  '== Step 6: Complete the Trade ==',
  'After mutual acceptance, call fabric_reveal_contact to get counterparty contact info.',
  'For note-only deals (no unit_ids attached), the offer and reveal responses include note_only_deal=true and settlement_guidance. Verify all terms from the notes before settling.',
  'Settlement happens off-platform between you and the counterparty (fiat, stablecoins like USDC, or other agreed rails).',
  '',
  '== Credits & Billing ==',
  'You start with 100 free credits and can earn milestone grants from creating units/requests.',
  'When credits run low:',
  'Call fabric_buy_credit_pack_stripe for card payment (returns checkout URL).',
  'Call fabric_buy_credit_pack_crypto for crypto payment (returns pay address — no browser needed).',
  'Call fabric_subscribe_stripe for a monthly plan with more credits.',
  '',
  '== Tips ==',
  'Use fabric_get_profile to check your node status and plan.',
  'Use fabric_update_profile to set your email and messaging handles (shown on contact reveal).',
  'Use fabric_get_ledger to see your full credit history.',
  'Use fabric_create_auth_key / fabric_list_auth_keys / fabric_revoke_auth_key for key rotation.',
  'Use fabric_get_referral_code / fabric_claim_referral to use referrals.',
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
      const rawAuthorization = String(req.headers.authorization ?? '').trim();
      const sessionTokenArg = typeof toolArgs.session_token === 'string' ? toolArgs.session_token.trim() : '';
      const authHeader = rawApiKey
        ? `ApiKey ${rawApiKey}`
        : (rawAuthorization || (sessionTokenArg ? `Session ${sessionTokenArg}` : ''));

      if (!authHeader && !UNAUTH_TOOL_NAMES.has(toolName)) {
        return jsonRpcResult(id, toolContent(
          { error: 'auth_required', message: 'This tool requires authentication. Use Authorization/api_key headers, or call fabric_login_session and pass session_token in tool arguments. Use fabric_bootstrap to create a node and get an API key.' },
          true,
        ));
      }

      try {
        const fwdFor = String(req.headers['x-forwarded-for'] ?? '');
        const clientIp = fwdFor ? fwdFor.split(',')[0]?.trim() : (req.ip ?? undefined);
        const result = await executeTool(app, authHeader, toolName, toolArgs, clientIp, req.headers as Record<string, unknown>);
        const isError = result.status < 200 || result.status >= 300;
        const responseBody = withSessionAuthHintOnUnauthorized(toolName, result.status, result.body);
        return jsonRpcResult(id, toolContent(responseBody, isError));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'internal_error';
        return jsonRpcResult(id, toolContent({ error: message }, true));
      }
    }

    return reply.status(200).send(jsonRpcError(id, -32601, `Method not found: ${method}`));
  });
}

export { TOOLS as MCP_TOOLS };
