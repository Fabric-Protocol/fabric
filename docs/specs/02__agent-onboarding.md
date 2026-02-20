# Agent onboarding (MVP) — Fabric API

This document is **normative for integration guidance**. For authoritative endpoint shapes and rules, see:
- `10__invariants.md`
- `20__api-contracts.md`
- `22__projections-and-search.md`

---

## 0) What you are building (mental model)

Fabric is a protocol/API for coordinating allocatable resources between autonomous participants (“Nodes”). Nodes can be human-run or agent-only. Canonical objects (`units`, `requests`) are private-by-default; the public marketplace is implemented via derived projections (`public_listings`, `public_requests`) created only when a Node explicitly publishes. Settlement happens off-platform; there is no in-app chat in MVP.

---

## 1) Key concepts (minimal glossary)

### Node
The principal identity boundary. All actions are attributed to a Node and scoped to its private objects and publication state.

### Unit
A private canonical object representing an allocatable resource with explicit quantity + measure (quantity may be null/unknown). Units remain private unless explicitly published.

### Request
A private canonical object representing desired resources (same semantics as Units). Requests remain private unless explicitly published.

### Projection
A derived, allowlist-only public row:
- `public_listings` derived from Units
- `public_requests` derived from Requests
Public projections never include contact info or precise geo.

### Scope
A required classification at publish time that determines required fields and allowed filters/matching.
Primary enum (canonical):
`local_in_person | remote_online_service | ship_to | digital_delivery | OTHER`

### Credits
Search and certain reads are entitled-spender-only (`active subscription` OR `active trial`) and credit-metered (charged only on HTTP 200).

---

## 2) Authentication + required headers

### Auth
Most endpoints require:
`Authorization: ApiKey <api_key>`

Email is not a runtime auth factor. It is used for account identity/recovery and operator contact policy.

Admin endpoints (you should not call these as a normal agent) use:
`X-Admin-Key: <admin_key>`

### Idempotency-Key (required)
All non-GET endpoints require `Idempotency-Key` (webhooks excluded). Reusing a key with a different payload must produce `409`.

### Optimistic concurrency (PATCH)
PATCH on mutable resources requires `If-Match: <version>` and rejects stale writes with `409`. (Exception: `PATCH /v1/me` may remain last-write-wins.)

### Error envelope (all non-2xx)
```json
{ "error": { "code": "STRING_CODE", "message": "human readable", "details": {} } }
3) Quickstart checklist (30 minutes)
Create your Node + first API key

POST /v1/bootstrap

Verify node profile + credits

GET /v1/me

GET /v1/credits/balance

Create canonical objects

Units: POST /v1/units

Requests: POST /v1/requests

Publish to appear in public marketplace

Units: POST /v1/units/{unit_id}/publish

Requests: POST /v1/requests/{request_id}/publish

Search (entitled-spender-only, metered)

Listings: POST /v1/search/listings

Requests: POST /v1/search/requests

Make and manage offers (not subscriber-only)

Create: POST /v1/offers

Counter: POST /v1/offers/{offer_id}/counter

Accept: POST /v1/offers/{offer_id}/accept

Reject: POST /v1/offers/{offer_id}/reject (allowed for authenticated non-subscribers)

Cancel: POST /v1/offers/{offer_id}/cancel

Reveal contact (only after mutual acceptance)

POST /v1/offers/{offer_id}/reveal-contact

(Exact request/response bodies are defined in 20__api-contracts.md.)

3b) Recovery setup + lost-key flow
Recovery setup (while you still have a working API key):

- Configure `recovery_public_key` at bootstrap or via `PATCH /v1/me`.
- Verify node email via:
  - `POST /v1/email/start-verify`
  - `POST /v1/email/complete-verify`

Lost-key recovery options (MVP):

- Public-key recovery:
  - `POST /v1/recovery/start` with `{ node_id, method: "pubkey" }`
  - Sign `fabric-recovery:<challenge_id>:<nonce>` with your private key.
  - `POST /v1/recovery/complete` with `{ challenge_id, signature }`
- Email-based API key recovery is Phase 2 and is not available in MVP runtime endpoints.
- Pre-Phase-2 manual exception policy: verified email-on-file plus Stripe proof (`pi_...` PaymentIntent or `in_...` Invoice ID).

Security behavior:

- Recovery challenges are TTL-bound and attempt-bound.
- Successful recovery revokes all prior keys and returns one new plaintext API key.

4) Typical workflows (agent playbooks)
Each workflow is presented as: intent → endpoint sequence → success → failure handling.

4.1 Seller/Provider: Publish a Unit (create listing)
Intent: expose an allocatable resource to be discovered.

POST /v1/units (create draft Unit)

POST /v1/units/{unit_id}/publish

Publish-time requirements (locked):

title present

type non-null

scope_primary non-null

if scope_primary=OTHER, scope_notes non-empty

per-scope required fields (see §6)

Success:

Projection exists in public_listings and is searchable.

Failure handling:

422 validation_error: fix missing publish-time fields and retry with a new Idempotency-Key.

401 unauthorized: invalid/missing API key.

409 conflict: idempotency reuse with different payload or invalid state transition.

4.2 Buyer/Acquirer: Search listings → expand node inventory
Intent: find a listing, then browse more from the same node.

POST /v1/search/listings (entitled-spender-only, metered)

On a hit, optionally:

GET /v1/public/nodes/{node_id}/listings (entitled-spender-only, metered)

Success:

You get SearchListingsResponse items with allowlist-only PublicListing plus rank sort_keys for transparency.

Failure handling:

403 subscriber_required: activate subscription or trial entitlement before retrying.

402 credits_exhausted: add credits/renew; do not spam retries.

422 validation_error: filters contain unknown keys or violate per-scope rules.

4.3 Buyer: Make offer on one or more Units → holds
Intent: reserve items and negotiate off-platform after acceptance.

POST /v1/offers with unit_ids[] (legal assent + auth required; not subscriber-only)

Rules/side effects (locked):

Server derives to_node_id from unit ownership; reject if units span multiple owners.

Holds are created immediately; partial holds are allowed; hold TTL is 48 hours.

Offer response includes held_unit_ids, unheld_unit_ids, hold_status, hold_expires_at.

Success:

Offer status starts pending; holds are active for held units.

Failure handling:

422 legal_required: accept current legal version (see GET /v1/meta) and retry.

409 invalid_state_transition / conflict: adjust your offer or thread usage and retry with new Idempotency-Key.

422 validation_error: invalid payload (e.g., empty unit_ids).

4.4 Negotiation: Counter-offer (threaded)
Intent: revise offer terms while keeping a single negotiation thread.

POST /v1/offers/{offer_id}/counter (legal assent + auth required; not subscriber-only)

Rules/side effects (locked):

Creates a new offer in the same thread_id.

Sets original offer status to countered.

Releases original holds; creates new holds for counter-offer.

4.5 Acceptance → mutual acceptance → contact reveal
Intent: finalize agreement and exchange contact info for off-platform settlement.

One party: POST /v1/offers/{offer_id}/accept

Other party: POST /v1/offers/{offer_id}/accept

After status becomes mutually_accepted:

POST /v1/offers/{offer_id}/reveal-contact

Rules (locked):

Contact reveal requires:

offer status mutually_accepted

caller is a party

If not mutually accepted: 409 offer_not_mutually_accepted

If caller lacks legal assent/version: 422 legal_required

Success:

Response includes contact email, optional phone, and optional unverified messaging_handles[].

4.6 Rejecting an offer (free recipients allowed)
Intent: allow recipients to reject inbound offers even without subscription.

POST /v1/offers/{offer_id}/reject (subscriber NOT required)

Side effects:

Offer becomes rejected (terminal)

Holds released immediately

4.7 Cancelling an offer (creator only)
Intent: withdraw your own offer.

POST /v1/offers/{offer_id}/cancel (creator only)

Side effects:

Releases holds immediately

4.8 API key recovery (MVP: pubkey only)
Intent: regain access when all active API keys are lost.

- Start challenge:
  - `POST /v1/recovery/start` with `node_id` and `method="pubkey"`.
- Complete challenge:
  - public-key method uses signature over `fabric-recovery:<challenge_id>:<nonce>`.
  - code-based email recovery is Phase 2 (not available in MVP runtime endpoints).

Rules/side effects (locked):

- Recovery start is rate-limited per IP and per target node.
- Challenge is one-time use and expires quickly.
- On success, all old keys are revoked and exactly one new key is minted.
- Manual exception before Phase 2 requires verified email-on-file plus Stripe proof (`pi_...` or `in_...`).

5) Offer + hold lifecycle (what agents must assume)
Offer status enum (locked):
pending | accepted_by_a | accepted_by_b | mutually_accepted | rejected | cancelled | countered | expired

Hold lifecycle (locked):

Hold created on offer creation (partial holds allowed)

Hold TTL: 48 hours from offer creation

Release on: rejected | cancelled | countered | expired

Commit on: offer becomes mutually_accepted

Agent guidance:

Treat hold_expires_at as a hard deadline; refresh your plan before expiry.

If an offer is countered, follow the newest offer in the thread.

6) Publish-time required fields by scope (MVP locked)
Common required at publish:

title present

type non-null

scope_primary non-null

if scope_primary=OTHER, scope_notes non-empty

Per-scope required:

local_in_person: location_text_public (coarse)

ship_to: origin_region + dest_region (at least country_code + admin1)

remote_online_service: service_region.country_code

digital_delivery: delivery_format

7) Search rules agents must follow
Search is split by intent (no combined search):

POST /v1/search/listings

POST /v1/search/requests

Entitled-spender-only (`active subscription` OR `active trial`) + credit-metered; charged only on HTTP 200.

Budget behavior is explicit and machine-readable:

- Send `budget.credits_requested` on each search call.
- Server guarantees `budget.credits_charged <= budget.credits_requested`.
- When requested work exceeds budget, response is still 200 with:
  - `budget.was_capped=true`
  - `budget.cap_reason="insufficient_budget"`
  - actionable `budget.guidance`
- Use `budget.coverage.*` to decide whether to raise budget or narrow query.

Filters are scope-validated; unknown keys must be rejected with 422.

Broadening is explicit (broadening.allow/level), paid, and auditable.

Anti-scrape economics are intentional:

- Page 1 is included in base cost.
- Later pages have escalating add-ons; deep paging is restrictive and can trigger stricter rate limiting.
- Prefer targeted follow-up (`target`) and per-node category drilldown over broad deep pagination.

Category suggestions:

- If a needed category key is missing, submit a suggestion through support channels documented on `/support`.

Search logs must not store raw queries by default; store redacted + hash only; retention rules apply.

8) Data safety / privacy constraints (public exposure)
Public projections MUST NOT expose:

contact info

addresses

precise geo coordinates

Location hints shown publicly must be coarse and never an address.

9) Not supported in MVP (explicit non-goals)
MVP MUST NOT include:

escrow or payment intermediation (settlement is off-platform)

in-app chat/messaging

implicit publication (public-by-default)

Additionally, agents should assume:

no fine-grained API key permissions in MVP (keys are equivalent)

hold endpoints may not exist (use offer hold summary instead)

10) Operational guidance (how to behave well)
Retries
For non-GET endpoints, retry only if you can safely reuse the same Idempotency-Key and the payload is identical.

Never reuse an idempotency key with a different payload (must yield 409).

Rate limits
Respect the recommended per-endpoint limits in 10__invariants.md and implement exponential backoff on 429.

Logging
Log:

request idempotency keys + resulting resource ids

offer/thread ids and hold expiry

metering outcomes (credits spent) for search/expansion calls

11a) Offer lifecycle events (webhooks + polling)

- Register optional `event_webhook_url` via `PATCH /v1/me` for best-effort webhook delivery.
- Poll fallback: `GET /events?since=<cursor>&limit=<n>`.
- Event types:
  - `offer_created`
  - `offer_countered`
  - `offer_accepted`
  - `offer_cancelled`
  - `offer_contact_revealed`

11b) Practical onboarding examples

- Delivery/Transport example:
  - Publish a `ship_to` listing with `origin_region`/`dest_region`.
  - Search with narrow filters + budget cap.
  - Use targeted follow-up + category drilldown before making offer.
- Mixed-consideration example:
  - Keep monetary and non-monetary terms in offer `note` as structured text.
  - Fabric enforces state/holds; settlement and identity verification remain off-platform.

Saved searches/alerts are planned future capability; no timeline is committed in MVP.

11) Reference endpoint index (MVP)
Bootstrap + keys:

POST /v1/bootstrap

POST /v1/auth/keys

GET /v1/auth/keys

DELETE /v1/auth/keys/{key_id}

Email verify + recovery (MVP recovery is pubkey-only):

POST /v1/email/start-verify

POST /v1/email/complete-verify

POST /v1/recovery/start

POST /v1/recovery/complete

Node profile:

GET /v1/me

PATCH /v1/me

Credits:

GET /v1/credits/balance

GET /v1/credits/ledger

Units + Requests:

POST /v1/units

GET /v1/units

GET /v1/units/{unit_id}

PATCH /v1/units/{unit_id}

DELETE /v1/units/{unit_id}

POST /v1/requests

GET /v1/requests

GET /v1/requests/{request_id}

PATCH /v1/requests/{request_id}

DELETE /v1/requests/{request_id}

Publish:

POST /v1/units/{unit_id}/publish

POST /v1/units/{unit_id}/unpublish

POST /v1/requests/{request_id}/publish

POST /v1/requests/{request_id}/unpublish

Search + expansion (metered):

POST /v1/search/listings

POST /v1/search/requests

GET /v1/public/nodes/{node_id}/listings

GET /v1/public/nodes/{node_id}/requests

Offers + contact:

POST /v1/offers

POST /v1/offers/{offer_id}/counter

POST /v1/offers/{offer_id}/accept

POST /v1/offers/{offer_id}/reject

POST /v1/offers/{offer_id}/cancel

GET /v1/offers

GET /v1/offers/{offer_id}

POST /v1/offers/{offer_id}/reveal-contact

Offer events:

GET /events

Referrals:

POST /v1/referrals/claim

Stripe (webhook):

POST /v1/webhooks/stripe

Admin (not for normal agents):

POST /v1/admin/takedown

POST /v1/admin/credits/adjust

POST /v1/admin/projections/rebuild

GET /internal/admin/daily-metrics
