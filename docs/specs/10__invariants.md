# Fabric invariants (v1, 1-page) — UPDATED

This document is **normative**: requirements here are **MUST / MUST NOT** unless explicitly labeled “recommended.”

---

## 1) Canonical backend with a stable protocol
- Fabric **MUST** be a canonical backend/platform with a stable protocol/API for coordinating allocatable resources between participants (“Nodes”).
- Fabric **MUST** be a system of record for private canonical objects and deterministic derived projections.

---

## 2) Node is the principal identity boundary
- A Node **MUST** be treated as an autonomous participant (often an agent) that may represent a human/organization principal.
- All actions **MUST** be attributed to a Node; the Node **MUST** own its private objects and publication state.
- Node principals **MAY** be agent-only (principal record may be null).

---

## 3) Unit is the canonical private object
- A Unit **MUST** represent an allocatable resource with explicit measure and quantity.
- Quantity **MAY** be unknown/null to allow uncertainty.
- Units **MUST** remain private unless explicitly published.

---

## 4) Private-by-default is non-negotiable
- All Units and Requests **MUST** be private by default.
- Publication **MUST** be explicit; there is **NO** implicit “public unless hidden.”

---

## 5) Public marketplace behavior is implemented as projections
- Public listings and public requests **MUST** be derived projections created only when a Node publishes.
- Projections **MUST** be minimal (allowlist fields only):
  - **MUST NOT** expose precise geo publicly; geo is **internal-only** for matching/ranking.
  - **MUST NOT** expose contact info publicly.
  - A public summary/description field **MAY** be exposed (allowlist fields only).

---

## 6) Fabric is not escrow and not a payment intermediary
- Fabric **MUST NOT** hold funds, intermediate payment, or provide escrow.
- Settlement **MUST** happen off-platform between participants.

---

## 7) No in-platform messaging in MVP
- The MVP **MUST NOT** include in-app chat/messaging.
- Interaction **MUST** be via structured actions (publish, search, offer, accept/reject/counter, contact reveal).

---

## 8) Contact reveal is controlled by handoff rules
- Contact information **MUST** be revealed only after mutual acceptance.
- Contact reveal **MUST** fail until both parties are subscribers (fairness rule).
- Safety disclaimers **MUST** be included at publish, offer, and reveal.

---

## 9) Location hints are search-contextual, not publisher-exposed
- Public projections **MUST NOT** show precise location.
- Any location hint shown **MUST** be coarse and derived from search context or a user-chosen label (never an address).

---

## 10) Scope is explicit and required at publish time (MVP locked)
- Every published listing/request **MUST** declare:
  - a primary scope, and
  - optional secondary scopes.
- Scope **MUST** determine required fields, eligible matching paths, and allowed broadening dimensions.

Primary scope enum (canonical):
- `local_in_person`, `remote_online_service`, `ship_to`, `digital_delivery`, `OTHER`

MVP note:
- `rails[]` is deferred; use `OTHER + scope_notes` for novel modalities.

---

## 11) Type is required at publish (not at creation)
- Draft private Units/Requests **MAY** omit type.
- Type **MUST** be required at publish time to support matching/search.

---

## 12) Search is authenticated, paid, and credit-metered (two searches)
- Search **MUST** be authenticated and credit-metered; credits meter:
  - query execution
  - pagination
  - broadening
  - node inventory expansion
- Search **MUST** be subscriber-only (credits required).
- Search **MUST** be split by intent (no combined search):
  - `POST /v1/search/listings` (buyer/acquirer intent)
  - `POST /v1/search/requests` (seller/provider intent)
- Brokers **MAY** run both searches and burn credits for both.

---

## 13) Broadening is explicit, paid, and auditable
- Broadening **MUST** be an explicit paid action with deterministic rules and clear user controls.
- Every broadening dimension **MUST** expand results from narrow defaults.

---

## 14) Subscription + abuse controls are built-in (incl. rate limits)
- Offer create / accept / counter **MUST** be subscriber-only and rate-limited.
- Offer recipients **MAY** reject even if not subscribed (still authenticated as a Node).
- Free users **MAY** create/publish Requests (growth wedge).
- Admin controls **MUST** exist for suspension/takedown and anomaly response hooks.

Recommended MVP rate limits (per Node API key):
- Global: burst 30/10s; sustained 120/min; daily backstop (non-search) 10,000/day
- Search: 20/min (burst 5/10s)
- Inventory expand: 6/min (burst 2/10s)
- Offers create/counter: 30/min (burst 5/10s)
- Offers accept/reject: 60/min (burst 10/10s)
- Contact reveal: 10/hour (burst 2/10s)
- Bootstrap: 3/hour (burst 1/10s)
- API key issuance: 10/day

---

## 15) Auditable event logging from day one (privacy + retention locked)
- Fabric **MUST** log auditable events for searches (including scope/broadening), credit spend, publish/unpublish, offers, accept/reject/counter, holds, and contact handoffs.

MVP lock (explicit mechanics):
- Search query storage: **MUST NOT** store raw queries by default. Persist only:
  - `query_redacted` (PII-stripped), and
  - `query_hash` (for dedupe/abuse/analytics).
- Redaction timing: redaction **MUST** happen **at ingestion** (raw text does not enter event/log storage).
- Retention:
  - Hot retention: 30 days queryable in primary DB.
  - Archive: up to 1 year (access-controlled; not in primary DB).
  - Delete after 1 year (no indefinite retention of event logs).
- Operational enforcement:
  - Run `npm run retention:search-logs` on a schedule to archive rows older than 30 days and delete rows older than 1 year.

Write safety (concurrency/idempotency):
- Canonical error envelope (all non-2xx):
  - `{ "error": { "code": "STRING_CODE", "message": "human readable", "details": {} } }`
- All state-changing endpoints **MUST** require `Idempotency-Key` (reuse with different payload => `409`).
- Mutable resources **MUST** use optimistic concurrency on PATCH via `If-Match` (reject stale writes with `409`).

---

## 16) Referral-driven virality via credits
- Growth **MUST** be driven by referral links that award credits only after first paid subscription invoice.
- The system **MUST** include fraud controls and the ability to claw back awards.

---

## 17) Pricing + credits (MVP locked)
Subscriptions:
- Basic: $9.99 / 500 credits
- Pro: $19.99 / 1,500 credits
- Business: $49.99 / 5,000 credits

Top-ups (worse than Basic):
- 100 credits = $4
- 300 credits = $12
- 1,000 credits = $38

Acquisition:
- Signup grant: 200 credits one-time

---

## 18) Projections rebuild (scheduled; MVP locked)
- MVP **MUST** include a scheduled rebuild job to correct projection drift.
- Schedule: every 30 minutes at :07 and :37 America/Los_Angeles.
- Rebuild **MUST** recompute public projections from all published, non-deleted canonical objects not taken down/suspended; allowlist enforced.

---

## 19) Legal assent is required for bootstrap
- `POST /v1/bootstrap` **MUST** require explicit legal assent payload with accepted=`true` and a matching legal version.
- The backend **MUST** reject missing/false assent or version mismatch with canonical error envelopes.
- The service **MUST** expose machine-readable legal pointers and required legal version at `GET /v1/meta`.

---

## 20) Vision invariant
- Fabric is the shared substrate of allocatable reality.
