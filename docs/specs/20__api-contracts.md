# Fabric API — Endpoint contracts (MVP locked)

This document is **normative** and defines the endpoint-by-endpoint contracts in a uniform template.

Global conventions (auth, IDs, error envelope, headers, idempotency, optimistic concurrency, metering, retention) live in `00__read-first.md`.

---

## Common rules used below

- **Auth**: unless noted, endpoints are authenticated via `Authorization: ApiKey <api_key>`.
- **Auth key state**: revoked API keys return `403 forbidden`; missing/invalid keys return `401 unauthorized`.
- **Auth factor boundary**: API key is the only standard runtime auth factor; email is not a runtime auth factor.
- **Admin auth**: endpoints under `/v1/admin/*` and `/internal/admin/*` require `X-Admin-Key: <admin_key>`.
- **Idempotency-Key**: required on all non-GET endpoints except webhooks.
- **Optimistic concurrency**: `PATCH` on mutable resources requires `If-Match: <version>`.
- **Soft delete**: `DELETE` tombstones via `deleted_at`; lists exclude deleted by default.
- **Metered calls**: charge credits only on HTTP 200; metered calls require `Idempotency-Key`.
- **Rate limits**: endpoint-class limits are enforced; exceed returns `429` with canonical error envelope code `rate_limit_exceeded`.
- **Gating**: metered search/search-like endpoints require authenticated ACTIVE, not-suspended nodes with sufficient credits. Pre-purchase daily limits: 3 searches/day, 3 offer creates/day, 1 offer accept/day (lifetime "has ever purchased" flag removes these limits). Offer lifecycle endpoints require legal assent + auth + rate-limit controls. No subscriber gate.

---

# 0) Public metadata + legal/support pages

## GET /v1/meta

### Auth
None

### Purpose
Machine-readable service metadata for legal gating and support discovery.

### Response 200
```json
{
  "api_version": "v1",
  "required_legal_version": "2026-02-17",
  "openapi_url": "https://<host>/openapi.json",
  "categories_url": "https://<host>/v1/categories",
  "categories_version": 1,
  "legal_urls": {
    "terms": "https://<host>/legal/terms",
    "privacy": "https://<host>/legal/privacy",
    "aup": "https://<host>/legal/acceptable-use"
  },
  "support_url": "https://<host>/support",
  "docs_urls": {
    "agents_url": "https://<host>/docs/agents"
  }
}
```

## GET /v1/categories

### Auth
None

### Purpose
Server-discoverable category registry for `category_ids` usage and search filtering.

### Response 200
```json
{
  "categories_version": 1,
  "categories": [
    {
      "id": 1,
      "slug": "goods",
      "name": "Goods",
      "description": "Physical items",
      "examples": ["string", "string", "string", "string", "string"]
    }
  ]
}
```

Category object shape:
- `id`: integer
- `slug`: string
- `name`: string
- `description`: string
- `examples`: string[]

## GET /openapi.json

### Auth
None

### Purpose
Serve OpenAPI 3.x JSON on the same origin as the API.

### Response 200
`application/json` (must include top-level `openapi` field)

## GET /legal/terms
## GET /legal/privacy
## GET /legal/acceptable-use
## GET /legal/refunds
## GET /legal/agents
## GET /legal/aup
## GET /support
## GET /docs/agents

### Auth
None

### Purpose
Serve public legal/support pages and an agent quickstart page from the same service origin as the API.
`/legal/aup` is a compatibility alias for `/legal/acceptable-use`.

### Response 200
`text/html`

# 1) Bootstrap + API keys

## POST /v1/bootstrap

### Auth
None (unauthenticated; rate-limited)

### Idempotency-Key
REQUIRED

### Metering
None

### Purpose
Creates a Node and issues the first API key; applies one-time signup grant.

### Request
```json
{
  "display_name": "string",
  "email": "string|null",
  "referral_code": "string|null",
  "recovery_public_key": "string|null",
  "messaging_handles": [
    {
      "kind": "string",
      "handle": "string",
      "url": "https://example.com|null"
    }
  ],
  "legal": {
    "accepted": true,
    "version": "2026-02-17"
  }
}
```


Response 200
{
  "node": {
    "id": "uuid",
    "display_name": "string",
    "email": "string|null",
    "email_verified_at": "iso|null",
    "recovery_public_key_configured": true,
    "messaging_handles": [
      {
        "kind": "string",
        "handle": "string",
        "url": "https://example.com|null"
      }
    ],
    "event_webhook_url": "https://example.com/webhook|null",
    "status": "ACTIVE|SUSPENDED",
    "plan": "free|basic|pro|business",
    "is_subscriber": false,
    "created_at": "iso"
  },
  "api_key": {
    "key_id": "uuid",
    "api_key": "string",
    "created_at": "iso"
  },
  "credits": {
    "granted": 100,
    "reason": "SIGNUP_GRANT"
  }
}

Rules / side effects

Signup grant (100 credits) applies once per Node.

If referral_code is provided, it is recorded as a referral claim (subject to the referral rules in section 13).

`legal.accepted` MUST be `true` and `legal.version` MUST match `required_legal_version` from `GET /v1/meta`.

Email is account identity/recovery contact data and is not used as a runtime auth factor.

Errors

409 display_name_taken (display_name already in use by another Node)

422 legal_required

422 legal_version_mismatch

422 validation error

POST /v1/auth/keys
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Create an additional API key (label + revoke/rotate). No fine-grained permissions in MVP.

Request
{ "label": "string" }

Response 200
{ "api_key": "string", "key_id": "uuid", "created_at": "iso" }

Errors

401 unauthorized

GET /v1/auth/keys
Auth

Required

Metering

None

Purpose

List keys (masked; no plaintext).

Response 200
{
  "keys": [
    {
      "key_id": "uuid",
      "label": "string",
      "last_used_at": "iso|null",
      "created_at": "iso",
      "prefix": "abcd..."
    }
  ]
}

DELETE /v1/auth/keys/{key_id}
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Revoke a key.

Response 200
{ "ok": true }

Errors

404 not found (key_id not owned by node or doesn’t exist)

401 unauthorized

1b) Email verification + API key recovery policy
POST /v1/email/start-verify
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Start email ownership verification for the authenticated Node and send a one-time code.

Request
{ "email": "string(email)" }

Response 200
{ "ok": true, "challenge_id": "uuid", "expires_at": "iso" }

Rules / side effects

- Stores an email verification challenge (`type='email_verify'`) with TTL and attempt limits.
- Sends code through configured provider (`EMAIL_PROVIDER`).
- Normalizes email to lowercase and resets prior verification state when email changes.

Errors

422 validation_error

503 email_delivery_failed

POST /v1/email/complete-verify
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Complete email ownership verification using the emailed code.

Request
{ "email": "string(email)", "code": "string(6 digits)" }

Response 200
{ "ok": true }

Rules / side effects

- Consumes most recent matching `email_verify` challenge for the Node.
- On success sets `nodes.email_verified_at=now()` and writes recovery audit event.

Errors

422 validation_error

429 rate_limit_exceeded (challenge attempts exceeded)

POST /v1/recovery/start
Auth

None (public; rate-limited per IP and per node_id)

Idempotency-Key

REQUIRED

Metering

None

Purpose

Start API key recovery for a known Node ID.

Request
{ "node_id": "uuid", "method": "pubkey" }

Response 200 (pubkey)
{
  "challenge_id": "uuid",
  "nonce": "hex_string",
  "expires_at": "iso"
}

Rules / side effects

- `method='pubkey'` requires `nodes.recovery_public_key`.
- `method='email'` is not supported in MVP and MUST return `422 validation_error` with `details.reason="email_recovery_not_supported"`.
- TTL and attempts use recovery challenge policy.
- Pre-Phase-2 manual exception policy (outside API endpoint flow): verified email-on-file plus Stripe receipt proof (`pi_...` or `in_...`).
- If no Stripe history exists, manual key rotation is unavailable before Phase 2.

Errors

404 not_found

422 validation_error

429 rate_limit_exceeded

POST /v1/recovery/complete
Auth

None (public)

Idempotency-Key

REQUIRED

Metering

None

Purpose

Complete API key recovery and mint exactly one new plaintext API key.

Request (pubkey)
{ "challenge_id": "uuid", "signature": "base64|hex signature over fabric-recovery:<challenge_id>:<nonce>" }

Response 200
{
  "node_id": "uuid",
  "key_id": "uuid",
  "api_key": "string"
}

Rules / side effects

- Successful completion revokes all prior active API keys for node, then mints one new key.
- Recovery challenge is one-time use (`used_at`).
- Writes audit event (`api_key_recovery_completed`).
- Code-based email recovery payloads are rejected in MVP with `422 validation_error` and `details.reason="email_recovery_not_supported"`.

Errors

404 not_found

422 validation_error

409 invalid_state_transition (challenge already used)

429 rate_limit_exceeded (challenge attempts exceeded)

2) Node profile
GET /v1/me
Auth

Required

Metering

None

Purpose

Get current node profile, subscription snapshot, and credits balance.

Response 200

{
  "node": {
    "id": "uuid",
    "display_name": "string",
    "email": "string|null",
    "email_verified_at": "iso|null",
    "recovery_public_key_configured": true,
    "messaging_handles": [
      {
        "kind": "string",
        "handle": "string",
        "url": "https://example.com|null"
      }
    ],
    "event_webhook_url": "https://example.com/webhook|null",
    "status": "ACTIVE|SUSPENDED",
    "plan": "free|basic|pro|business",
    "is_subscriber": true,
    "created_at": "iso"
  },
  "subscription": {
    "plan": "free|basic|pro|business",
    "status": "none|active|past_due|canceled",
    "period_start": "iso|null",
    "period_end": "iso|null",
    "credits_rollover_enabled": true
  },
  "credits_balance": 123
}


PATCH /v1/me
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Concurrency

Node PATCH may remain last-write-wins (no If-Match required).

Purpose

Update basic node profile fields.

Request
{
  "display_name": "string|null",
  "email": "string|null",
  "recovery_public_key": "string|null",
  "messaging_handles": [
    {
      "kind": "string(1..32, [A-Za-z0-9._-]+)",
      "handle": "string(1..128)",
      "url": "absolute URL|null"
    }
  ],
  "event_webhook_url": "absolute URL|null",
  "event_webhook_secret": "string|null"
}

Validation notes

- `messaging_handles` max length: 10.
- Server normalizes `messaging_handles` values (trimmed; `kind` lower-cased) before persistence and reveal responses.
- `event_webhook_secret` is optional and write-only. If provided as a string, it is trimmed, must be non-empty, and max length 256.
- Setting `event_webhook_secret` to `null` clears the secret; subsequent webhook deliveries are unsigned until a new secret is set.

Response 200

Same shape as GET /v1/me.

Write-only field note

- `event_webhook_secret` is never returned by any API response.

Errors

422 validation error

3) Credits
GET /v1/credits/balance
Auth

Required

Metering

None

Purpose

Get current credits balance and subscription snapshot.

Response 200
{
  "credits_balance": 123,
  "subscription": {
    "plan": "free|basic|pro|business",
    "status": "none|active|past_due|canceled",
    "period_start": "iso|null",
    "period_end": "iso|null",
    "credits_rollover_enabled": true
  }
}

GET /v1/credits/ledger
Auth

Required

Metering

None

Pagination

cursor, limit

Purpose

List credit ledger entries.

Response 200
{
  "entries": [
    {
      "id": "uuid",
      "node_id": "uuid",
      "type": "grant_signup|grant_trial|grant_milestone_requests|grant_subscription_monthly|grant_referral|topup_purchase|debit_search|debit_search_page|deal_accept_fee|debit_broadening|adjustment_manual|reversal",
      "amount": -2,
      "created_at": "iso",
      "meta": {}
    }
  ],
  "next_cursor": "string|null"
}

GET /v1/credits/quote
Auth

Required

Metering

None

Purpose

Return machine-readable quote catalog for search costs, credit packs, and plan monthly credits.

Response 200
{
  "node_id": "uuid",
  "subscription": {
    "plan": "free|basic|pro|business",
    "status": "none|active|past_due|canceled"
  },
  "credits_balance": 123,
  "search_quote": {
    "estimated_cost": 5,
    "breakdown": {
      "base_search_cost": 5,
      "broadening_level": 0,
      "broadening_cost": 0
    }
  },
  "affordability": { "can_afford_estimate": true },
  "credit_packs": [
    {
      "pack_code": "credits_500|credits_1500|credits_4500",
      "name": "500 Credit Pack|1500 Credit Pack|4500 Credit Pack",
      "credits": 500,
      "price_cents": 999,
      "currency": "usd",
      "stripe_price_id": "price_...|null"
    }
  ],
  "plans": [
    { "plan_code": "basic|pro|business", "monthly_credits": 1000 }
  ]
}

POST /v1/credits/quote
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Quote the estimated credits cost for a search-shaped payload without executing search.

Request
{
  "q": "string|null",
  "scope": "local_in_person|remote_online_service|ship_to|digital_delivery|OTHER",
  "filters": {},
  "limit": 20,
  "cursor": "string|null"
}

Response 200

Same shape as `GET /v1/credits/quote`, but `search_quote` is computed from request payload.

Rules

- `estimated_cost = SEARCH_CREDIT_COST` (broadening is deprecated and currently contributes 0 credits)
- `broadening` is optional/deprecated; omitted or null defaults to `{ "level": 0, "allow": false }`.
- Quote endpoints do not execute search and do not mutate credits ledger.
- `POST /v1/credits/quote` uses normal idempotency replay/conflict semantics.


Balance rule

credits_balance = SUM(entries.amount) for the node.

Insufficient credits error (metered endpoints)

HTTP 402
{
  "error": {
    "code": "credits_exhausted",
    "message": "Not enough credits",
    "details": {
      "credits_required": 5,
      "credits_balance": 3
    }
  }
}

4) Scopes (shared model)

Primary enum:
local_in_person | remote_online_service | ship_to | digital_delivery | OTHER

Object fields:

scope_primary: enum|null (nullable until publish)

scope_secondary: enum[]|null

scope_notes: string|null (required at publish if scope_primary=OTHER)

5) Units (canonical private)
POST /v1/units
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Create a Unit (minimal create; publish-time validation applies).

Request (MVP minimal)
{
  "title": "string",
  "description": "string|null",
  "type": "string|null",
  "condition": "new|like_new|good|fair|poor|unknown|null",
  "quantity": 5,
  "estimated_value": 1200.5,
  "measure": "EA|KG|LB|L|GAL|M|FT|HR|DAY|LOT|CUSTOM|null",
  "custom_measure": "string|null",
  "scope_primary": "local_in_person|remote_online_service|ship_to|digital_delivery|OTHER|null",
  "scope_secondary": ["local_in_person"],
  "scope_notes": "string|null",
  "location_text_public": "string|null",
  "origin_region": { "country_code": "US", "admin1": "CA", "admin2": "...", "locality": "...", "postal_code": "...", "place_id": "..." },
  "dest_region":   { "country_code": "US", "admin1": "AZ", "admin2": "...", "locality": "...", "postal_code": "...", "place_id": "..." },
  "service_region": { "country_code": "US", "admin1": "CA" },
  "delivery_format": "file|license_key|download_link|other|null",
  "tags": ["string"],
  "category_ids": [1],
  "public_summary": "string|null"
}

`estimated_value` is optional and non-binding (informational only).

Response 200
{
  "unit": {
    "id": "uuid",
    "node_id": "uuid",
    "publish_status": "draft|published",
    "created_at": "iso",
    "updated_at": "iso",
    "version": 1
  }
}

GET /v1/units
Auth

Required

Metering

None

Pagination

cursor, limit

Purpose

List units (excluding deleted).

GET /v1/units/{unit_id}
Auth

Required

Metering

None

Purpose

Read a unit by id (must be owned by node).

PATCH /v1/units/{unit_id}
Auth

Required

Idempotency-Key

REQUIRED

Concurrency

If-Match: <version> REQUIRED

Metering

None

Purpose

Patch a unit; increments version on success.

DELETE /v1/units/{unit_id}
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Soft delete a unit.

Response 200
{ "ok": true }

6) Requests (canonical private)

Same semantics as Units.

POST /v1/requests
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Create a Request.

Request

Same as Unit create, plus:
{
  "need_by": "iso|null",
  "accept_substitutions": true,
  "ttl_minutes": 10080
}

`ttl_minutes` is optional. If omitted, default is 10080 minutes (7 days). If provided, it must be an integer in [60, 43200]. `request.expires_at` is server-computed and returned.

Rules

Free users may create and publish Requests.

Expired requests are excluded from public projections/search.

GET /v1/requests
Auth

Required

Metering

None

Purpose

List requests (excluding deleted).

GET /v1/requests/{request_id}
Auth

Required

Metering

None

Purpose

Read a request by id (must be owned by node).

PATCH /v1/requests/{request_id}
Auth

Required

Idempotency-Key

REQUIRED

Concurrency

If-Match: <version> REQUIRED

Metering

None

Purpose

Patch a request; increments version on success.

`ttl_minutes` may be provided on patch. Same bounds [60, 43200] apply; server recomputes and returns `expires_at`.

DELETE /v1/requests/{request_id}
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Soft delete a request.

Errors (request create/patch TTL validation)

400 validation_error (details.reason="ttl_minutes_out_of_range")

7) Publish / unpublish (projections)
Publish eligibility (locked)

Common required at publish:

title must exist

type must be non-null

scope_primary must be non-null

if scope_primary=OTHER, scope_notes must be non-empty

Per-scope required:

local_in_person: require location_text_public (coarse)

ship_to: require origin_region and dest_region (at least country_code + admin1)

remote_online_service: require service_region.country_code

digital_delivery: require delivery_format

POST /v1/units/{unit_id}/publish
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Publish a unit into public_listings.

Response 200
{
  "projection": {
    "kind": "listing",
    "source_unit_id": "uuid",
    "published_at": "iso"
  },
  "disclaimer": "string"
}

POST /v1/units/{unit_id}/unpublish
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Remove listing projection.

Response 200
{ "ok": true }

POST /v1/requests/{request_id}/publish
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Publish a request into public_requests.

Response 200
{
  "projection": {
    "kind": "request",
    "source_request_id": "uuid",
    "published_at": "iso"
  },
  "disclaimer": "string"
}

POST /v1/requests/{request_id}/unpublish
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Remove request projection.

Response 200
{ "ok": true }

8) Search (metered) — TWO ENDPOINTS (LOCKED)

Search is authenticated + metered and requires Idempotency-Key. Access is allowed for ACTIVE, not-suspended nodes with sufficient credits.

POST /v1/search/listings
Auth

Required

Node state

ACTIVE and not suspended (otherwise 403 forbidden)

Idempotency-Key

REQUIRED

Metering

Yes

Purpose

Search public_listings.

Request (locked)
{
  "q": "string|null",
  "scope": "local_in_person|remote_online_service|ship_to|digital_delivery|OTHER",
  "filters": {
    "category_ids_any": [1, 2]
  },
  "broadening": { "level": 0, "allow": false },
  "budget": { "credits_requested": 5 },
  "target": { "node_id": null, "username": null },
  "limit": 20,
  "cursor": "string|null"
}

`broadening` is optional/deprecated; omitted or null defaults to `{ "level": 0, "allow": false }`.

Filters schemas (validated by scope)

scope = local_in_person
{
  "center": { "lat": 0, "lng": 0 },
  "radius_miles": 25,
  "regions": ["string"]
}

Rules:

Must include either center+radius_miles or regions (or both).

radius_miles min 1, max 200.

If `regions` is provided, each region ID must match `^[A-Z]{2}(-[A-Z0-9]{1,3})?$` (`CC` or `CC-AA`).

scope = remote_online_service
{
  "regions": ["string"],
  "languages": ["string"]
}

Rule: at least one of regions or languages.

If `regions` is provided, each region ID must match `^[A-Z]{2}(-[A-Z0-9]{1,3})?$` (`CC` or `CC-AA`).

scope = ship_to
{
  "ship_to_regions": ["string"],
  "ships_from_regions": ["string"],
  "max_ship_days": 7
}

Rules:

ship_to_regions required.

max_ship_days optional; min 1, max 30.

`ship_to_regions` and `ships_from_regions` (if provided) must use region IDs in `CC` or `CC-AA` format and match regex `^[A-Z]{2}(-[A-Z0-9]{1,3})?$`.

Matching semantics for region filters:
- `CC` matches any row with `country_code=CC` (any or null `admin1`).
- `CC-AA` matches only rows with `country_code=CC` and `admin1=AA`.
- No reverse broadening: a row with only `country_code=CC` does not satisfy `CC-AA`.

scope = digital_delivery
{
  "regions": ["string"],
  "delivery_methods": ["string"]
}

If `regions` is provided, each region ID must match `^[A-Z]{2}(-[A-Z0-9]{1,3})?$` (`CC` or `CC-AA`).

scope = OTHER
{ "scope_notes": "string" }

Optional on all scopes
{
  "category_ids_any": [1, 2]
}

Validation:

filters must contain only fields allowed for the selected scope.

unknown keys → 422 with error.code="validation_error".

`filters.category_ids_any` accepts integer IDs (no fixed enum validation).

Unknown category IDs in `category_ids_any` MUST NOT return 400/422; they return zero matches if nothing qualifies.

budget.credits_requested is a hard spend ceiling for this call:

- response budget.credits_charged MUST be <= budget.credits_requested.
- if capped, response budget.was_capped=true with actionable budget.guidance.

target is optional:

- if provided, restrict search to that node (scope filters still apply).
- if both node_id and username are provided and resolve to different nodes -> 422 validation_error.
- node_id takes precedence if both refer to the same node.
- target-constrained search is a low-cost follow-up query: when target resolves, `budget.breakdown.base_search_cost` uses `SEARCH_TARGET_CREDIT_COST` instead of the global search base cost.

Response 200

Returns SearchListingsResponse (see 22__projections-and-search.md).
The response `budget` object includes:
- `coverage.page_index_executed`, `coverage.broadening_level_executed`, `coverage.items_returned`
- aliases for agent consumers: `coverage.executed_page_index`, `coverage.executed_broadening_level`, `coverage.returned_count`
- `breakdown.base_search_cost`, `breakdown.broadening_cost`, `breakdown.page_cost`
- additive aliases: `breakdown.base_cost`, `breakdown.pagination_addons`, `breakdown.geo_addon` (currently `0`)
- `credits_charged <= credits_requested` always.

Errors

400 validation_error (invalid_cursor or cursor_mismatch for query-shape/keyset mismatch)

403 forbidden (revoked API key or suspended/non-ACTIVE node)

402 credits_exhausted

422 validation_error (includes inconsistent target and insufficient budget for requested execution)

POST /v1/search/requests

Request (locked)
{
  "q": "string|null",
  "scope": "local_in_person|remote_online_service|ship_to|digital_delivery|OTHER",
  "filters": {
    "category_ids_any": [1, 2]
  },
  "broadening": { "level": 0, "allow": false },
  "budget": { "credits_requested": 5 },
  "target": { "node_id": null, "username": null },
  "limit": 20,
  "cursor": "string|null"
}

`broadening` is optional/deprecated; omitted or null defaults to `{ "level": 0, "allow": false }`.

Validation and budgeting rules are identical to /v1/search/listings (including low-cost target-constrained base pricing).

Response 200

Returns SearchRequestsResponse (see 22__projections-and-search.md).
The response `budget` object includes the same `coverage` and `breakdown` fields/aliases as `/v1/search/listings`.

Errors

400 validation_error (invalid_cursor or cursor_mismatch for query-shape/keyset mismatch)

403 forbidden (revoked API key or suspended/non-ACTIVE node)

402 credits_exhausted

422 validation_error (includes inconsistent target and insufficient budget for requested execution)

9) Node “inventory expansion” after a hit (metered)

These are metered reads (credit spend) for authenticated ACTIVE, not-suspended nodes and require Idempotency-Key.

GET /v1/public/nodes/{node_id}/listings
Auth

Required

Node state

ACTIVE and not suspended

Idempotency-Key

REQUIRED

Metering

Yes

Purpose

List a node’s public listings after a hit.

GET /v1/public/nodes/{node_id}/requests

Same semantics as above.

Response 200 (both)
{
  "node_id": "uuid",
  "limit": 20,
  "cursor": "string|null",
  "items": [{ }],
  "has_more": true
}

GET /v1/public/nodes/{node_id}/listings/categories/{category_id}
Auth

Required

Node state

ACTIVE and not suspended

Idempotency-Key

REQUIRED

Metering

Yes (low fixed debit per page)

Purpose

List a node's public listings filtered to one category id.

Query params

`limit`, `cursor`

Validation

`category_id` must be a non-negative integer.

Response 200
{
  "node_id": "uuid",
  "category_id": 12,
  "limit": 20,
  "cursor": "string|null",
  "items": [{ }],
  "has_more": true
}

Errors

402 budget_cap_exceeded (computed cost exceeds budget.credits_max)

402 credits_exhausted

422 validation_error

429 rate_limit_exceeded

GET /v1/public/nodes/{node_id}/requests/categories/{category_id}

Same semantics and shape as listings drilldown.

9.1) Visibility event persistence (server-side)

Search impression events:

- On successful search responses, the server persists one `search_impression` event per returned item.
- Event fields: `search_id`, `viewer_node_id`, `item_id`, `position`, `scope`, `created_at`.

Detail view events:

- On successful detail reads (`GET /v1/units/{unit_id}`, `GET /v1/requests/{request_id}`), the server persists one `detail_view` event.
- Event fields: `viewer_node_id`, `item_id`, `scope`, `created_at`.

Offer outcomes persisted:

- Accepted outcomes are persisted via `accepted_by_a` / `accepted_by_b` / `mutually_accepted`.
- Rejected, cancelled, and expired outcomes are persisted as `rejected`, `cancelled`, and `expired`.
- These persisted statuses are returned by offer APIs (`POST /v1/offers/*`, `GET /v1/offers`, `GET /v1/offers/{offer_id}`).

10) Offers (legal-gated, auth-gated, rate-limited)

Offer status enum (locked):
pending | accepted_by_a | accepted_by_b | mutually_accepted | rejected | cancelled | countered | expired

Offer object (locked fields):

id, thread_id

from_node_id, to_node_id

status

expires_at (server-computed)

accepted_by_from_at, accepted_by_to_at

hold summary: held_unit_ids, unheld_unit_ids, hold_status, hold_expires_at

created_at, updated_at

version (for concurrency)

Targeting (LOCKED):

Offers target exactly one: unit_id XOR request_id.

MVP offer endpoints below are unit-based via unit_ids array.

Pre-purchase daily limits (until first purchase is recorded in Stripe/ledger):

- Offer creates: max 3/day (UTC), including counter-offers that create a new offer row.
- Offer accepts: max 1/day (UTC).
- On limit exceed: `429` with `error.code="prepurchase_daily_limit_exceeded"` and details including `action`, `window`, `limit`, `used`, `until`.

POST /v1/offers
Auth

Required

Legal assent required

Yes (`legal_required` if caller has not accepted current legal version)

Idempotency-Key

REQUIRED

Metering

None

Purpose

Create an offer referencing exact Unit IDs (single counterparty).

Request
{
  "unit_ids": ["uuid"],
  "thread_id": "uuid|null",
  "note": "string|null",
  "ttl_minutes": 2880
}

Response 200
{ "offer": { /* OfferObject */ }, "disclaimer": "string" }

Rules / side effects

Server derives to_node_id from unit ownership; reject if units span multiple owners.

Creates holds immediately (partial holds allowed); returns held/unheld unit ids and expiry.

If thread_id is present, this is a counter-offer within an existing thread.

`ttl_minutes` is optional. If omitted, default is 2880 minutes (48h). If provided, it must be an integer in [15, 10080]. `offer.expires_at` is server-computed and returned.

Errors

400 validation_error (details.reason="ttl_minutes_out_of_range")

409 invalid_state_transition / conflict

422 validation_error

422 legal_required

429 prepurchase_daily_limit_exceeded

POST /v1/offers/{offer_id}/counter
Auth

Required

Legal assent required

Yes (`legal_required` if caller has not accepted current legal version)

Idempotency-Key

REQUIRED

Metering

None

Purpose

Create a new offer in the same thread; mark the original as countered.

Request
{ "unit_ids": ["uuid"], "note": "string|null", "ttl_minutes": 2880 }

Rules / side effects

Creates a new offer in same thread_id.

Sets original offer status to countered.

Releases original holds; creates new holds for counter-offer.

`ttl_minutes` is optional. If omitted, default is 2880 minutes (48h). If provided, it must be an integer in [15, 10080]. `offer.expires_at` is server-computed and returned.

Errors

400 validation_error (details.reason="ttl_minutes_out_of_range")

404 not_found

422 validation_error

422 legal_required

429 prepurchase_daily_limit_exceeded

POST /v1/offers/{offer_id}/accept
Auth

Required

Legal assent required

Yes (`legal_required` if caller has not accepted current legal version)

Idempotency-Key

REQUIRED

Metering

None

Purpose

Accept an offer.

Request
{}

Rules / side effects

pending → accepted_by_a or accepted_by_b based on caller side.

If other side already accepted → mutually_accepted.

On mutually_accepted, holds become committed (units remain unavailable).

On mutually_accepted, all units involved in the accepted offer are immediately unpublished and removed from `public_listings`.

When the second acceptance finalizes `mutually_accepted`, debit `deal_accept_fee` (1 credit) from each side exactly once.

If either side lacks required credits, finalization fails with `402 credits_exhausted` and no partial debit/finalize occurs.

Errors

403 forbidden

402 credits_exhausted

404 not_found

409 invalid_state_transition

422 legal_required

429 prepurchase_daily_limit_exceeded

POST /v1/offers/{offer_id}/reject
Auth

Required

Legal assent required

No (rejection remains available to authenticated non-subscribers)

Idempotency-Key

REQUIRED

Metering

None

Purpose

Reject an offer.

Request
{ "reason": "string|null" }

Rules / side effects

Offer status becomes rejected (terminal).

Releases holds immediately.

Errors

403 forbidden

404 not_found

POST /v1/offers/{offer_id}/cancel
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Creator cancels an offer.

Request
{ "reason": "string|null" }

Rules / side effects

Only the offer creator can cancel.

Cancelling releases holds immediately.

Errors

403 forbidden

404 not_found

422 legal_required

GET /v1/offers
Auth

Required

Metering

None

Pagination

role=made|received, cursor, limit

Purpose

List offers.

GET /v1/offers/{offer_id}
Auth

Required

Metering

None

Purpose

Read offer details.

11) Holds (separate table; lifecycle locked)

Hold endpoints may be omitted in MVP because Offer responses include the hold summary.

Rules:

Hold TTL equals offer TTL (`hold.expires_at == offer.expires_at`).

Offer TTL default is 48 hours and may be overridden by `ttl_minutes` (bounds [15, 10080]) on offer create/counter.

Hold created on offer creation (partial holds allowed).

Release on: offer rejected | cancelled | countered | expired.

Commit on: offer mutually_accepted (hold status committed).

12) Contact reveal (controlled handoff; locked)
POST /v1/offers/{offer_id}/reveal-contact
Auth

Required

Legal assent required

Yes (`legal_required` if caller has not accepted current legal version)

Idempotency-Key

REQUIRED

Metering

None

Purpose

Reveal contact after mutual acceptance.

Preconditions (all required)

Offer status is mutually_accepted.

Caller is a party to the offer.

Errors

409 if not mutually accepted (error.code="offer_not_mutually_accepted")

403 if caller is not a party (error.code="forbidden")

422 legal_required if caller has not accepted current legal version

Response 200
{
  "contact": {
    "email": "string",
    "phone": "string|null",
    "messaging_handles": [
      {
        "kind": "string",
        "handle": "string",
        "url": "https://example.com|null"
      }
    ]
  },
  "disclaimer": "string"
}

Disclaimer (normative)

- Contact fields returned by reveal-contact, including `messaging_handles`, are user-provided and unverified by Fabric.
- Fabric does not guarantee counterparty identity, fulfillment, or transaction outcomes.
- Any payment/settlement and fulfillment occur off-platform between participants; Fabric is not a party to those transactions.

12b) Offer lifecycle events (webhook + polling fallback)

Node profile event webhook registration:

- `PATCH /v1/me` supports optional `event_webhook_url` to register a per-node webhook sink.
- `PATCH /v1/me` supports optional write-only `event_webhook_secret` to enable webhook signing per node.
- Deliveries are best-effort and audited server-side.
- Deliveries retry with backoff for approximately 30 minutes total; polling remains the fallback.

Webhook payload and signing

- Webhook body is metadata-only (no offer snapshot, no diffs, no contact PII).
- `offer_contact_revealed` notifications do not include revealed contact fields; receivers call reveal-contact separately when eligible.
- If the recipient node has `event_webhook_secret` configured, deliveries include:
  - `X-Fabric-Timestamp`: unix epoch seconds (string)
  - `X-Fabric-Signature`: `t=<timestamp>,v1=<hex_hmac_sha256>`
- If `event_webhook_secret` is not configured, both signature headers are omitted.
- Signed payload bytes are exactly: `<timestamp>.<raw_body>` (UTF-8), where `raw_body` is the exact HTTP request body bytes delivered.
- `v1` is computed as `hex(HMAC_SHA256(event_webhook_secret, signed_payload))`.
- Receiver replay guidance: reject signatures where `X-Fabric-Timestamp` differs from current time by more than 300 seconds.

`GET /v1/events`

Auth

Required

Metering

Conditional

Purpose

Poll offer lifecycle events for the authenticated node using cursor pagination.

Query

`since` (opaque cursor|null), `limit` (1..100, default 50)

Cursor semantics

- `since` is server-issued and opaque to clients.
- Polling is strictly-after semantics: `GET /v1/events?since=X` returns only events that occurred after cursor `X`.
- `next_cursor` is server-issued from the last returned event and can be used directly as the next `since` value.

Response 200
{
  "events": [
    {
      "id": "uuid",
      "type": "offer_created|offer_countered|offer_accepted|offer_cancelled|offer_contact_revealed|subscription_changed",
      "offer_id": "uuid",
      "actor_node_id": "uuid",
      "recipient_node_id": "uuid",
      "payload": {},
      "created_at": "iso"
    }
  ],
  "next_cursor": "string|null"
}

Errors

422 validation_error (`invalid_since_cursor`, `limit_out_of_range`)

13) Referrals (claim + award)
POST /v1/referrals/claim
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Associate current node to a referrer via code.

Rule

Allowed only if the node has no prior paid Stripe event (first paid event locks referral).

Referral grants are awarded only on first paid subscription invoice and capped at 50 grants per referrer.

Request
{ "referral_code": "string" }

Response 200
{ "ok": true, "referrer_node_id": "uuid" }

GET /v1/me/referral-code
Auth

Required

Metering

None

Purpose

Get or create the node's own referral code.

Response 200
{ "referral_code": "string" }

GET /v1/me/referral-stats
Auth

Required

Metering

None

Purpose

Get referral statistics for the authenticated node.

Response 200
{
  "referral_code": "string",
  "total_referrals": 0,
  "awarded": 0,
  "pending": 0,
  "credits_earned": 0,
  "cap": 50,
  "remaining": 50
}

14) Billing checkout session (subscription onboarding)
POST /v1/billing/checkout-session
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Create a Stripe Checkout Session in subscription mode for the authenticated Node.

Request
{
  "node_id": "uuid",
  "plan_code": "basic|pro|business",
  "success_url": "https://...",
  "cancel_url": "https://..."
}

Rules / side effects

node_id must match the authenticated Node.

Server resolves Stripe Price ID from configured plan mapping.

Creates Stripe Checkout Session in subscription mode and sets:

metadata.node_id + metadata.plan_code on Checkout Session

subscription_data.metadata.node_id + subscription_data.metadata.plan_code on Subscription

Response 200
{
  "node_id": "uuid",
  "plan_code": "basic|pro|business",
  "checkout_session_id": "cs_...",
  "checkout_url": "https://checkout.stripe.com/..."
}

Errors

403 forbidden (node_id mismatch)

422 validation_error

14b) Billing checkout session (credit packs)
POST /v1/billing/credit-packs/checkout-session
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Create a Stripe Checkout Session in payment mode for a one-time credit pack purchase.

Request
{
  "node_id": "uuid",
  "pack_code": "credits_500|credits_1500|credits_4500",
  "success_url": "https://...",
  "cancel_url": "https://..."
}

Rules / side effects

- `node_id` must match the authenticated Node.
- Server resolves Stripe Price ID from configured Credit Pack mapping.
- Creates Stripe Checkout Session in payment mode and sets:
  - `metadata.node_id`
  - `metadata.pack_code` (legacy: `metadata.topup_pack_code` also accepted)
  - `metadata.pack_credits` (legacy: `metadata.topup_credits` also accepted)

Response 200
{
  "node_id": "uuid",
  "pack_code": "credits_500|credits_1500|credits_4500",
  "credits": 500,
  "checkout_session_id": "cs_...",
  "checkout_url": "https://checkout.stripe.com/..."
}

Errors

403 forbidden (node_id mismatch)

422 validation_error

15) Stripe webhooks (idempotent; locked)
POST /v1/webhooks/stripe
Auth

None; signature verified

Idempotency-Key

N/A (webhook idempotency by stripe_event_id unique constraint)

Metering

None

Purpose

Handle subscription, invoice, and checkout events; grant credits; award referrals.

Idempotency

Store Stripe event ids; if already processed: return 200.

Events (MVP)

checkout.session.completed

customer.subscription.created|updated|deleted

invoice.paid

invoice.payment_failed

Rules / side effects

Updates subscriber status.

Grants monthly credits once per billing period (unique on (node_id, period_start) in ledger).

Applies referral award on first paid subscription invoice.

Referral award is capped at 50 paid grants per referrer.

Top-up grants:

- If event payload includes `metadata.pack_code` (or legacy `metadata.topup_pack_code`), grant the configured pack credits as `topup_purchase`.
- Grant idempotency is keyed by payment reference (`payment_intent` or `invoice`), independent of Stripe `event.id`.
- Enforce daily velocity limit per node (`CREDIT_PACK_MAX_GRANTS_PER_DAY`); over-limit events still return `200` without grant side effects.

Plan-change semantics:

- On paid upgrade/proration invoice, grant difference credits (`new_plan_monthly_credits - prior_plan_monthly_credits`) immediately.
- Upgrade-difference grant is idempotent by invoice id (`invoice:<invoice_id>:upgrade`).
- Mid-cycle downgrade (`billing_reason=subscription_update` or proration invoice) is deferred; active plan remains unchanged until renewal invoice.
- Downgrade is applied on renewal-cycle invoice (`billing_reason=subscription_cycle`).

Signature verification with 5-minute tolerance.

Response 200
{ "ok": true }

15b) POST /v1/public/nodes/categories-summary
Auth

Required

Idempotency-Key

Not required (read-only aggregation)

Metering

None (zero cost)

Purpose

Batch-fetch per-node category counts for listings and/or requests. Enables agents to determine which categories a node has inventory in before deciding whether to drill down.

Request
{
  "node_ids": ["uuid"],
  "kind": "listings|requests|both"
}

- `node_ids` must contain 1–50 UUIDs.
- `kind` must be one of `listings`, `requests`, or `both`.

Response 200
{
  "summaries": [
    {
      "node_id": "uuid",
      "listings_categories": { "1": 5, "3": 2 },
      "requests_categories": { "1": 3 }
    }
  ]
}

Errors

422 validation_error (invalid node_ids or kind)

15c) Crypto billing (NOWPayments)

POST /v1/billing/crypto-credit-pack
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Create a NOWPayments invoice for a credit pack purchase. Returns a payment address agents send crypto to directly (no browser needed).

Request
{
  "node_id": "uuid",
  "pack_code": "credits_500|credits_1500|credits_4500",
  "pay_currency": "string (e.g. usdcmatic)"
}

Response 200
{
  "node_id": "uuid",
  "pack_code": "string",
  "credits": 500,
  "payment_id": "string",
  "pay_address": "string",
  "pay_amount": 9.99,
  "pay_currency": "usdcmatic",
  "price_amount": 9.99,
  "price_currency": "usd",
  "order_id": "string",
  "valid_until": "iso"
}

Errors

403 forbidden (node_id mismatch)

422 validation_error

GET /v1/billing/crypto-currencies
Auth

Required

Metering

None

Purpose

List available NOWPayments crypto currencies that agents can use for credit pack purchases.

Response 200
{ "currencies": ["usdcmatic", "btc", "eth", ...] }

POST /v1/webhooks/nowpayments
Auth

None; IPN signature verified (HMAC-SHA512 with IPN secret)

Idempotency-Key

N/A (idempotency by order_id unique constraint)

Metering

None

Purpose

Handle NOWPayments IPN callbacks. Grant credits when payment is confirmed.

Rules / side effects

- Verify HMAC-SHA512 signature using configured IPN secret.
- Grant credits only when `payment_status` is `finished` or `confirmed`.
- Idempotent by `order_id`.
- Enforce daily velocity limit per node.

Response 200
{ "ok": true }

15d) Regions discovery

GET /v1/regions
Auth

None (public)

Metering

None

Purpose

Return the supported region codes for the MVP.

Response 200
{
  "country": "US",
  "regions": ["US", "US-AL", "US-AK", ...],
  "format": "CC or CC-AA (ISO 3166-1 alpha-2 country code, optionally followed by admin1 subdivision)",
  "note": "MVP supports US regions only."
}

---

16) Admin (minimal)
POST /v1/admin/takedown
Auth

Admin (X-Admin-Key)

Idempotency-Key

REQUIRED

Metering

None

Purpose

Reversible takedown of listing/request/node.

Request
{
  "target_type": "public_listing|public_request|node",
  "target_id": "uuid",
  "reason": "string"
}

Response 200
{ "ok": true }

POST /v1/admin/credits/adjust
Auth

Admin (X-Admin-Key)

Idempotency-Key

REQUIRED

Metering

None

Purpose

Manual credit adjustment.

Request
{ "node_id": "uuid", "delta": 100, "reason": "string" }

Response 200
{ "ok": true }

POST /v1/admin/projections/rebuild
Auth

Admin (X-Admin-Key)

Idempotency-Key

REQUIRED

Metering

None

Purpose

Invoked by scheduler to rebuild projections.

Query

kind=listings|requests|all

mode=full (MVP only)

Response 200
{
  "ok": true,
  "kind": "listings|requests|all",
  "mode": "full",
  "started_at": "iso",
  "finished_at": "iso",
  "counts": {
    "public_listings_written": 0,
    "public_requests_written": 0
  }
}

GET /internal/admin/daily-metrics
Auth

Admin (X-Admin-Key)

Metering

None

Purpose

Return 24-hour operational digest metrics for abuse, credits/billing health, liquidity, reliability, and webhook delivery health.

Response 200
{
  "generated_at": "iso",
  "window_hours": 24,
  "abuse": {
    "suspended_nodes": 0,
    "active_takedowns": 0,
    "recovery_attempts_exceeded": 0
  },
  "stripe_credits_health": {
    "stripe_events_received": 0,
    "stripe_processing_errors": 0,
    "credit_grants": 0,
    "credit_debits": 0,
    "credit_net": 0
  },
  "liquidity": {
    "public_listings": 0,
    "public_requests": 0,
    "offers_created": 0,
    "offers_mutually_accepted": 0
  },
  "reliability": {
    "searches": 0,
    "active_nodes": 0,
    "active_api_keys": 0
  },
  "webhook_health": {
    "stripe_events_received": 0,
    "stripe_processing_errors": 0,
    "offer_webhook_deliveries": 0,
    "offer_webhook_failures": 0
  }
}

Scheduled projection rebuild (Option B — LOCKED)

Cron calls: POST /v1/admin/projections/rebuild?kind=all&mode=full with X-Admin-Key.

Schedule: every 30 minutes at :07 and :37 America/Los_Angeles.

Rebuild behavior:

Recompute public_listings from all published, non-deleted Units not taken down/suspended.

Recompute public_requests from all published, non-deleted Requests not taken down/suspended.

Apply allowlist for public fields.


