# Fabric API — Endpoint contracts (MVP locked)

This document is **normative** and defines the endpoint-by-endpoint contracts in a uniform template.

Global conventions (auth, IDs, error envelope, headers, idempotency, optimistic concurrency, metering, retention) live in `00__read-first.md`.

---

## Common rules used below

- **Auth**: unless noted, endpoints are authenticated via `Authorization: ApiKey <api_key>`.
- **Admin auth**: endpoints under `/v1/admin/*` require `X-Admin-Key: <admin_key>`.
- **Idempotency-Key**: required on all non-GET endpoints except webhooks.
- **Optimistic concurrency**: `PATCH` on mutable resources requires `If-Match: <version>`.
- **Soft delete**: `DELETE` tombstones via `deleted_at`; lists exclude deleted by default.
- **Metered calls**: charge credits only on HTTP 200; metered calls require `Idempotency-Key`.
- **Rate limits**: endpoint-class limits are enforced; exceed returns `429` with canonical error envelope code `rate_limit_exceeded`.
- **Subscriber gating**: subscriber-only endpoints remain subscription-only even when credits are available.

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
  "legal_urls": {
    "terms": "https://<host>/legal/terms",
    "privacy": "https://<host>/legal/privacy",
    "aup": "https://<host>/legal/aup"
  },
  "support_url": "https://<host>/support",
  "docs_urls": {
    "agents_url": "https://<host>/docs/agents"
  }
}
```

## GET /openapi.json

### Auth
None

### Purpose
Serve OpenAPI 3.x JSON on the same origin as the API.

### Response 200
`application/json` (must include top-level `openapi` field)

## GET /legal/terms
## GET /legal/privacy
## GET /legal/aup
## GET /support
## GET /docs/agents

### Auth
None

### Purpose
Serve public legal/support pages and an agent quickstart page from the same service origin as the API.

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
    "granted": 200,
    "reason": "SIGNUP_GRANT"
  }
}

Rules / side effects

Signup grant (200 credits) applies once per Node.

If referral_code is provided, it is recorded as a referral claim (subject to the referral rules in section 13).

`legal.accepted` MUST be `true` and `legal.version` MUST match `required_legal_version` from `GET /v1/meta`.

Errors

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
{ "display_name": "string|null", "email": "string|null" }

Response 200

Same shape as GET /v1/me.

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
      "type": "grant_subscription_monthly|grant_referral|debit_search|debit_search_page|debit_broadening|adjustment_manual|reversal|grant_signup|topup_purchase",
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
    "plan": "free|basic|plus|pro|business",
    "status": "none|active|past_due|canceled"
  },
  "credits_balance": 123,
  "search_quote": {
    "estimated_cost": 2,
    "breakdown": {
      "base_search_cost": 2,
      "broadening_level": 0,
      "broadening_cost": 0
    }
  },
  "affordability": { "can_afford_estimate": true },
  "credit_packs": [
    {
      "pack_code": "credits_100|credits_300|credits_1000",
      "credits": 100,
      "price_cents": 400,
      "currency": "usd",
      "stripe_price_id": "price_...|null"
    }
  ],
  "plans": [
    { "plan_code": "basic|plus|pro|business", "monthly_credits": 500 }
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
  "broadening": { "level": 0, "allow": false },
  "limit": 20,
  "cursor": "string|null"
}

Response 200

Same shape as `GET /v1/credits/quote`, but `search_quote` is computed from request payload.

Rules

- `estimated_cost = SEARCH_CREDIT_COST + broadening.level`
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
  "accept_substitutions": true
}

Rules

Free users may create and publish Requests.

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

DELETE /v1/requests/{request_id}
Auth

Required

Idempotency-Key

REQUIRED

Metering

None

Purpose

Soft delete a request.

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
  }
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
  }
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

Search is subscriber-only + metered and requires Idempotency-Key.

POST /v1/search/listings
Auth

Required

Subscriber-only

Yes (403 subscriber_required)

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
  "filters": {},
  "broadening": { "level": 0, "allow": false },
  "limit": 20,
  "cursor": "string|null"
}

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

scope = remote_online_service
{
  "regions": ["string"],
  "languages": ["string"]
}

Rule: at least one of regions or languages.

scope = ship_to
{
  "ship_to_regions": ["string"],
  "ships_from_regions": ["string"],
  "max_ship_days": 7
}

Rules:

ship_to_regions required.

max_ship_days optional; min 1, max 30.

scope = digital_delivery
{
  "regions": ["string"],
  "delivery_methods": ["string"]
}

scope = OTHER
{ "scope_notes": "string" }

Validation:

filters must contain only fields allowed for the selected scope.

unknown keys → 422 with error.code="validation_error".

Response 200

Returns SearchListingsResponse (see 22__projections-and-search.md).

Errors

403 subscriber_required

402 credits_exhausted

422 validation_error

POST /v1/search/requests

Same contract as /v1/search/listings, but returns SearchRequestsResponse.

9) Node “inventory expansion” after a hit (metered)

These are metered reads (credit spend), subscriber-only, and require Idempotency-Key.

GET /v1/public/nodes/{node_id}/listings
Auth

Required

Subscriber-only

Yes

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

10) Offers (subscriber-only create/accept/counter; free recipients can reject)

Offer status enum (locked):
pending | accepted_by_a | accepted_by_b | mutually_accepted | rejected | cancelled | countered | expired

Offer object (locked fields):

id, thread_id

from_node_id, to_node_id

status

accepted_by_from_at, accepted_by_to_at

hold summary: held_unit_ids, unheld_unit_ids, hold_status, hold_expires_at

created_at, updated_at

version (for concurrency)

Targeting (LOCKED):

Offers target exactly one: unit_id XOR request_id.

MVP offer endpoints below are unit-based via unit_ids array.

POST /v1/offers
Auth

Required

Subscriber-only

Yes

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
  "note": "string|null"
}

Response 200
{ "offer": { /* OfferObject */ } }

Rules / side effects

Server derives to_node_id from unit ownership; reject if units span multiple owners.

Creates holds immediately (partial holds allowed); returns held/unheld unit ids and expiry.

If thread_id is present, this is a counter-offer within an existing thread.

Errors

403 subscriber_required

409 invalid_state_transition / conflict

422 validation_error

POST /v1/offers/{offer_id}/counter
Auth

Required

Subscriber-only

Yes

Idempotency-Key

REQUIRED

Metering

None

Purpose

Create a new offer in the same thread; mark the original as countered.

Request
{ "unit_ids": ["uuid"], "note": "string|null" }

Rules / side effects

Creates a new offer in same thread_id.

Sets original offer status to countered.

Releases original holds; creates new holds for counter-offer.

POST /v1/offers/{offer_id}/accept
Auth

Required

Subscriber-only

Yes

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

POST /v1/offers/{offer_id}/reject
Auth

Required

Subscriber-only

NO (allowed for non-subscribers)

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

Hold TTL: 48 hours from offer creation.

Hold created on offer creation (partial holds allowed).

Release on: offer rejected | cancelled | countered | expired.

Commit on: offer mutually_accepted (hold status committed).

12) Contact reveal (controlled handoff; locked)
POST /v1/offers/{offer_id}/reveal-contact
Auth

Required

Subscriber-only

Implied by preconditions (both parties must be subscribers)

Idempotency-Key

REQUIRED

Metering

None

Purpose

Reveal contact after mutual acceptance.

Preconditions (all required)

Offer status is mutually_accepted.

Caller is a party to the offer.

Both nodes are subscribers (fairness rule).

Errors

409 if not mutually accepted (error.code="offer_not_mutually_accepted")

403 if either party not subscriber (error.code="subscriber_required")

Response 200
{
  "contact": {
    "email": "string",
    "phone": "string|null"
  }
}

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

Request
{ "referral_code": "string" }

Response 200
{ "ok": true, "referrer_node_id": "uuid" }

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
  "plan_code": "basic|plus|pro|business",
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
  "plan_code": "basic|plus|pro|business",
  "checkout_session_id": "cs_...",
  "checkout_url": "https://checkout.stripe.com/..."
}

Errors

403 forbidden (node_id mismatch)

422 validation_error

14b) Billing checkout session (credit top-ups)
POST /v1/billing/topups/checkout-session
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
  "pack_code": "credits_100|credits_300|credits_1000",
  "success_url": "https://...",
  "cancel_url": "https://..."
}

Rules / side effects

- `node_id` must match the authenticated Node.
- Server resolves Stripe Price ID from configured top-up pack mapping.
- Creates Stripe Checkout Session in payment mode and sets:
  - `metadata.node_id`
  - `metadata.topup_pack_code`
  - `metadata.topup_credits`

Response 200
{
  "node_id": "uuid",
  "pack_code": "credits_100|credits_300|credits_1000",
  "credits": 100,
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

Top-up grants:

- If event payload includes `metadata.topup_pack_code`, grant the configured pack credits as `topup_purchase`.
- Grant idempotency is keyed by payment reference (`payment_intent` or `invoice`), independent of Stripe `event.id`.
- Enforce daily velocity limit per node (`TOPUP_MAX_GRANTS_PER_DAY`); over-limit events still return `200` without grant side effects.

Signature verification with 5-minute tolerance.

Response 200
{ "ok": true }

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

Scheduled projection rebuild (Option B — LOCKED)

Cron calls: POST /v1/admin/projections/rebuild?kind=all&mode=full with X-Admin-Key.

Schedule: every 30 minutes at :07 and :37 America/Los_Angeles.

Rebuild behavior:

Recompute public_listings from all published, non-deleted Units not taken down/suspended.

Recompute public_requests from all published, non-deleted Requests not taken down/suspended.

Apply allowlist for public fields.
