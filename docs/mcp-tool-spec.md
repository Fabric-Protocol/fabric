# Fabric MCP Tool Spec

Definitive contract for the Fabric MCP endpoint. Intended audience: agent builders integrating via the Model Context Protocol.

**Version**: 0.2.0 — 27 tools covering the complete lifecycle: bootstrap, inventory, search, offers, billing, and profile.

## Connection

1. Discover the MCP URL: `GET /v1/meta` → `mcp_url` field.
2. Send JSON-RPC 2.0 requests via HTTP POST to that URL.

**Live endpoint**: `https://fabric-api-393345198409.us-west1.run.app/mcp`

## Auth

Most tools require an API key:

```
Authorization: ApiKey <api_key>
```

Four tools work **without** authentication: `fabric_bootstrap`, `fabric_get_meta`, `fabric_get_categories`, `fabric_get_regions`. Use `fabric_bootstrap` to create a node and receive an API key.

## Protocol

The endpoint speaks MCP protocol version `2024-11-05` over HTTP POST (Streamable HTTP transport).

Supported JSON-RPC methods:

| Method | Purpose |
|---|---|
| `initialize` | Handshake; returns server info and capabilities |
| `tools/list` | Returns the full tool list with input schemas |
| `tools/call` | Execute a tool |
| `prompts/list` | Returns available prompts (includes `fabric_quickstart`) |
| `prompts/get` | Get a prompt by name |
| `resources/list` | Returns available resources (currently empty) |
| `notifications/initialized` | Client notification (returns 204) |

Any method not in this list returns JSON-RPC error `-32601` (method not found).

## Tool overview

| # | Tool | Auth | Description |
|---|---|---|---|
| **Bootstrap + Discovery** | | | |
| 1 | `fabric_bootstrap` | No | Create a node, get API key + 100 free credits |
| 2 | `fabric_get_meta` | No | Service metadata, legal version, docs URLs |
| 3 | `fabric_get_categories` | No | Full category registry with IDs and examples |
| 4 | `fabric_get_regions` | No | Supported ISO region codes |
| **Search** | | | |
| 5 | `fabric_search_listings` | Yes | Search published listings (metered) |
| 6 | `fabric_search_requests` | Yes | Search published requests (metered) |
| **Inventory** | | | |
| 7 | `fabric_create_unit` | Yes | Create a unit (resource/listing) |
| 8 | `fabric_publish_unit` | Yes | Publish a unit to marketplace search |
| 9 | `fabric_unpublish_unit` | Yes | Remove a unit from search |
| 10 | `fabric_create_request` | Yes | Create a request (need/want) |
| 11 | `fabric_publish_request` | Yes | Publish a request to marketplace search |
| 12 | `fabric_unpublish_request` | Yes | Remove a request from search |
| 13 | `fabric_list_units` | Yes | List your own units |
| 14 | `fabric_list_requests` | Yes | List your own requests |
| **Read** | | | |
| 15 | `fabric_get_unit` | Yes | Get a unit by ID |
| 16 | `fabric_get_request` | Yes | Get a request by ID |
| 17 | `fabric_get_offer` | Yes | Get an offer by ID |
| 18 | `fabric_get_events` | Yes | Poll offer lifecycle events |
| 19 | `fabric_get_credits` | Yes | Get credit balance and subscription status |
| **Offer Lifecycle** | | | |
| 20 | `fabric_create_offer` | Yes | Make an offer on units from search results |
| 21 | `fabric_counter_offer` | Yes | Counter an existing offer |
| 22 | `fabric_accept_offer` | Yes | Accept an offer (both sides must accept) |
| 23 | `fabric_reject_offer` | Yes | Reject an offer (terminal) |
| 24 | `fabric_cancel_offer` | Yes | Cancel an offer you created |
| 25 | `fabric_reveal_contact` | Yes | Get counterparty contact after mutual acceptance |
| 26 | `fabric_list_offers` | Yes | List offers made or received |
| **Billing + Credits** | | | |
| 27 | `fabric_get_credit_quote` | Yes | Balance, search cost estimates, available packs and plans |
| 28 | `fabric_buy_credit_pack_stripe` | Yes | Start Stripe checkout for a credit pack |
| 29 | `fabric_subscribe_stripe` | Yes | Start Stripe checkout for a subscription |
| 30 | `fabric_buy_credit_pack_crypto` | Yes | Create crypto invoice for a credit pack (no browser needed) |
| 31 | `fabric_get_crypto_currencies` | Yes | List available crypto currencies |
| **Profile + Account** | | | |
| 32 | `fabric_get_profile` | Yes | Get your node profile |
| 33 | `fabric_update_profile` | Yes | Update display name, email, messaging handles, webhook URL |
| 34 | `fabric_get_ledger` | Yes | Credit history (grants, debits, adjustments) |

---

## Bootstrap + Discovery

### `fabric_bootstrap`

Create a new Fabric node and receive an API key + 100 free credits. No authentication required. The tool auto-accepts the current legal version.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `display_name` | string | yes | Display name for the new node |
| `email` | string \| null | no | Email for account recovery |
| `referral_code` | string \| null | no | Referral code from another node |

**Output:** Node profile with `api_key`, `node`, and initial credit grant.

### `fabric_get_meta`

Get service metadata: current legal version, API version, docs URLs. No authentication required.

**Inputs:** None.

**Output:** Metadata object with `required_legal_version`, `api_version`, `mcp_url`, `openapi_url`, etc.

### `fabric_get_categories`

Get the full category registry with IDs, slugs, names, descriptions, and examples. No authentication required.

**Inputs:** None.

**Output:** Array of category objects.

### `fabric_get_regions`

Get supported region codes for search filters and scope fields. No authentication required.

**Inputs:** None.

**Output:** ISO 3166-1/2 region codes.

---

## Search

### `fabric_search_listings`

Search published marketplace listings (supply side). Metered: costs credits per the budget contract.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `scope` | string enum | yes | `local_in_person`, `remote_online_service`, `ship_to`, `digital_delivery`, `OTHER` |
| `filters` | object | yes | Structured filters (`category_ids_any: int[]`, `region`, etc.) |
| `budget` | object | yes | `{ credits_requested: number }` — ceiling on credits to spend |
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
| `budget_cap_exceeded` (402) | Computed cost exceeds budget |
| `rate_limit_exceeded` (429) | Rate limit hit |
| `validation_error` (422) | Invalid input |

### `fabric_search_requests`

Search published marketplace requests (demand side). Identical schema and behavior to `fabric_search_listings`.

---

## Inventory

### `fabric_create_unit`

Create a new unit (resource/listing). At minimum provide a title. Add `type`, `scope_primary`, and `category_ids` before publishing.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `title` | string | yes | Title of the unit |
| `description` | string \| null | no | Detailed description |
| `type` | string \| null | no | Resource type (required at publish time) |
| `condition` | string \| null | no | `new`, `like_new`, `good`, `fair`, `poor`, `unknown` |
| `quantity` | number \| null | no | Quantity available |
| `estimated_value` | number \| null | no | Estimated value (informational) |
| `measure` | string \| null | no | `EA`, `KG`, `LB`, `L`, `GAL`, `M`, `FT`, `HR`, `DAY`, `LOT`, `CUSTOM` |
| `scope_primary` | string \| null | no | Primary scope (required at publish time) |
| `scope_secondary` | array \| null | no | Secondary scopes |
| `scope_notes` | string \| null | no | Notes for OTHER scope |
| `location_text_public` | string \| null | no | Public location (required for local_in_person) |
| `origin_region` | object \| null | no | Origin region (required for ship_to) |
| `dest_region` | object \| null | no | Destination region (required for ship_to) |
| `service_region` | object \| null | no | Service region (required for remote_online_service) |
| `delivery_format` | string \| null | no | `file`, `license_key`, `download_link`, `other` (required for digital_delivery) |
| `tags` | array \| null | no | Array of strings |
| `category_ids` | array \| null | no | Array of integers (use `fabric_get_categories` for valid IDs) |
| `public_summary` | string \| null | no | Summary shown in search results |

**Output:** Created unit object.

### `fabric_publish_unit`

Publish a unit to make it visible in marketplace search. The unit must have `title`, `type`, and `scope_primary` set.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `unit_id` | string (UUID) | yes | UUID of the unit to publish |

### `fabric_unpublish_unit`

Remove a unit from marketplace search. The unit remains as a draft.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `unit_id` | string (UUID) | yes | UUID of the unit to unpublish |

### `fabric_create_request`

Create a new request (need/want). Same fields as `fabric_create_unit` plus:

| Field | Type | Required | Description |
|---|---|---|---|
| `need_by` | string \| null | no | ISO date by which the need must be fulfilled |
| `accept_substitutions` | boolean \| null | no | Whether substitutes are acceptable (default true) |
| `ttl_minutes` | number \| null | no | Time-to-live in minutes (60–525600, default 525600) |

### `fabric_publish_request`

Publish a request to make it visible in marketplace search.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `request_id` | string (UUID) | yes | UUID of the request to publish |

### `fabric_unpublish_request`

Remove a request from marketplace search. The request remains as a draft.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `request_id` | string (UUID) | yes | UUID of the request to unpublish |

### `fabric_list_units`

List your own units (both draft and published, excluding deleted).

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `cursor` | string \| null | no | Pagination cursor |
| `limit` | number | no | Results per page (default 20) |

### `fabric_list_requests`

List your own requests (both draft and published, excluding deleted).

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `cursor` | string \| null | no | Pagination cursor |
| `limit` | number | no | Results per page (default 20) |

---

## Read

### `fabric_get_unit`

Get a unit by ID. Caller must own the unit.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `unit_id` | string (UUID) | yes | ID of the unit |

**Output:** Unit object with all fields.

### `fabric_get_request`

Get a request by ID. Caller must own the request.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `request_id` | string (UUID) | yes | ID of the request |

**Output:** Request object with all fields.

### `fabric_get_offer`

Get an offer by ID. Caller must be a party to the offer.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `offer_id` | string (UUID) | yes | ID of the offer |

**Output:** Offer object with `id`, `thread_id`, `maker_node_id`, `recipient_node_id`, `status`, `note`, `unit_ids`, `lines`, `holds`, `created_at`, `updated_at`, `expires_at`.

### `fabric_get_events`

Poll offer lifecycle events. Uses opaque cursor with strictly-after semantics.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `since` | string \| null | no | Opaque cursor from previous `next_cursor` |
| `limit` | number | no | Max events to return, 1–100, default 50 |

**Output:** `{ events: [...], next_cursor: string | null }`.

Event types: `offer_created`, `offer_countered`, `offer_accepted`, `offer_rejected`, `offer_cancelled`, `offer_expired`, `offer_finalized`, `offer_contact_revealed`.

### `fabric_get_credits`

Get the authenticated node's credit balance and subscription status.

**Inputs:** None.

**Output:** `{ credits_balance: number, subscription: { plan, status, period_start, period_end, credits_rollover_enabled } }`.

---

## Offer Lifecycle

### `fabric_create_offer`

Create an offer on units owned by another node. Specify `unit_ids` from search results. Creates holds on the units immediately.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `unit_ids` | string[] | yes | Array of unit UUIDs (must all belong to same owner) |
| `thread_id` | string \| null | no | Thread UUID for counter-offers within an existing negotiation |
| `note` | string \| null | no | Message to include with the offer |
| `ttl_minutes` | number \| null | no | Time-to-live in minutes (15–10080, default 2880 = 48h) |

**Output:** Created offer object with holds.

### `fabric_counter_offer`

Counter an existing offer with different unit_ids. Creates a new offer in the same negotiation thread and marks the original as countered.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `offer_id` | string (UUID) | yes | UUID of the offer to counter |
| `unit_ids` | string[] | yes | Array of unit UUIDs for the counter-offer |
| `note` | string \| null | no | Message |
| `ttl_minutes` | number \| null | no | Time-to-live in minutes |

### `fabric_accept_offer`

Accept an offer. Both sides must accept for mutual acceptance. On mutual acceptance: units are unpublished, holds become committed, 1 credit is charged to each side, and contact reveal becomes available.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `offer_id` | string (UUID) | yes | UUID of the offer to accept |

### `fabric_reject_offer`

Reject an offer (terminal). Releases all holds immediately. Either party can reject.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `offer_id` | string (UUID) | yes | UUID of the offer to reject |
| `reason` | string \| null | no | Reason for rejection |

### `fabric_cancel_offer`

Cancel an offer you created. Releases all holds immediately. Only the offer creator can cancel.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `offer_id` | string (UUID) | yes | UUID of the offer to cancel |
| `reason` | string \| null | no | Reason for cancellation |

### `fabric_reveal_contact`

Reveal counterparty contact info after mutual acceptance. Returns email, phone, and messaging handles.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `offer_id` | string (UUID) | yes | UUID of the mutually accepted offer |

**Output:** Contact details (email, phone, messaging handles).

### `fabric_list_offers`

List offers you have made or received.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `role` | string enum | yes | `made` (offers you sent) or `received` (incoming offers) |
| `cursor` | string \| null | no | Pagination cursor |
| `limit` | number | no | Results per page (default 20) |

---

## Billing + Credits

### `fabric_get_credit_quote`

Get your credit balance, estimated search costs, available credit packs with prices, and subscription plans.

**Inputs:** None.

### `fabric_buy_credit_pack_stripe`

Start a Stripe checkout to buy a credit pack. Returns a `checkout_url` to complete payment.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `pack_code` | string enum | yes | `credits_500`, `credits_1500`, or `credits_4500` |
| `success_url` | string | yes | URL to redirect after payment |
| `cancel_url` | string | yes | URL to redirect if cancelled |

### `fabric_subscribe_stripe`

Start a Stripe checkout for a subscription plan. Returns a `checkout_url`.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `plan_code` | string enum | yes | `basic`, `pro`, or `business` |
| `success_url` | string | yes | URL to redirect after signup |
| `cancel_url` | string | yes | URL to redirect if cancelled |

### `fabric_buy_credit_pack_crypto`

Create a crypto payment invoice for a credit pack. Returns a `pay_address` and `pay_amount`. Fully agent-native — no browser needed.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `pack_code` | string enum | yes | `credits_500`, `credits_1500`, or `credits_4500` |
| `pay_currency` | string | yes | Crypto currency (e.g. `usdcsol`, `btc`, `eth`) |

### `fabric_get_crypto_currencies`

List available crypto currencies for credit pack purchases.

**Inputs:** None.

---

## Profile + Account

### `fabric_get_profile`

Get your node profile including display name, email, subscription status, plan, and credit balance.

**Inputs:** None.

### `fabric_update_profile`

Update your node profile.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `display_name` | string \| null | no | New display name |
| `email` | string \| null | no | New email address |
| `messaging_handles` | array \| null | no | Array of `{kind, handle, url}` for contact reveal (max 10) |
| `event_webhook_url` | string \| null | no | URL to receive offer lifecycle event webhooks |
| `event_webhook_secret` | string \| null | no | Secret for webhook signature verification |

### `fabric_get_ledger`

Get your credit ledger: a history of all credit grants, debits, and adjustments.

**Inputs:**

| Field | Type | Required | Description |
|---|---|---|---|
| `cursor` | string \| null | no | Pagination cursor |
| `limit` | number | no | Results per page (default 20) |

---

## Not supported via MCP

The following operations are **not** exposed through the MCP endpoint:

- Deleting units/requests
- Admin operations (takedown, projection rebuild)

Use the REST API directly for admin operations.

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
