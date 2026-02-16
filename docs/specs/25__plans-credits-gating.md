
---

## `Plans.md`

```md
# Plans.md — Fabric plans, credits, gating (MVP)

This document defines **commercial behavior** that the API enforces:
- what requires an active subscription
- what consumes credits
- what limits apply (rate limits + quotas)
- how free/non-subscriber Nodes can still participate (minimal fairness)

This document must not conflict with:
- `docs/specs/10__invariants.md`
- `docs/specs/20__api-contracts.md`
- `docs/specs/22__projections-and-search.md`

---

## 0) Definitions

- **Subscriber**: Node with an active paid plan.
- **Credits**: consumable units used to meter certain actions (primarily search).
- **Metered endpoint**: endpoint that decrements credits on HTTP 200 only.
- **Free node**: Node without an active plan.

---

## 1) Gating rules (MVP)

### 1.1 Always allowed (free and subscribed)
These actions MUST be available to all Nodes (subject to rate limits and abuse prevention):
- Create/manage own canonical private data (Units, Requests) (unless explicitly gated elsewhere)
- Publish/unpublish own Units/Requests (unless explicitly gated elsewhere)
- View own objects (Units/Requests/Offers involving the node)
- Reject inbound offers (recipient fairness)
- Admin endpoints are not applicable (admin only)

> Rationale: a marketplace cannot function if recipients must pay to say “no”.

### 1.2 Subscriber-only (MVP)
These actions require the caller to be a Subscriber:
- Search listings (`POST /v1/search/listings`)
- Search requests (`POST /v1/search/requests`)
- “Expand” reads that are metered (e.g., view a node’s other public listings/requests) if marked metered in contracts
- Create offers
- Counter offers
- Accept offers (if contracts gate acceptance; keep aligned with spec)
- Contact reveal attempt (caller must be Subscriber)

### 1.3 Two-sided subscriber rule (contact reveal)
Contact reveal is allowed only when:
- offer status is mutually accepted
- caller is a party to the offer
- **both parties are Subscribers**

If either party is not a Subscriber, contact reveal returns `403 subscriber_required` (or the contract’s exact error code).

---

## 2) Credits and metering (MVP)

### 2.1 What consumes credits
Credits are consumed on HTTP 200 responses only for:
- Search listings
- Search requests
- Expansion reads marked as metered

No credits are consumed on:
- 4xx/5xx responses
- idempotency replays that return a stored response (implementation may treat replay as no-op metering)

### 2.2 Base costs (fill in)
Define these constants for implementation (do not guess values in code):
- `CREDITS_SEARCH_LISTINGS_BASE = __`
- `CREDITS_SEARCH_REQUESTS_BASE = __`
- `CREDITS_EXPAND_NODE_LISTINGS_BASE = __`
- `CREDITS_EXPAND_NODE_REQUESTS_BASE = __`

### 2.3 Pagination and “broadening” costs (fill in)
If broadening is supported per spec, define:
- `CREDITS_BROADENING_LEVEL_1 = __`
- `CREDITS_BROADENING_LEVEL_2 = __`
- Pagination rules:
  - per-page credit cost (if any): `CREDITS_PER_PAGE = __`
  - max page size: `PAGE_SIZE_MAX = __`

### 2.4 Ledger requirements
Every credit charge must write a ledger entry containing at minimum:
- node_id
- action_type (enum)
- credits_delta (negative)
- request_id/correlation id
- created_at

---

## 3) Rate limits (MVP)

Rate limits protect availability and reduce abuse. Values are policy; do not guess in code.

Define per-route caps (fill in):
- `RL_SEARCH_PER_MIN = __`
- `RL_OFFERS_CREATE_PER_MIN = __`
- `RL_OFFERS_ACCEPT_PER_MIN = __`
- `RL_PUBLISH_PER_MIN = __`
- global cap: `RL_GLOBAL_PER_MIN = __`

Implementation guidance:
- Prefer token bucket / fixed window per node_id + route group.
- On exceed: return `429 rate_limited` with error envelope.

---

## 4) Plan tiers (MVP)

Plan tiers are a billing concern; the API needs only:
- is_subscriber boolean
- plan_id (string)
- credit_balance
- renewal/period timestamps (optional)

Define tiers (names and benefits) WITHOUT inventing pricing here unless you want this file to be authoritative.

### 4.1 Suggested tier shapes (fill in)
- **Free**
  - is_subscriber = false
  - can: create/manage/publish, reject offers, view own
  - cannot: search, create offers, counter, contact reveal

- **Basic**
  - is_subscriber = true
  - monthly credits: __
  - rate limits: __
  - access: subscriber-only endpoints

- **Pro**
  - is_subscriber = true
  - monthly credits: __
  - higher rate limits: __
  - access: subscriber-only endpoints

(If you only want one paid tier in MVP, keep just Basic.)

---

## 5) Credits top-ups (optional MVP)

If top-ups are enabled:
- endpoint(s): per `docs/specs/20__api-contracts.md`
- rules:
  - top-up increases credit_balance
  - ledger entry is written
  - anti-abuse (max top-ups per day) (fill in)

If top-ups are not enabled in MVP, state:
- “No top-ups in MVP; credits replenish only via subscription cycle.”

---

## 6) Referral credits (MVP)

If referrals are enabled:
- Claim endpoint: `POST /v1/referrals/claim`
- Awarding rules (fill in):
  - credits_awarded_to_referrer = __
  - credits_awarded_to_referred = __
  - eligibility constraints: __ (e.g., first-time only)
- Anti-abuse:
  - one-time per referred node
  - require subscriber status? (fill in; keep aligned to spec)

---

## 7) Implementation notes (what code must expose)

The backend should expose:
- `GET /v1/credits/balance`
- `GET /v1/credits/ledger`
- clear error codes for:
  - subscriber_required
  - credits_exhausted
  - rate_limited

---

## 8) Open decisions (must be set before launch)

Fill these before final implementation:
1. Credit costs (base, pagination, broadening)
2. Rate limits per route group
3. Tier definitions (number of tiers, monthly credits)
4. Referral award amounts + eligibility
5. Whether offer acceptance is subscriber-only (must match API contracts)
