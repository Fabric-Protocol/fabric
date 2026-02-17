# Plans, Credits, and Gating (MVP)

This document defines commercial and access-control behavior enforced by the API.
If this conflicts with `docs/specs/10__invariants.md` or `docs/specs/20__api-contracts.md`, those documents win.

## 0) Definitions
- Subscriber: Node with active paid subscription status.
- Credits: balance computed from `credit_ledger` deltas.
- Metered endpoint: decrements credits only on HTTP 200.
- Free node: node without active paid subscription.

## 1) Gating rules
### 1.1 Allowed for free and subscribed nodes
- Manage own private canonical resources (Units, Requests).
- Publish/unpublish own resources.
- View own resources and own offers.
- Reject inbound offers.

### 1.2 Subscriber-only actions
- `POST /v1/search/listings`
- `POST /v1/search/requests`
- `GET /v1/public/nodes/{node_id}/listings`
- `GET /v1/public/nodes/{node_id}/requests`
- `POST /v1/offers`
- `POST /v1/offers/{offer_id}/counter`
- `POST /v1/offers/{offer_id}/accept`
- `POST /v1/offers/{offer_id}/reveal-contact`

### 1.3 Two-sided subscriber requirement
- Contact reveal requires both offer parties to be subscribers.
- If either side is non-subscriber, return `403 subscriber_required`.

## 2) Credits and metering
### 2.1 Charging model
- Charge only on HTTP 200.
- Do not charge on 4xx/5xx.
- Do not double-charge idempotent replays.

### 2.2 Base costs
- `SEARCH_CREDIT_COST = 2`
- Search listing/request call base: 2 credits.
- Public node inventory expansion call base: 2 credits.

### 2.3 Broadening costs
- Broadening add-on cost equals requested level.
- Formula: `estimated_cost = SEARCH_CREDIT_COST + broadening.level`

### 2.4 Ledger behavior
- Search/expand writes negative entries (`debit_search`, `debit_search_page`).
- Grants write positive entries (`grant_signup`, `grant_subscription_monthly`, `grant_referral`, `topup_purchase`).
- Balance is authoritative `SUM(amount)` per node.

## 3) Rate limits (default env-backed values)
- Bootstrap: `3/hour`
- Search: `20/min`
- Credits quote: `60/min`
- Inventory expand: `6/min`
- Offer create/counter: `30/min`
- Offer accept/reject/cancel: `60/min`
- Reveal contact: `10/hour`
- API key issuance: `10/day`

## 4) Plans (MVP)
- Free: 0 monthly credits, non-subscriber.
- Basic: 500 monthly credits.
- Pro/Plus: 1,500 monthly credits.
- Business: 5,000 monthly credits.

Implementation note:
- Internal storage remains `free|basic|pro|business`.
- API responses may present `plus` when Stripe plus mapping is configured.

## 5) Credit top-ups (enabled in MVP)
- Endpoint: `POST /v1/billing/topups/checkout-session`
- Packs:
  - `credits_100`: 100 credits, `$4.00`
  - `credits_300`: 300 credits, `$12.00`
  - `credits_1000`: 1,000 credits, `$38.00`
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
- One claim per referred node.

## 7) Credits quote endpoints
- `GET /v1/credits/quote`: returns catalog (search quote model, packs, plans).
- `POST /v1/credits/quote`: search-shaped request returns estimated cost without executing search.
- Quote endpoints do not mutate ledger.

## 8) Plan-change semantics (MVP)
- Upgrade invoice paid: grant difference-based credits for the cycle (idempotent by invoice id).
- Downgrade: effective at next renewal (no immediate clawback).
