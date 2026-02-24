# Plans, Credits, and Gating (MVP)

This document defines commercial and access-control behavior enforced by the API.
If this conflicts with `docs/specs/10__invariants.md` or `docs/specs/20__api-contracts.md`, those documents win.

## 0) Definitions
- Subscriber: Node with active paid subscription status.
- Trial-entitled: Node with an active upload trial entitlement window.
- Search-eligible node: ACTIVE, not-suspended node with sufficient credits.
- Credits: balance computed from `credit_ledger` deltas.
- Metered endpoint: decrements credits only on HTTP 200.
- Free node: node without active paid subscription.

## 1) Gating rules
### 1.1 Allowed for free and subscribed nodes
- Manage own private canonical resources (Units, Requests).
- Publish/unpublish own resources.
- View own resources and own offers.
- Reject inbound offers.

### 1.2 Credit-metered actions (ACTIVE, not-suspended + sufficient credits)
- `POST /v1/search/listings`
- `POST /v1/search/requests`
- `GET /v1/public/nodes/{node_id}/listings`
- `GET /v1/public/nodes/{node_id}/requests`
- `GET /v1/public/nodes/{node_id}/listings/categories/{category_id}`
- `GET /v1/public/nodes/{node_id}/requests/categories/{category_id}`

### 1.3 Legal-assent-gated offer lifecycle actions
- `POST /v1/offers`
- `POST /v1/offers/{offer_id}/counter`
- `POST /v1/offers/{offer_id}/accept`
- `POST /v1/offers/{offer_id}/cancel`
- `POST /v1/offers/{offer_id}/reveal-contact`

Rules:
- These endpoints are **not** subscriber-only.
- Caller must satisfy legal assent/version checks (`422 legal_required` when missing/outdated).
- Caller must pass auth/not-suspended checks and endpoint rate limits.

### 1.4 Offer rejection availability
- `POST /v1/offers/{offer_id}/reject` remains available to authenticated nodes (including non-subscribers).
- Reject remains authorization-gated by participation in the offer thread.

## 2) Credits and metering
### 2.1 Charging model
- Charge only on HTTP 200.
- Do not charge on 4xx/5xx.
- Do not double-charge idempotent replays.

### 2.2 Base costs
- `SEARCH_CREDIT_COST = 5`
- `SEARCH_TARGET_CREDIT_COST = 1` (target-constrained follow-up)
- Search listing/request call base (page 1): 5 credits.
- Target-constrained search (`target` resolves by `node_id`/`username`) uses the lower target base cost for page 1.
- Public node inventory expansion call base: 5 credits.
- Node per-category drilldown call base: cheap fixed cost (see 2.5).

### 2.3 Search budget ceiling (request-level)
- Search requests include `budget.credits_requested` (hard ceiling for that call).
- Response includes `budget.credits_charged` (must be `<= credits_requested`).
- If the ceiling prevents full execution (paging/broadening), return HTTP 200 with:
  - `budget.was_capped=true`
  - `budget.cap_reason="insufficient_budget"`
  - actionable `budget.guidance`

### 2.4 Broadening costs (search)
- Broadening is deprecated and optional.
- Broadening does not increase credit cost in MVP (`budget.breakdown.broadening_cost = 0`).

### 2.5 Pagination add-on economics (search)
- Page 1: included in base search cost (no page add-on).
- Page 2: +2 credits.
- Page 3: +3 credits.
- Page 4: +4 credits.
- Page 5: +5 credits.
- Pages 6+: +100 credits per page.
- Prohibitive pages are additionally protected via server-side detection/rate limiting (see 3).

Implementation note:
- The server surfaces `budget.breakdown.page_index` and `budget.breakdown.page_cost`.

### 2.6 Ledger behavior
- Search/expand writes negative entries (`debit_search`, `debit_search_page`).
- Deal finalization fee writes negative entries (`deal_accept_fee`).
- Grants write positive entries (`grant_signup`, `grant_trial`, `grant_milestone_requests`, `grant_subscription_monthly`, `grant_referral`, `topup_purchase`).
- Balance is authoritative `SUM(amount)` per node.

### 2.7 Offer mutual-acceptance fee
- When an offer transitions to `mutually_accepted`, charge `1` credit to each side.
- Finalization is blocked with `402 credits_exhausted` if either side lacks required credits.
- No partial finalize and no partial debit.

## 3) Rate limits (default env-backed values)
- Bootstrap: `3/hour`
- Search: `20/min`
- Search scrape guard (triggered by prohibitive paging or repeated broad queries): stricter than `search` (returns `429 rate_limit_exceeded`)
- Credits quote: `60/min`
- Inventory expand: `6/min`
- Node per-category drilldown: minutely per node (cheap + paginated + rate-limited)
- Offer create/counter: `30/min`
- Offer accept/reject/cancel: `60/min`
- Reveal contact: `10/hour`
- API key issuance: `10/day`

## 4) Plans (MVP)
- Free: 0 monthly credits, non-subscriber.
- Basic: 1,000 monthly credits.
- Pro: 3,000 monthly credits.
- Business: 10,000 monthly credits.

Implementation note:
- Internal storage remains `free|basic|pro|business`.

## 5) Credit Packs (enabled in MVP)
- Endpoint: `POST /v1/billing/topups/checkout-session`
- Packs:
  - `credits_500`: 500 credits, `$9.99` ("500 Credit Pack")
  - `credits_1500`: 1,500 credits, `$19.99` ("1500 Credit Pack")
  - `credits_4500`: 4,500 credits, `$49.99` ("4500 Credit Pack")
- Fulfillment:
  - Webhook grants `topup_purchase` on paid event with `metadata.topup_pack_code`.
  - Grant idempotency key uses payment reference (`payment_intent` / `invoice`).
- Anti-abuse:
  - `TOPUP_MAX_GRANTS_PER_DAY` (default `3`) enforced per node (UTC day).
  - Over-limit events are acknowledged (`200`) but grant is skipped.

## 6) Referrals
- Claim endpoint: `POST /v1/referrals/claim`
- Award trigger: first paid subscription invoice.
- Current grant: 100 credits to referrer.
- Cap: at most 50 referral grants per referrer.
- One claim per referred node.

## 6b) Upload trial bridge
- Trigger: first time a node reaches `UPLOAD_TRIAL_THRESHOLD` Unit creates (default `20`).
- Grant (one-time): active trial entitlement for `UPLOAD_TRIAL_DURATION_DAYS` (default `7`) plus `UPLOAD_TRIAL_CREDIT_GRANT` credits (default `200`).
- Idempotency/audit:
  - Entitlement is unique per node.
  - Credit grant is written once as `grant_trial`.
  - Trial grant is recorded in trial entitlement event audit.

## 6c) Request milestone bridge
- Trigger: first time a node reaches `REQUEST_MILESTONE_THRESHOLD` Request creates (default `20`).
- Grant (one-time): `REQUEST_MILESTONE_CREDIT_GRANT` credits (default `200`) as `grant_milestone_requests`.
- Idempotency/audit:
  - Credit grant is one-time per node/threshold.

## 7) Credits quote endpoints
- `GET /v1/credits/quote`: returns catalog (search quote model, packs, plans).
- `POST /v1/credits/quote`: search-shaped request returns estimated cost without executing search.
- Quote endpoints do not mutate ledger.

## 8) Plan-change semantics (MVP)
- Upgrade invoice paid: grant difference-based credits for the cycle (idempotent by invoice id).
- Downgrade: effective at next renewal (no immediate clawback).
