# Implementation map (MVP) — where spec concepts land in code

Purpose: Give Codex a single index for “where to implement what” so it doesn’t scatter logic across random files.

Precedence: This file is **informational**, but the routing/auth/error/idempotency behaviors here MUST match:
- `00__read-first.md`
- `10__invariants.md`
- `20__api-contracts.md`
- `22__projections-and-search.md`

---

## 0) Repo + runtime assumptions

Backend repo: `fabric-api`  
Runtime: (fill) `Next.js API routes` | `Express` | `Fastify` | `Hono` | other: ______  
DB: (fill) `Postgres` (recommended)  
ORM/query: (fill) `drizzle` | `prisma` | `kysely` | SQL-only  
Migrations: (fill) `drizzle-kit` | `prisma migrate` | `knex` | `sqitch` | SQL scripts

> Codex rule: Do not introduce new frameworks/layers. Use the chosen stack above.

---

## 1) Directory map (source-of-truth locations)

Routing layer:
- `src/routes/*` or `app/api/*` or `pages/api/*` (fill exact path once scaffolded)

Request validation / schemas:
- `src/schemas/*` (zod or equivalent) (fill)

Controllers / handlers (thin):
- `src/handlers/*` (fill)

Domain services (business rules):
- `src/services/*` (fill)

DB access layer:
- `src/db/*` (fill)

Shared HTTP utilities (errors/headers):
- `src/http/*` (fill)

Background jobs (if any in MVP; likely none):
- `src/jobs/*` (fill)

---

## 2) Cross-cutting middleware (global behaviors)

### 2.1 Auth middleware (ApiKey + Admin)
Spec concept:
- `Authorization: ApiKey <api_key>` for normal endpoints
- `X-Admin-Key` for admin endpoints

Code landing:
- `src/http/middleware/auth.ts` (placeholder)
Responsibilities:
- Parse headers, load Node by api_key, attach `req.node`
- Enforce admin-only routes
- Return canonical error envelope on failure (401)

### 2.2 Error envelope helper (canonical shape)
Spec concept:
- All errors return `{ "error": { code, message, details } }`

Code landing:
- `src/http/error.ts` (placeholder)
Responsibilities:
- Single function to create and send errors
- Central mapping from internal exceptions → `error.code` + HTTP status
- Ensure *no* non-envelope error responses leak

### 2.3 Idempotency middleware + store
Spec concept:
- All non-GET require `Idempotency-Key` (webhooks excluded)
- Same key + different payload → 409

Code landing:
- `src/http/middleware/idempotency.ts` + `src/db/idempotency.ts` (placeholders)
Store:
- Postgres table (recommended) `idempotency_keys` with: key, node_id, route, request_hash, response_status, response_body, created_at, expires_at
Responsibilities:
- For non-GET: require header, hash payload, enforce key uniqueness per (node_id, route, key)
- If replay and hash matches: return stored response
- If replay and hash differs: 409
- TTL / cleanup policy per invariants

### 2.4 Optimistic concurrency for PATCH
Spec concept:
- PATCH requires `If-Match: <version>` and rejects stale with 409 (except `PATCH /v1/me` if explicitly last-write-wins)

Code landing:
- `src/http/middleware/ifMatch.ts` + DB row version column handling (placeholders)
Responsibilities:
- Validate `If-Match`
- Compare against resource `version`
- Increment `version` on successful update

### 2.5 Metering middleware (credits + subscriber gating)
Spec concepts:
- Subscriber gating on specific endpoints (search, offers, contact reveal, etc.)
- Charge credits only on HTTP 200
- Return clear errors for `subscriber_required` / `credits_exhausted`

Code landing:
- `src/http/middleware/metering.ts` + `src/services/credits.ts` (placeholders)
Responsibilities:
- Determine metered action type per route (search listings/requests, expand, etc.)
- Check subscription status
- Check balance / reserve / decrement on success
- Write ledger row with request_id + action metadata
- Ensure failures do not charge

---

## 3) Domain services (where business rules live)

### 3.1 Units service (canonical object)
Spec concepts:
- Private-by-default
- Soft delete
- Publish/unpublish triggers projection writes

Code landing:
- `src/services/units.ts` + `src/db/units.ts` (placeholders)

### 3.2 Requests service
Same pattern as Units.

Code landing:
- `src/services/requests.ts` + `src/db/requests.ts`

### 3.3 Publish/unpublish + projection builders
Spec concepts:
- Allowlist-only public projections
- Projection rebuild support
- Redaction/retention rules
- No contact info / precise geo

Code landing:
- `src/services/publish.ts` (or `src/services/projections.ts`)
- `src/db/projections/*`
Responsibilities:
- `publishUnit(unit_id)` → upsert public_listings row
- `unpublishUnit(unit_id)` → delete/tombstone projection row
- Same for requests
- Rebuild function that regenerates projections from canonicals

### 3.4 Search service
Spec concepts:
- Scope-aware filters and validation
- Ranking/sorting rules
- Broadening logic
- Expansion endpoints (public node listings/requests)

Code landing:
- `src/services/search.ts` + `src/db/search.ts`
Responsibilities:
- Validate filters strictly (unknown keys → 422)
- Run query (FTS/filters) over projections
- Apply sort and ranking; return stable cursor pagination if required

### 3.5 Offers + holds service
Spec concepts:
- Offer state machine and transitions
- Holds creation/release/expiry
- Counter creates new offer with thread_id
- Contact reveal only after mutual acceptance and both subscribed

Code landing:
- `src/services/offers.ts` + `src/services/holds.ts` + `src/db/offers.ts`
Responsibilities:
- enforce transitions centrally (single function)
- create/release holds in same DB transaction
- compute `held_unit_ids/unheld_unit_ids` and expiry timestamps
- enforce contact reveal gating

### 3.6 Referrals service
Spec concepts:
- claim/referral credit awarding
- anti-abuse checks (if specified)

Code landing:
- `src/services/referrals.ts`

---

## 4) DB migrations strategy (single source of truth)

DDL source:
- `docs/specs/21__db-ddl.sql` (authoritative)

Implementation rule:
- Migrations must track the DDL and be replayable on clean DB.
- Prefer SQL migrations checked into `migrations/` (or tool-specific folder).

Where migrations live:
- `migrations/` (placeholder)

Conventions:
- One migration per logical change
- Never hand-edit prior migrations after merge
- Include indexes and constraints required for search + idempotency + holds

---

## 5) Testing map (minimal but critical)

Contract tests (request/response + errors):
- `tests/http/*` (placeholder)

State machine tests (offers/holds):
- `tests/domain/offers.test.*`

Projection correctness tests:
- `tests/domain/projections.test.*`

Metering tests:
- ensure “charged only on 200”
- ensure subscriber gating errors

---

## 6) “Do not do” list (Codex guardrails)

- Do not create new endpoint routes not in `20__api-contracts.md`.
- Do not invent enum values; use the spec enums.
- Do not implement business rules in handlers; put them in services.
- Do not bypass error helper; all errors must be in the canonical envelope.
- Do not charge credits on non-200 responses.
