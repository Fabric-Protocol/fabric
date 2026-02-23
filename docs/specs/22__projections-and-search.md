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
- `max_ship_days` (optional shipping SLA days)
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
- `max_ship_days` (optional shipping SLA days)
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

## 4) Search (two endpoints, metered)

- Search is split by intent:
  - `POST /v1/search/listings`
  - `POST /v1/search/requests`
- Search is:
  - authenticated
  - available to ACTIVE, not-suspended authenticated nodes
  - credit-metered
  - cursor-paginated

### 4.1 Request envelope (locked)
```json
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

`cursor` is an opaque keyset token and must be reused only with the same query shape (`scope`, `q`, `filters`, `target`).
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

If `regions` is provided, each region ID must match `^[A-Z]{2}(-[A-Z0-9]{1,3})?$` (`CC` or `CC-AA`).

remote_online_service

json
Copy code
{
  "regions": ["string"],
  "languages": ["string"]
}
Rule: at least one of regions or languages.

If `regions` is provided, each region ID must match `^[A-Z]{2}(-[A-Z0-9]{1,3})?$` (`CC` or `CC-AA`).

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

`ship_to_regions` and `ships_from_regions` (if provided) must use region IDs in `CC` or `CC-AA` format and match regex `^[A-Z]{2}(-[A-Z0-9]{1,3})?$`.

Matching semantics for region filters:
- `CC` matches any row with `country_code=CC` (any or null `admin1`).
- `CC-AA` matches only rows with `country_code=CC` and `admin1=AA`.
- No reverse broadening: a row with only `country_code=CC` does not satisfy `CC-AA`.

digital_delivery

json
Copy code
{
  "regions": ["string"],
  "delivery_methods": ["string"]
}

If `regions` is provided, each region ID must match `^[A-Z]{2}(-[A-Z0-9]{1,3})?$` (`CC` or `CC-AA`).
OTHER

json
Copy code
{ "scope_notes": "string" }

Optional on all scopes:

json
Copy code
{
  "category_ids_any": [1, 2]
}
Validation:

unknown keys → 422 with error.code="validation_error".

`filters.category_ids_any` accepts integer IDs (no fixed enum validation).

Unknown category IDs in `category_ids_any` MUST NOT return 400/422; they return zero matches if nothing qualifies.

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
      "page_index": 1,
      "page_cost": 0,
      "base_cost": 5,
      "pagination_addons": 0,
      "geo_addon": 0
    },
    "coverage": {
      "page_index_executed": 1,
      "broadening_level_executed": 0,
      "items_returned": 20,
      "executed_page_index": 1,
      "executed_broadening_level": 0,
      "returned_count": 20
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
          "distance_miles": null,
          "route_specificity_score": 4,
          "fts_rank": 0.12,
          "recency_score": 1739558400
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
      "page_index": 1,
      "page_cost": 0,
      "base_cost": 5,
      "pagination_addons": 0,
      "geo_addon": 0
    },
    "coverage": {
      "page_index_executed": 1,
      "broadening_level_executed": 0,
      "items_returned": 20,
      "executed_page_index": 1,
      "executed_broadening_level": 0,
      "returned_count": 20
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
          "distance_miles": null,
          "route_specificity_score": 4,
          "fts_rank": 0.12,
          "recency_score": 1739558400
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
MVP ranking uses:

- `fts_rank` from Postgres full-text search on precomputed projection vectors (`search_tsv`) built from `title`, `public_summary`, `description`, and `tags`.
- `route_specificity_score` for `ship_to` scope (specific `CC-AA` matches score above broad `CC` matches; destination and origin scores add).
- `recency_score` as `extract(epoch from updated_at)` for transparency/debugging.
- `distance_miles` remains `null` in Phase 0.5 (geo ranking deferred).

Deterministic ordering:

- `ship_to`: `route_specificity_score DESC`, `fts_rank DESC`, `updated_at DESC`, `id DESC`
- other scopes: `fts_rank DESC`, `updated_at DESC`, `id DESC`

Cursor semantics:

- Search pagination uses opaque keyset cursors derived from the active sort tuple.
- Cursor payload includes scope + query-shape fingerprint.
- Reusing a cursor with a different query shape must return `400 validation_error` (`cursor_mismatch`).

The response MUST include `rank.sort_keys` for transparency/debugging.

Phase 0.5 go-live lock (normative):

- Allowed ranking inputs are limited to scope eligibility filters, lexical/keyword relevance (`fts_rank`), and recency.
- Semantic/vector retrieval is disabled for search.
- Query expansion, synonym expansion, and lexical override inputs are disabled for search.

7) Broadening (deprecated, explicit, auditable)
Broadening fields:

json
Copy code
"broadening": { "level": 0, "allow": false }
Rules:

Defaults are narrow; broadening expands deterministically.

Broadening no longer increases credit cost in MVP.

Broadening level MUST be recorded in search logs.

`budget.breakdown.broadening_cost` MUST remain `0`.

Pagination add-on policy:

- page 1: page_cost = 0 (included in base search cost)
- page 2: page_cost = 2
- page 3: page_cost = 3
- page 4: page_cost = 4
- page 5: page_cost = 5
- pages 6+: page_cost = 100 per page

Target-constrained pricing policy:

- default base search cost is `SEARCH_CREDIT_COST` (default `5`).
- If `target` resolves to a node, search uses low-cost base pricing for this call.
- `budget.breakdown.base_search_cost` MUST reflect `SEARCH_TARGET_CREDIT_COST` for target-constrained calls and `SEARCH_CREDIT_COST` otherwise.

If budget.credits_requested prevents executing requested page, return partial results within budget with:

- budget.was_capped=true
- budget.guidance describing how to increase budget or reduce limit.

8) Node “inventory expansion” (metered)
Endpoints:

GET /v1/public/nodes/{node_id}/listings

GET /v1/public/nodes/{node_id}/requests

Rules:

authenticated ACTIVE, not-suspended node

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

- Same auth/node-state requirements as node inventory expansion.
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
