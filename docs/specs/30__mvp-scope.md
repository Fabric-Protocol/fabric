# Fabric API — MVP scope + acceptance criteria (locked for Codex prompt)

## MVP scope (what we are building)

### Surface
- **Agent API only** (no human UI in MVP).

### Stack (locked)
- **Next.js API** (Vercel target)
- **Supabase Postgres**

---

## Identity + auth

- Nodes are principals; **principal record may be null** (agent-only Nodes allowed).
- Day-to-day access is via **API keys** (`Authorization: ApiKey <api_key>`).
- Multiple agents per Node implemented as **multiple API keys per Node** (label + revoke/rotate); no fine-grained permissions in MVP.
- **Bootstrap is unauthenticated** and rate-limited; it creates a Node and issues the first API key.
- **Signup grant:** 200 credits applied **once per Node** at bootstrap (ledger entry).

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
- Projections allow: `public_summary`, `type`, `scope_primary`, `scope_secondary[]`, `condition`, `quantity` (nullable), `measure`, coarse availability fields.

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
- Search is **subscriber-only** and **credit-metered**.
- Metered endpoints are covered by the global write-safety rule:
  - **Idempotency-Key REQUIRED** to avoid double-charges on retries.

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

### MVP filters
- keyword (FTS), scope (incl. secondary), type
- category_ids/tags
- condition
- recency window
- distance band (local only)
- route specificity (ship only)

### Credit metering (locked form)
- Linear per-page pricing:
  - `cost_per_page = base_page_cost + active_broadening_adders`
- Broadening increases **per-page** cost (not a one-time fee).

### Broadening (locked principle)
- Defaults are narrow; broadening expands results deterministically.
- Broadening dimensions can include:
  - radius (local)
  - recency window
  - region specificity (ship/remote/digital, only where publisher coverage allows)
  - FTS cutoff relaxation
  - tag/category relaxation

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

## Offers + deal lifecycle

### Gating (final)
- Create Offer: subscriber-only
- Accept Offer: subscriber-only
- Counter Offer: subscriber-only
- Reject Offer: allowed for free recipients (still requires auth)
- Free users may create/publish Requests (so they can receive Offers and be incentivized to subscribe to accept)

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
- Reveal **fails until both parties are subscribers** (fairness rule).
- Contact fields: **email required**, phone optional.
- Safety disclaimers shown at publish, offer, and contact reveal.

---

## Node “inventory expansion”

- Dedicated endpoints to view all public requests/listings for a Node after a hit (to support multi-unit offers).
- Metered as a search-like call (credits + pagination), and rate-limited.

---

## Pricing + credits (MVP) — LOCKED

### Subscriptions
- **Basic:** $9.99 / 500 credits (≈ $0.01998/credit)
- **Pro:** $19.99 / 1,500 credits (≈ $0.01333/credit)
- **Business:** $49.99 / 5,000 credits (≈ $0.01000/credit)

### Top-ups (worse than Basic)
- 100 credits = $4 (=$0.040/credit)
- 300 credits = $12 (=$0.040/credit)
- 1,000 credits = $38 (≈$0.038/credit)

### Acquisition
- Signup grant: **200 credits one-time**

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
- pagination cost escalation
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

1. Node A bootstraps (Node created, API key issued, 200 credits granted once).
2. Node A creates a Request and publishes it (projection created). (Free allowed.)
3. Node B (subscriber) runs a paid search and receives results (credits deducted per-page with current broadenings).
   - This is done via `POST /v1/search/requests` when Node B is looking to fulfill requests,
   - and/or `POST /v1/search/listings` when Node B is looking to acquire listings.
4. Node B opens the hit and can view Node A’s other public Requests/Listings via node expansion (metered/rate-limited).
5. Node B creates an Offer (subscriber + rate limit enforced); hold created immediately (partial holds allowed).
6. Node A counters; Node B accepts; Node A accepts (state transitions correct → mutual acceptance); hold becomes committed.
7. Contact reveal is attempted:
   - If either party is not a subscriber, reveal fails with a clear error and upgrade requirement.
   - When both are subscribers, contact info is revealed (email required, phone if present).
8. All auditable events are logged: search, credit spend, publish/unpublish, offer/counter/accept/reject, hold lifecycle, contact reveal attempt/outcome, admin actions.

### Non-functional acceptance

- Projections contain no sensitive fields (no contact info, no precise geo, no addresses).
- Audit/event logs:
  - Search text is redacted-at-ingestion (no raw query by default).
  - 30d hot + 1y archive + delete after 1y.
- Credit metering and rate limiting work under load and cannot be bypassed by pagination/broadening abuse.
- Stripe webhooks are idempotent; credits/subscription state update correctly.
- Referral credit award triggers on first paid subscription invoice via webhook; claim is prevented after first paid event.
