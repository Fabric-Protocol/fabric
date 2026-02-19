# Fabric — Projections + search (MVP locked)

This document is **normative** for publication projections, allowlists, search filters, ranking/sorting, metering, and retention/redaction.

---

## 1) Projection philosophy (public data is derived)

- Canonical objects (`units`, `requests`) are **private**.
- Public marketplace visibility is implemented via projections:
  - `public_listings` derived from Units
  - `public_requests` derived from Requests
- Projection payload is stored as `doc jsonb` and MUST be **allowlist-only**.

---

## 2) Publish/unpublish rules (projection mechanics)

## 2.1 Eligibility (locked)
Common required at publish:
- `title` must exist
- `type` must be non-null
- `scope_primary` must be non-null
- if `scope_primary=OTHER`, `scope_notes` must be non-empty

Per-scope required:
- `local_in_person`: require `location_text_public` (coarse)
- `ship_to`: require `origin_region` and `dest_region` (at least `country_code + admin1`)
- `remote_online_service`: require `service_region.country_code`
- `digital_delivery`: require `delivery_format`

## 2.2 Side effects
- Publish writes/updates:
  - `units.published_at` / `requests.published_at`
  - upsert into `public_listings` / `public_requests`
- Unpublish removes the projection row and clears `published_at` on the source row.

## 2.3 Projections drift correction (locked)
MVP includes scheduled projection rebuild:
- Cron calls: `POST /v1/admin/projections/rebuild?kind=all&mode=full` with `X-Admin-Key`.
- Schedule: every 30 minutes at :07 and :37 America/Los_Angeles.
- Rebuild behavior:
  - Recompute `public_listings` from all published, non-deleted Units not taken down/suspended.
  - Recompute `public_requests` from all published, non-deleted Requests not taken down/suspended.
  - Apply allowlist for public fields.

---

## 3) Projection allowlists (locked)

## 3.1 PublicListing (derived from Unit)
Allowlisted fields:
- `id`, `node_id`
- `scope_primary`, `scope_secondary`
- `title`, `description`, `public_summary`
- `quantity` (nullable), `measure`, `custom_measure` (if `measure=CUSTOM`)
- `estimated_value` (number|null; non-binding estimate)
- `category_ids`, `tags`, `type`, `condition`
- `location_text_public` (coarse only; never precise geo)
- `origin_region`, `dest_region` (ship_to scopes; structured regions only)
- `service_region` (remote; country + optional admin1)
- `delivery_format` (digital)
- `photos[]` (public URLs only)
- `published_at`, `updated_at`

Hard prohibitions:
- NEVER contact info (email/phone)
- NEVER addresses
- NEVER precise geo coordinates

## 3.2 PublicRequest (derived from Request)
Allowlisted fields:
- `id`, `node_id`
- `scope_primary`, `scope_secondary`
- `title`, `description`, `public_summary`
- `desired_quantity` (nullable), `measure`, `custom_measure`
- `category_ids`, `tags`, `type`, `condition` (optional)
- `location_text_public` (coarse only; never precise geo)
- `origin_region`, `dest_region` (if applicable)
- `service_region`, `delivery_format` (if applicable)
- `need_by`, `accept_substitutions`
- `published_at`, `updated_at`

Hard prohibitions:
- NEVER contact info (email/phone)
- NEVER addresses
- NEVER precise geo coordinates

## 3.3 PublicNode (optional allowlist)
- `id`, `display_name`, `avatar_url`, `created_at`
- never contact, never location

---

## 4) Search (two endpoints, metered, entitled-spender-only)

- Search is split by intent:
  - `POST /v1/search/listings`
  - `POST /v1/search/requests`
- Search is:
  - authenticated
  - entitled-spender-only (`active subscription` OR `active trial`)
  - credit-metered
  - cursor-paginated

### 4.1 Request envelope (locked)
```json
{
  "q": "string|null",
  "scope": "local_in_person|remote_online_service|ship_to|digital_delivery|OTHER",
  "filters": {},
  "broadening": { "level": 0, "allow": false },
  "budget": { "credits_requested": 5 },
  "target": { "node_id": null, "username": null },
  "limit": 20,
  "cursor": "string|null"
}
4.2 Filters by scope (validated; unknown keys rejected)
local_in_person

json
Copy code
{
  "center": { "lat": 0, "lng": 0 },
  "radius_miles": 25,
  "regions": ["string"]
}
Rules:

Must include either center+radius_miles or regions (or both).

radius_miles min 1, max 200.

remote_online_service

json
Copy code
{
  "regions": ["string"],
  "languages": ["string"]
}
Rule: at least one of regions or languages.

ship_to

json
Copy code
{
  "ship_to_regions": ["string"],
  "ships_from_regions": ["string"],
  "max_ship_days": 7
}
Rules:

ship_to_regions required.

max_ship_days optional; min 1, max 30.

digital_delivery

json
Copy code
{
  "regions": ["string"],
  "delivery_methods": ["string"]
}
OTHER

json
Copy code
{ "scope_notes": "string" }
Validation:

unknown keys → 422 with error.code="validation_error".

5) Search response shapes (locked)
5.1 SearchListingsResponse
json
Copy code
{
  "search_id":"uuid",
  "scope":"local_in_person|remote_online_service|ship_to|digital_delivery|OTHER",
  "limit":20,
  "cursor":"string|null",
  "broadening": { "level":0, "allow":false },
  "applied_filters": { },
  "budget": {
    "credits_requested": 5,
    "credits_charged": 5,
    "breakdown": {
      "base_search_cost": 5,
      "broadening_level": 0,
      "broadening_cost": 0,
      "page_index": 0,
      "page_cost": 5
    },
    "coverage": {
      "page_index_executed": 1,
      "broadening_level_executed": 0,
      "items_returned": 20
    },
    "was_capped": false,
    "cap_reason": null,
    "guidance": null
  },
  "items":[
    {
      "item": { /* PublicListing */ },
      "rank": {
        "sort_keys": {
          "distance_miles": 3.2,
          "route_specificity_score": 4,
          "fts_rank": 0.12,
          "recency_score": 0.7
        }
      }
    }
  ],
  "nodes": [
    {
      "node_id": "uuid",
      "category_counts_nonzero": { "12": 2, "88": 1 }
    }
  ],
  "has_more": true
}
5.2 SearchRequestsResponse
json
Copy code
{
  "search_id":"uuid",
  "scope":"local_in_person|remote_online_service|ship_to|digital_delivery|OTHER",
  "limit":20,
  "cursor":"string|null",
  "broadening": { "level":0, "allow":false },
  "applied_filters": { },
  "budget": {
    "credits_requested": 5,
    "credits_charged": 5,
    "breakdown": {
      "base_search_cost": 5,
      "broadening_level": 0,
      "broadening_cost": 0,
      "page_index": 0,
      "page_cost": 5
    },
    "coverage": {
      "page_index_executed": 1,
      "broadening_level_executed": 0,
      "items_returned": 20
    },
    "was_capped": false,
    "cap_reason": null,
    "guidance": null
  },
  "items":[
    {
      "item": { /* PublicRequest */ },
      "rank": {
        "sort_keys": {
          "distance_miles": 3.2,
          "route_specificity_score": 4,
          "fts_rank": 0.12,
          "recency_score": 0.7
        }
      }
    }
  ],
  "nodes": [
    {
      "node_id": "uuid",
      "category_counts_nonzero": { "12": 2, "88": 1 }
    }
  ],
  "has_more": true
}
6) Ranking/sorting (MVP semantics)
MVP ranking uses a composite of:

distance_miles (local_in_person only; ascending)

route_specificity_score (ship_to only; descending)

fts_rank (full-text relevance; descending)

recency_score (descending)

The response MUST include rank.sort_keys for transparency/debugging.

Phase 0.5 go-live lock (normative):

- Allowed ranking inputs are limited to scope eligibility filters, lexical/keyword relevance (`fts_rank`), and recency.
- Semantic/vector retrieval is disabled for search.
- Query expansion, synonym expansion, and lexical override inputs are disabled for search.

7) Broadening (paid, explicit, auditable)
Broadening fields:

json
Copy code
"broadening": { "level": 0, "allow": false }
Rules:

Defaults are narrow; broadening expands deterministically.

Broadening increases per-page cost (linear per-page pricing):

cost_per_page = base_page_cost + active_broadening_adders

Broadening level MUST be recorded in search logs.

Broadening cost adders MUST be reflected in budget.breakdown.broadening_cost.

Pagination add-on policy:

- page 1: page_cost = 0 (included in base search cost)
- pages 2-3: page_cost = small add-on
- pages 4-5: page_cost = large add-on
- pages 6+: page_cost = prohibitive add-on (expected to cap for typical request budgets)

Target-constrained pricing policy:

- If `target` resolves to a node, search uses low-cost base pricing for this call.
- `budget.breakdown.base_search_cost` MUST reflect `SEARCH_TARGET_CREDIT_COST` for target-constrained calls and `SEARCH_CREDIT_COST` otherwise.

If budget.credits_requested prevents executing requested broadening/page, return partial results within budget with:

- budget.was_capped=true
- budget.guidance describing how to increase budget or reduce broadening/limit.

8) Node “inventory expansion” (metered)
Endpoints:

GET /v1/public/nodes/{node_id}/listings

GET /v1/public/nodes/{node_id}/requests

Rules:

entitled-spender-only (`active subscription` OR `active trial`)

credit-metered

cursor-paginated

requires Idempotency-Key

Response:

json
Copy code
{
  "node_id":"uuid",
  "limit":20,
  "cursor":"string|null",
  "items":[ { } ],
  "has_more": true
}

8.1 Node per-category drilldown (metered, cheap)
Endpoints:

GET /v1/public/nodes/{node_id}/listings/categories/{category_id}

GET /v1/public/nodes/{node_id}/requests/categories/{category_id}

Rules:

- Same auth/entitlement requirements as node inventory expansion.
- Cursor-paginated.
- Filtered to a single numeric `category_id`.
- Debits a low fixed per-call charge (`nodeCategoryDrilldownCost`).
- Returns 422 `validation_error` for invalid category id or invalid pagination params.
- Returns 402 `credits_exhausted` when account credits are insufficient.
- Returns 429 `rate_limit_exceeded` when drilldown-specific rate limit is exceeded.

Response:

```json
{
  "node_id":"uuid",
  "category_id": 12,
  "limit":20,
  "cursor":"string|null",
  "items":[ { } ],
  "has_more": true
}
```

9) Search logging (privacy + retention locked)
Search logs MUST NOT store raw queries by default. Persist only:

query_redacted (PII-stripped)

query_hash (for dedupe/abuse/analytics)

Redaction happens at ingestion.

Retention:

Hot (primary DB): 30 days

Archive (access-controlled; not in primary DB): up to 1 year

Delete after 1 year

Schema reference: search_logs table stores kind, scope, query_redacted, query_hash, filters_json, page_count, broadening_level, credits_charged.

10) Takedowns and public visibility
Admin reversible takedowns exist for:

listing (projection)

request (projection)

node

Takedown behavior:

Projections removed immediately from public tables.

Rebuild job must respect takedowns (do not reintroduce removed projections).
