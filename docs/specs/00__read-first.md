# Fabric API — Read first (normative)

This file defines **precedence**, **glossary/enums**, and **global conventions** that apply to all endpoints and all implementations.

---

## 0) Precedence order (conflicts resolve top-down)

If any requirement conflicts, resolve in this order:

1. **00__read-first.md** (this file)
2. **10__invariants.md** (MUST / MUST NOT rules)
3. **20__api-contracts.md** (endpoint-by-endpoint contracts)
4. **21__db-ddl.sql** (DDL is authoritative for storage constraints, not API semantics)
5. **22__projections-and-search.md** (projection/search mechanics, allowlists, ranking)
6. **25__plans-credits-gating.md**
7. **30__mvp-scope.md** (what is/ isn’t in MVP)
8. **01__implementation-map.md** (implementation guidance; non-authoritative vs invariants/contracts)
9. **02__agent-onboarding.md** (agent onboarding; non-authoritative vs invariants/contracts)

**40__vision.md is non-normative** (must not add new requirements).

### Documentation class precedence (locked)
- `docs/specs/*` is the normative source-of-truth for product/API/DB behavior.
- `docs/runbooks/*` is operational guidance and must not override specs.
- `docs/project-files/*` are workflow artifacts and are not normative product requirements.
- If a runbook or project-file note conflicts with specs, the specs win.

---

## 1) Glossary (canonical terms)

- **Node**: the principal identity boundary. All actions are attributed to a Node; API keys are scoped to one Node.
- **Unit**: canonical private object representing an allocatable resource with **quantity + measure** (quantity may be null/unknown).
- **Request**: canonical private object representing demand/need; parallel to Units; publishable and searchable.
- **Projection**: deterministic derived public record from canonical private objects when explicitly published (e.g., `public_listings`, `public_requests`).
- **Public Listing / Public Request**: allowlisted public projection payload derived from Unit/Request. Never includes precise geo or contact.
- **Search**: authenticated, entitled-spender-only (`active subscription` OR `active trial`), credit-metered query over projections (two endpoints: listings vs requests).
- **Offer**: structured negotiation action targeting either a Unit or a Request (MVP offers are unit-based via `unit_ids` lines); includes state machine, holds summary, concurrency version.
- **Hold**: reservation record created on offer creation (partial holds allowed); released/committed/expired by offer lifecycle rules.
- **Contact reveal**: controlled handoff returning contact fields only after mutual acceptance; caller must satisfy legal/auth/rate-limit controls.
- **Credits**: metering currency; primarily charged on search and certain metered reads. Ledger is authoritative.
- **Broadening**: explicit paid expansion of search beyond narrow defaults; must be auditable.
- **Scope**: primary modality enum that determines required publish fields and allowed search filters.

Vision line (non-functional): **Fabric is the shared substrate of allocatable reality.**

---

## 2) Global API conventions (apply everywhere)

### 2.1 Auth headers
- **Primary auth (all non-webhook endpoints):** `Authorization: ApiKey <api_key>`
- API key auth is the only standard runtime auth factor for normal endpoints.
- Email is collected for account identity/recovery and operator contact, not as a runtime auth factor.
- Revoked API key: `403 forbidden`; missing/invalid key: `401 unauthorized`.
  - `401` if missing/invalid.
  - API keys are scoped to a single Node.
- **Admin auth:** `X-Admin-Key: <admin_key>` → `401` if missing/invalid.
- **Stripe webhook:** `POST /v1/webhooks/stripe` uses `Stripe-Signature` verification.

### 2.2 IDs
- All IDs are **UUID strings** (`format: uuid`).

### 2.3 Canonical error envelope (LOCKED)
All **non-2xx** responses must be:
```json
{ "error": { "code": "STRING_CODE", "message": "human readable", "details": {} } }
Common statuses (non-exhaustive): 401, 402, 403, 409, 422, 429.

2.4 Rate limit headers (present on all responses)
X-RateLimit-Limit: <int>

X-RateLimit-Remaining: <int>

X-RateLimit-Reset: <unix_seconds>

Retry-After: <seconds> (on 429)

2.5 Credit headers (present on all responses)
X-Credits-Remaining: <int>

X-Credits-Charged: <int> (0 when not charged)

X-Credits-Plan: <string> (free|basic|pro|business|unknown)

2.6 Soft delete
Canonical objects use deleted_at tombstone.

Default list endpoints exclude deleted.

Admin-only endpoints may support include_deleted=true.

2.7 Idempotency (MVP locked)
Clients must send Idempotency-Key: <string> on all state-changing endpoints:

All non-GET endpoints except webhooks.

Server guarantees:

Retrying the same request with the same key returns the same response and does not double-charge credits.

If the same key is reused with a different payload for the same route+node:

409 with error.code = "idempotency_key_reuse_conflict".

Suggested TTL for idempotency records: 24 hours.

2.8 Optimistic concurrency (MVP locked)
Mutable resources (Units, Requests, Offers) include a version integer.

PATCH must include If-Match: <version>.

If version has advanced:

409 with error.code = "stale_write_conflict".

(Implementation note: DB uses row_version; API exposes version.)

2.9 Metering / charge timing (MVP locked)
Metered endpoints charge only on HTTP 200.

Charge is atomic with query execution (no partial results on failure).

Metered endpoints require Idempotency-Key to prevent double-charge on retries.

2.10 Privacy + log retention (MVP locked)
Search logs store no raw queries by default. Persist only:

query_redacted (PII-stripped)

query_hash (for dedupe/abuse/analytics)

Redaction happens at ingestion (raw text does not enter log storage).

Retention:

Hot (primary DB): 30 days

Archive (access-controlled; not in primary DB): up to 1 year

Delete after 1 year

3) Pagination conventions
Pagination is cursor-based.

Many list endpoints accept query params: cursor, limit.

Common response patterns used in this spec:

{ "entries": [...], "next_cursor": "string|null" } (credits ledger)

{ "items": [...], "cursor": "string|null", "has_more": true } (search + public node inventory expansion)

4) Canonical enums (shared vocabulary)
4.1 Plans
free | basic | pro | business

4.2 Primary scope (LOCKED)
local_in_person | remote_online_service | ship_to | digital_delivery | OTHER

4.3 Condition
new | like_new | good | fair | poor | unknown

4.4 Measure
EA | KG | LB | L | GAL | M | FT | HR | DAY | LOT | CUSTOM (nullable)

4.5 Offer status (LOCKED)
pending | accepted_by_a | accepted_by_b | mutually_accepted | rejected | cancelled | countered | expired

4.6 Hold status (DB-level)
active | released | committed | expired

4.7 Subscription status (returned in /v1/me and credits endpoints)
none | active | past_due | canceled

5) Global “do not violate” product constraints (normative summary)
Private-by-default is non-negotiable: Units/Requests are private unless explicitly published.

Projections are allowlisted and must never expose precise geo or contact info.

No in-platform messaging in MVP; use structured actions + controlled contact handoff.

Contact reveal only after mutual acceptance; subscriber status is not a prerequisite for offer progression in MVP.

Search is entitled-spender-only (`active subscription` OR `active trial`), credit-metered, and split into two endpoints (/search/listings and /search/requests).

Referral credits are awarded only after first paid subscription invoice (via webhook mechanics).

