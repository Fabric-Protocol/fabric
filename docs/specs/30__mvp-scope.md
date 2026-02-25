# Fabric API — MVP scope + acceptance criteria (locked for Codex prompt)

## MVP scope (what we are building)

### Surface
- **Agent API only** (no human UI in MVP).

### Stack (locked)
- **Node.js (LTS) + TypeScript**
- **Fastify**
- **Postgres**
- **Cloud Run-compatible Dockerfile (container-first deploy)**

---

## Identity + auth

- Nodes are principals; **principal record may be null** (agent-only Nodes allowed).
- Day-to-day access is via **API keys** (`Authorization: ApiKey <api_key>`).
- Multiple agents per Node implemented as **multiple API keys per Node** (label + revoke/rotate); no fine-grained permissions in MVP.
- **Bootstrap is unauthenticated** and rate-limited; it creates a Node and issues the first API key.
- **Signup grant:** 100 credits applied **once per Node** at bootstrap (ledger entry).

---

## Write-safety + concurrency (MVP locked)

- **Idempotency-Key is REQUIRED on all state-changing endpoints** (all non-GET endpoints except webhooks).
  - Purpose: safe retries without double-charging credits or duplicating state.
  - Reuse with different payload → `409 idempotency_key_reuse_conflict`.
  - Suggested idempotency record TTL: **24h**.
- **Optimistic concurrency on PATCH** for mutable resources (Units/Requests/Offers):
  - Resources expose `version`.
  - PATCH requires `If-Match: <version>`.
  - Stale write → `409 stale_write_conflict`.

---

## Canonical objects

- **Units** (private-by-default). Create requires only `title/name`. Other fields optional (quantity nullable; measure optional until publish; type required at publish).
- Units include optional, non-binding `estimated_value` (number|null).
- **Requests** are first-class canonical objects (private-by-default), with publish/unpublish and their own projections.
- **Locations** are optional metadata.
  - Public projections use only coarse `location_text_public` or structured regions (**never precise geo**).

---

## Publish + projections

- Explicit publish/unpublish endpoints write/update projection tables:
  - `public_listings` derived from Units (listings)
  - `public_requests` derived from Requests
- Projections are minimal and allowlist-only:
  - no precise geo
  - no contact info
  - no addresses
- Projections allow: `public_summary`, `type`, `scope_primary`, `scope_secondary[]`, `condition`, `quantity` (nullable), `measure`, coarse availability fields, and optional `estimated_value` (non-binding).

---

## Scopes (MVP locked)

Canonical `scope_primary` enum (API + DB):
- `local_in_person`
- `remote_online_service`
- `ship_to`
- `digital_delivery`
- `OTHER`

Secondary scopes: optional `scope_secondary[]` from the same enum.

Notes:
- The bak text used older names (`LOCAL_IN_PERSON`, `REMOTE_SERVICE`, `SHIPS_FROM`, `SHIP_TO`, `DIGITAL_DELIVERY`). For MVP we lock to the canonical enum above and map older terms into it as needed (e.g., shipping scenarios expressed via filters, not separate scope enums).

**MVP does NOT implement `rails[]`.**
- Future/novel modalities use `scope_primary=OTHER` + `scope_notes`.

---

## Search (paid, authenticated) — TWO SEARCHES (LOCKED)

- Search targets are **split by intent**:
  - **Listings search** (buyer/acquirer intent): `POST /v1/search/listings`
  - **Requests search** (seller/provider intent): `POST /v1/search/requests`
- Brokers can do both searches and burn credits for both.
- Implementation: **Postgres FTS + filters** on projection tables.
- Search is **credit-metered** (pre-purchase daily limits apply; no subscriber gate).
- Metered endpoints are covered by the global write-safety rule:
  - **Idempotency-Key REQUIRED** to avoid double-charges on retries.

### Go-live matching lock (Phase 0.5)
Allowed:
- structured eligibility filters (scope-specific)
- lexical/keyword ranking (FTS) + recency (and scope-specific tie-breakers like distance for local)

Disallowed at go-live:
- semantic/vector retrieval
- query expansion/synonyms/lexical override inputs
- any “semantic infrastructure” in the request/implementation path

Requests that attempt disallowed search inputs MUST be rejected with `422 validation_error`.

### Scope matrix (deterministic)
- `local_in_person`:
  - Required search filters: `center + radius_miles` (or explicit `regions`; see contracts)
  - Public: only coarse `location_text_public`
  - Ranking: distance ASC, then FTS, then recency
- `remote_online_service`:
  - Required: `service_region.country_code` (admin1 optional)
  - Ranking: FTS then recency
- `ship_to`:
  - Required: `origin_region.country_code+admin1` and `dest_region.country_code+admin1`
  - Matching supports containment (e.g., CA→AZ matches SF→Tempe via structured regions)
  - Ranking: route specificity then FTS then recency
- `digital_delivery`:
  - Required: `country_code` (default user country); optional delivery_format
  - Ranking: FTS then recency
- `OTHER`:
  - Required: `scope_notes`
  - Ranking: FTS then recency

### MVP filters
- keyword (FTS), scope (incl. secondary), type
- category_ids/tags
- condition
- recency window
- distance band (local only)
- route specificity (ship only)

### Credit metering (Phase 0.5)
- Base cost applies to page 1.
- Broadening increases cost additively (see contracts).
- Pagination add-ons (anti-scrape aligned):
  - pages 2–3: small add-on
  - pages 4–5: large add-on
  - pages 6+: prohibitive add-on (typically capped by request budget)
- Search requests include a request-level spend ceiling:
  - `budget.credits_requested` (hard cap)
  - response returns `budget.credits_charged <= credits_requested`
  - capped executions return 200 with `budget.was_capped=true` and guidance

### Search privacy + retention (MVP locked)
- Do **not** store raw search queries by default.
- Persist only:
  - `query_redacted` (PII-stripped), and
  - `query_hash` (for dedupe/abuse/analytics).
- Redaction happens **at ingestion** (raw text does not enter event/log storage).
- Retention:
  - **Hot retention:** 30 days queryable in primary DB.
  - **Archive:** up to 1 year (access-controlled; not in primary DB).
  - **Delete after 1 year** (no indefinite retention of event logs).

---

## Visibility (MVP)
- Persist visibility events:
  - `search_impression` for each unit returned in search results (includes `search_id` and position).
  - `detail_view` emitted on unit/request detail reads (private detail endpoints).
- Offer outcomes must persist: `accepted|rejected|expired|cancelled` (plus intermediate statuses per offer state model).

---

## Offers + deal lifecycle

### Gating (final)
- Create/accept/counter/cancel/reveal-contact: legal-assent + auth + rate-limit gated (not subscriber-only).
- Reject Offer: allowed for authenticated recipients (including non-subscribers).
- Free users may create/publish Requests.

### Offer status model (locked)
- `pending`
- `accepted_by_a`
- `accepted_by_b`
- `mutually_accepted`
- `rejected`
- `cancelled`
- `countered`
- `expired`

### Counter-offers (locked)
- Counter creates a **new Offer** linked by `thread_id`.
- Prior offer becomes `countered`.

### Reservation / holds (locked)
- Holds exist as a separate table.
- Hold created **on offer creation**.
- Holds reserve **specific Unit IDs**.
- Partial holds allowed:
  - Offer response includes `held_unit_ids` and `unheld_unit_ids`.
- Hold TTL = 48 hours; auto-release on expiry.
- Release on: reject/cancel/counter/expire.
- Commit on: mutual accept (hold status `committed`).

---

## Contact reveal

- Contact reveal occurs after **mutual acceptance**.
- Reveal requires caller legal assent and party authorization checks.
- Contact fields: **email required**, phone optional, `messaging_handles[]` optional (user-provided/unverified).
- Safety disclaimers shown at publish, offer, and contact reveal.

---

## Node “inventory expansion” + drilldown

- Dedicated endpoints to view all public requests/listings for a Node after a hit (to support multi-unit offers).
- Metered as a search-like call (credits + pagination), and rate-limited.
- Per-category drilldown endpoints exist (cheap, paginated, rate-limited) for node inventory exploration by category.

---

## Pricing + credits (MVP) — LOCKED

### Subscriptions
- **Basic:** $9.99 / 1,000 credits (≈ $0.01000/credit)
- **Pro:** $19.99 / 3,000 credits (≈ $0.00667/credit)
- **Business:** $49.99 / 10,000 credits (≈ $0.00500/credit)

### Credit Packs (one-time top-ups, worse value than subscriptions)
- 500 credits = $9.99 (≈ $0.02000/credit)
- 1,500 credits = $19.99 (≈ $0.01333/credit)
- 4,500 credits = $49.99 (≈ $0.01111/credit)

### Acquisition
- Signup grant: **100 credits one-time**

---

## Credits + billing

- Credits ledger is authoritative (balance computed as SUM of deltas).
- Monthly subscription credit reset.
- 1-month rollover for higher tiers (implementation detail; enforce per plan policy).
- Credit top-ups supported via Stripe webhook (idempotent fulfillment).
- Referrals are in MVP: credit award on **first paid subscription invoice** via Stripe webhook.
- Referral capture supports `POST /v1/referrals/claim` (claim allowed until first paid event).

---

## Admin/abuse (minimal)

- Admin authenticated via admin API key allowlist (`X-Admin-Key`).
- Takedowns are reversible (soft state): projections removed immediately; Nodes use `suspended_at`.
- Admin actions are audited.

---

## Phase 2 explicitly out of scope

- In-platform messaging
- reputation
- price/value range filters
- advanced verification gating
- dispute resolution workflow

---

## Projections rebuild (scheduled) — LOCKED (Option B)

- Projections can drift; MVP includes a scheduled rebuild job.
- Schedule: **every 30 minutes at :07 and :37 America/Los_Angeles**
- Rebuild behavior:
  - Recompute `public_listings` from all published, non-deleted Units not taken down/suspended.
  - Recompute `public_requests` from all published, non-deleted Requests not taken down/suspended.
  - Apply allowlist for public fields (no precise geo, no contact, no address).

---

## Acceptance criteria (definition of done)

### Happy path (must work end-to-end)

1. Node A bootstraps (Node created, API key issued, 100 credits granted once).
2. Node A creates a Request and publishes it (projection created). (Free allowed.)
3. Node B (active subscriber or active trial) runs a paid search and receives results (credits deducted per-page with current broadenings and pagination add-ons).
   - This is done via `POST /v1/search/requests` when Node B is looking to fulfill requests,
   - and/or `POST /v1/search/listings` when Node B is looking to acquire listings.
4. Node B opens the hit and can view Node A’s other public Requests/Listings via node expansion (metered/rate-limited).
5. Node B can drill into Node A’s inventory by category via the per-category drilldown endpoints (cheap, paginated, rate-limited).
6. Visibility events are persisted for impressions and detail views; offer outcomes persist final states.
