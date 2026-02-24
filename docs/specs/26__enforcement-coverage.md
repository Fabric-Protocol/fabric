# Enforcement Coverage Checklist (MVP)

Last updated: 2026-02-19

This checklist maps endpoint groups to required enforcement behavior from `10__invariants.md` and `20__api-contracts.md`.

## Coverage matrix

| Endpoint(s) | Auth | Gate | Credits meter | Rate limit rule | Primary non-2xx codes |
|---|---|---|---|---|---|
| `POST /v1/bootstrap` | None | No | No | `bootstrap` (per IP, hourly) | `422 validation_error`, `422 legal_required`, `422 legal_version_mismatch`, `409 idempotency_key_reuse_conflict`, `429 rate_limit_exceeded` |
| `POST /v1/email/start-verify` | ApiKey | No | No | `email_verify_start` (per node, hourly) | `401 unauthorized`, `422 validation_error`, `503 email_delivery_failed`, `429 rate_limit_exceeded` |
| `POST /v1/email/complete-verify` | ApiKey | No | No | challenge attempt bound | `401 unauthorized`, `422 validation_error`, `404 not_found`, `429 rate_limit_exceeded` |
| `POST /v1/recovery/start` | None | No | No | `recovery_start_ip` (per IP, hourly) + `recovery_start_node` (per node, hourly) | `422 validation_error`, `404 not_found`, `429 rate_limit_exceeded` |
| `POST /v1/recovery/complete` | None | Challenge validity required | No | challenge attempt bound | `422 validation_error`, `404 not_found`, `409 invalid_state_transition`, `429 rate_limit_exceeded` |
| `POST /v1/search/listings` | ApiKey | Credits required; pre-purchase daily limit (3/day combined) | Yes (200 only) | `search` (per node, minutely) + `search_scrape_guard` (triggered) | `401 unauthorized`, `402 credits_exhausted`, `422 validation_error`, `429 rate_limit_exceeded`, `429 prepurchase_daily_limit_exceeded` |
| `POST /v1/search/requests` | ApiKey | Credits required; pre-purchase daily limit (3/day combined) | Yes (200 only) | `search` (per node, minutely) + `search_scrape_guard` (triggered) | `401 unauthorized`, `402 credits_exhausted`, `422 validation_error`, `429 rate_limit_exceeded`, `429 prepurchase_daily_limit_exceeded` |
| `GET /v1/public/nodes/:id/listings` | ApiKey | Credits required | Yes (200 only) | `inventory_expand` (per node, minutely) | `401 unauthorized`, `402 credits_exhausted`, `429 rate_limit_exceeded` |
| `GET /v1/public/nodes/:id/requests` | ApiKey | Credits required | Yes (200 only) | `inventory_expand` (per node, minutely) | `401 unauthorized`, `402 credits_exhausted`, `429 rate_limit_exceeded` |
| `GET /v1/public/nodes/:id/listings/categories/:category_id` | ApiKey | Credits required | Yes (200 only) | `node_category_drilldown` (per node, minutely) | `401 unauthorized`, `402 credits_exhausted`, `422 validation_error`, `429 rate_limit_exceeded` |
| `GET /v1/public/nodes/:id/requests/categories/:category_id` | ApiKey | Credits required | Yes (200 only) | `node_category_drilldown` (per node, minutely) | `401 unauthorized`, `402 credits_exhausted`, `422 validation_error`, `429 rate_limit_exceeded` |
| `GET /v1/units` | ApiKey | No | No | (default read) | `401 unauthorized` |
| `GET /v1/units/:id` | ApiKey | No | No | (default read) | `401 unauthorized`, `404 not_found`, `403 forbidden` |
| `GET /v1/requests` | ApiKey | No | No | (default read) | `401 unauthorized` |
| `GET /v1/requests/:id` | ApiKey | No | No | (default read) | `401 unauthorized`, `404 not_found`, `403 forbidden` |
| `POST /v1/offers` | ApiKey | Legal assent required; pre-purchase daily limit (3 creates/day) | No | `offer_write` (per node, minutely) | `401 unauthorized`, `409 conflict`, `422 validation_error`, `422 legal_required`, `429 rate_limit_exceeded`, `429 prepurchase_daily_limit_exceeded` |
| `POST /v1/offers/:id/counter` | ApiKey | Legal assent required; pre-purchase daily limit (3 creates/day) | No | `offer_write` (per node, minutely) | `401 unauthorized`, `404 not_found`, `422 validation_error`, `422 legal_required`, `429 rate_limit_exceeded`, `429 prepurchase_daily_limit_exceeded` |
| `POST /v1/offers/:id/accept` | ApiKey | Legal assent required; pre-purchase daily limit (1 accept/day) | No | `offer_decision` (per node, minutely) | `401 unauthorized`, `403 forbidden`, `404 not_found`, `409 invalid_state_transition`, `422 legal_required`, `429 rate_limit_exceeded`, `429 prepurchase_daily_limit_exceeded` |
| `POST /v1/offers/:id/reject` | ApiKey | No (auth required) | No | `offer_decision` (per node, minutely) | `401 unauthorized`, `403 forbidden`, `404 not_found`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/cancel` | ApiKey | Legal assent required (not subscriber-only) | No | `offer_decision` (per node, minutely) | `401 unauthorized`, `403 forbidden`, `404 not_found`, `422 legal_required`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/reveal-contact` | ApiKey | Legal assent + mutual acceptance preconditions (not subscriber-only) | No | `reveal_contact` (per node, hourly) | `401 unauthorized`, `403 forbidden`, `409 offer_not_mutually_accepted`, `422 legal_required`, `429 rate_limit_exceeded` |
| `GET /v1/events` | ApiKey | No | No | (default read) | `401 unauthorized`, `422 validation_error` |
| `GET /internal/admin/daily-metrics` | Admin key | Admin only | No | (default read) | `401 unauthorized` |
| `POST /v1/auth/keys` | ApiKey | No | No | `auth_key_issue` (per node, daily) | `401 unauthorized`, `422 validation_error`, `429 rate_limit_exceeded` |

## Notes
- No subscriber gate: credits are sufficient for search/inventory access. Pre-purchase daily limits (3 searches/day, 3 offer creates/day, 1 offer accept/day) apply until the node has ever purchased (subscription or credit pack).
- Offer lifecycle endpoints require legal assent + auth + rate limits (not subscriber-gated).
- Metered endpoints charge credits only on successful HTTP 200 responses.
- Search includes request-level spend ceiling via `budget.credits_requested`; when capped, response is HTTP 200 with `budget.was_capped=true` and actionable guidance.
- `POST /v1/public/nodes/categories-summary` is a zero-cost read aggregation (no credits charged).
- The `search_scrape_guard` rule is triggered by prohibitive paging (page 6+) and/or repeated broad queries.
- Recovery policy in MVP is pubkey-only; `method=email` requests are rejected as `422 validation_error` (`email_recovery_not_supported`).
- Private detail reads (`GET /v1/units/:id`, `GET /v1/requests/:id`) remain non-metered but now emit `detail_view` visibility events (persisted).
