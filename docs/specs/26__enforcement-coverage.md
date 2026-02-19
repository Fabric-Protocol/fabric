# Enforcement Coverage Checklist (MVP)

Last updated: 2026-02-18

This checklist maps endpoint groups to required enforcement behavior from `10__invariants.md` and `20__api-contracts.md`.

## Coverage matrix

| Endpoint(s) | Auth | Gate | Credits meter | Rate limit rule | Primary non-2xx codes |
|---|---|---|---|---|---|
| `POST /v1/bootstrap` | None | No | No | `bootstrap` (per IP, hourly) | `422 validation_error`, `422 legal_required`, `422 legal_version_mismatch`, `409 idempotency_key_reuse_conflict`, `429 rate_limit_exceeded` |
| `POST /v1/email/start-verify` | ApiKey | No | No | `email_verify_start` (per node, hourly) | `401 unauthorized`, `422 validation_error`, `503 email_delivery_failed`, `429 rate_limit_exceeded` |
| `POST /v1/email/complete-verify` | ApiKey | No | No | challenge attempt bound | `401 unauthorized`, `422 validation_error`, `404 not_found`, `429 rate_limit_exceeded` |
| `POST /v1/recovery/start` | None | No | No | `recovery_start_ip` (per IP, hourly) + `recovery_start_node` (per node, hourly) | `422 validation_error`, `404 not_found`, `429 rate_limit_exceeded`, `503 email_delivery_failed` |
| `POST /v1/recovery/complete` | None | Challenge validity required | No | challenge attempt bound | `422 validation_error`, `404 not_found`, `409 invalid_state_transition`, `429 rate_limit_exceeded` |
| `POST /v1/search/listings` | ApiKey | Entitled spender (`active subscription` OR `active trial`) | Yes (200 only) | `search` (per node, minutely) + `search_scrape_guard` (triggered) | `401 unauthorized`, `403 subscriber_required`, `402 credits_exhausted`, `422 validation_error`, `429 rate_limit_exceeded` |
| `POST /v1/search/requests` | ApiKey | Entitled spender (`active subscription` OR `active trial`) | Yes (200 only) | `search` (per node, minutely) + `search_scrape_guard` (triggered) | `401 unauthorized`, `403 subscriber_required`, `402 credits_exhausted`, `422 validation_error`, `429 rate_limit_exceeded` |
| `GET /v1/public/nodes/:id/listings` | ApiKey | Entitled spender (`active subscription` OR `active trial`) | Yes (200 only) | `inventory_expand` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `402 credits_exhausted`, `429 rate_limit_exceeded` |
| `GET /v1/public/nodes/:id/requests` | ApiKey | Entitled spender (`active subscription` OR `active trial`) | Yes (200 only) | `inventory_expand` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `402 credits_exhausted`, `429 rate_limit_exceeded` |
| `GET /v1/public/nodes/:id/listings/categories/:category_id` | ApiKey | Entitled spender (`active subscription` OR `active trial`) | Yes (200 only) | `node_category_drilldown` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `402 credits_exhausted`, `422 validation_error`, `429 rate_limit_exceeded` |
| `GET /v1/public/nodes/:id/requests/categories/:category_id` | ApiKey | Entitled spender (`active subscription` OR `active trial`) | Yes (200 only) | `node_category_drilldown` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `402 credits_exhausted`, `422 validation_error`, `429 rate_limit_exceeded` |
| `GET /v1/units` | ApiKey | No | No | (default read) | `401 unauthorized` |
| `GET /v1/units/:id` | ApiKey | No | No | (default read) | `401 unauthorized`, `404 not_found`, `403 forbidden` |
| `GET /v1/requests` | ApiKey | No | No | (default read) | `401 unauthorized` |
| `GET /v1/requests/:id` | ApiKey | No | No | (default read) | `401 unauthorized`, `404 not_found`, `403 forbidden` |
| `POST /v1/offers` | ApiKey | Yes | No | `offer_write` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `409 conflict`, `422 validation_error`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/counter` | ApiKey | Yes | No | `offer_write` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `404 not_found`, `422 validation_error`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/accept` | ApiKey | Yes | No | `offer_decision` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `404 not_found`, `409 invalid_state_transition`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/reject` | ApiKey | No (auth required) | No | `offer_decision` (per node, minutely) | `401 unauthorized`, `403 forbidden`, `404 not_found`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/cancel` | ApiKey | No (auth required) | No | `offer_decision` (per node, minutely) | `401 unauthorized`, `403 forbidden`, `404 not_found`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/reveal-contact` | ApiKey | Preconditions require both subscribers | No | `reveal_contact` (per node, hourly) | `401 unauthorized`, `403 subscriber_required`, `409 offer_not_mutually_accepted`, `429 rate_limit_exceeded` |
| `POST /v1/auth/keys` | ApiKey | No | No | `auth_key_issue` (per node, daily) | `401 unauthorized`, `422 validation_error`, `429 rate_limit_exceeded` |

## Notes
- Spend-gated endpoints require active subscription or active trial; credits alone do not bypass gating.
- Metered endpoints charge credits only on successful HTTP 200 responses.
- Search includes request-level spend ceiling via `budget.credits_requested`; when capped, response is HTTP 200 with `budget.was_capped=true` and actionable guidance.
- The `search_scrape_guard` rule is triggered by prohibitive paging (page 6+) and/or repeated broad queries.
- Private detail reads (`GET /v1/units/:id`, `GET /v1/requests/:id`) remain non-metered but now emit `detail_view` visibility events (persisted).
