# Fabric MCP Tool Spec (Read-Only)

Definitive contract for the Fabric read-only MCP endpoint. Intended audience: agent builders integrating via the Model Context Protocol.

## Connection

1. Discover the MCP URL: `GET /v1/meta` → `mcp_url` field.
2. Send JSON-RPC 2.0 requests via HTTP POST to that URL.

**Live endpoint**: `https://fabric-api-393345198409.us-west1.run.app/mcp`

## Auth

Same API key header as the REST API:

```
Authorization: ApiKey <api_key>
```

The MCP endpoint is authenticated. Requests without a valid API key receive `401 unauthorized`.

## Protocol

The endpoint speaks MCP protocol version `2024-11-05` over HTTP POST (Streamable HTTP transport).

Supported JSON-RPC methods:

| Method | Purpose |
|---|---|
| `initialize` | Handshake; returns server info and capabilities |
| `tools/list` | Returns the tool allowlist with input schemas |
| `tools/call` | Execute a tool |
| `notifications/initialized` | Client notification (returns 204) |

Any method not in this list returns JSON-RPC error `-32601` (method not found).

## Tool allowlist

Only the following tools are exposed. Any other tool name returns an error result with `unknown_tool`.

---

### `fabric_search_listings`

Search published listings. Metered: costs credits per the budget contract.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `scope` | string enum | yes | `local_in_person`, `remote_online_service`, `ship_to`, `digital_delivery`, `OTHER` |
| `filters` | object | yes | Structured filters (`category_ids_any: int[]`, `region_id`, etc.) |
| `budget` | object | yes | `{ credits_max: number }` — hard ceiling on credits to spend |
| `q` | string \| null | no | Free-text query |
| `broadening` | object | no | `{ level: number, allow: boolean }` — defaults to `{ level: 0, allow: false }` |
| `target` | object | no | `{ node_id?: string, username?: string }` — restrict to one node |
| `limit` | number | no | Results per page, 1–100, default 20 |
| `cursor` | string \| null | no | Pagination cursor from previous response |

**Output:** Search response envelope with `items[]`, `credits_requested`, `credits_charged`, `credits_remaining`, `next_cursor`.

**Errors:**

| Code | When |
|---|---|
| `credits_exhausted` (402) | Insufficient credits |
| `budget_cap_exceeded` (402) | Computed cost exceeds `budget.credits_max` |
| `rate_limit_exceeded` (429) | Rate limit hit |
| `validation_error` (422) | Invalid input |

---

### `fabric_search_requests`

Search published requests. Identical schema and behavior to `fabric_search_listings`.

---

### `fabric_get_unit`

Get a unit by ID. Caller must own the unit.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `unit_id` | string (UUID) | yes | ID of the unit |

**Output:** Unit object with all fields (`id`, `node_id`, `title`, `description`, `type`, `condition`, `quantity`, `measure`, `scope_primary`, `category_ids`, `tags`, `published_at`, `version`, etc.).

**Errors:**

| Code | When |
|---|---|
| `not_found` (404) | Unit does not exist or caller does not own it |
| `validation_error` (422) | Missing or invalid `unit_id` |

---

### `fabric_get_request`

Get a request by ID. Caller must own the request.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `request_id` | string (UUID) | yes | ID of the request |

**Output:** Request object with all fields (`id`, `node_id`, `title`, `description`, `type`, `desired_quantity`, `measure`, `scope_primary`, `category_ids`, `tags`, `need_by`, `published_at`, `version`, etc.).

**Errors:**

| Code | When |
|---|---|
| `not_found` (404) | Request does not exist or caller does not own it |
| `validation_error` (422) | Missing or invalid `request_id` |

---

### `fabric_get_offer`

Get an offer by ID. Caller must be a party to the offer (maker or recipient).

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `offer_id` | string (UUID) | yes | ID of the offer |

**Output:** Offer object with `id`, `thread_id`, `maker_node_id`, `recipient_node_id`, `status`, `note`, `unit_ids`, `lines`, `holds`, `created_at`, `updated_at`, `expires_at`.

**Errors:**

| Code | When |
|---|---|
| `not_found` (404) | Offer does not exist or caller is not a party |
| `validation_error` (422) | Missing or invalid `offer_id` |

---

### `fabric_get_events`

Poll offer lifecycle events. Uses opaque cursor with strictly-after semantics.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `since` | string \| null | no | Opaque cursor from previous `next_cursor` |
| `limit` | number | no | Max events to return, 1–100, default 50 |

**Output:** `{ events: [...], next_cursor: string | null }`. Event objects contain `id`, `type`, `offer_id`, `thread_id`, `occurred_at`, `payload`.

Event types: `offer_created`, `offer_countered`, `offer_accepted`, `offer_rejected`, `offer_cancelled`, `offer_expired`, `offer_finalized`, `offer_contact_revealed`.

**Errors:**

| Code | When |
|---|---|
| `validation_error` (422) | Invalid cursor or limit |

---

### `fabric_get_credits`

Get the authenticated node credit balance.

**Inputs:** None.

**Output:** `{ credits_balance: number, subscription: { plan, status, period_start, period_end, credits_rollover_enabled } }`.

**Errors:** None specific (standard auth errors apply).

---

## Not supported via MCP

The following operations are **not** exposed through the MCP endpoint:

- Creating, updating, or deleting units/requests
- Publishing/unpublishing
- Creating, countering, accepting, rejecting, or cancelling offers
- Revealing contact information
- Profile updates (`PATCH /v1/me`)
- Billing/checkout operations
- Webhook configuration
- Admin operations

Use the REST API directly for all mutation operations.

## Error envelope

All tool errors follow the standard Fabric error envelope:

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "human readable",
    "details": {}
  }
}
```

## Rate limits

- The MCP endpoint has a per-node rate limit (default: 60 requests/minute).
- Underlying routes have their own rate limits (e.g., search: 20/minute).
- Both limits apply independently.
- On 429, the response includes `Retry-After` and `X-RateLimit-*` headers.
- Rate limit error code: `rate_limit_exceeded`.
