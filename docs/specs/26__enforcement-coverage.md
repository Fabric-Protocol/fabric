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
| `POST /v1/search/listings` | ApiKey | Entitled spender (`active subscription` OR `active trial`) | Yes (200 only) | `search` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `402 credits_exhausted`, `422 validation_error`, `429 rate_limit_exceeded` |
| `POST /v1/search/requests` | ApiKey | Entitled spender (`active subscription` OR `active trial`) | Yes (200 only) | `search` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `402 credits_exhausted`, `422 validation_error`, `429 rate_limit_exceeded` |
| `GET /v1/public/nodes/:id/listings` | ApiKey | Entitled spender (`active subscription` OR `active trial`) | Yes (200 only) | `inventory_expand` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `402 credits_exhausted`, `429 rate_limit_exceeded` |
| `GET /v1/public/nodes/:id/requests` | ApiKey | Entitled spender (`active subscription` OR `active trial`) | Yes (200 only) | `inventory_expand` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `402 credits_exhausted`, `429 rate_limit_exceeded` |
| `POST /v1/offers` | ApiKey | Yes | No | `offer_write` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `409 conflict`, `422 validation_error`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/counter` | ApiKey | Yes | No | `offer_write` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `404 not_found`, `422 validation_error`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/accept` | ApiKey | Yes | No | `offer_decision` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `404 not_found`, `409 invalid_state_transition`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/reject` | ApiKey | No (auth required) | No | `offer_decision` (per node, minutely) | `401 unauthorized`, `403 forbidden`, `404 not_found`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/cancel` | ApiKey | No (auth required) | No | `offer_decision` (per node, minutely) | `401 unauthorized`, `403 forbidden`, `404 not_found`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/reveal-contact` | ApiKey | Preconditions require both subscribers | No | `reveal_contact` (per node, hourly) | `401 unauthorized`, `403 subscriber_required`, `409 offer_not_mutually_accepted`, `429 rate_limit_exceeded` |
| `POST /v1/auth/keys` | ApiKey | No | No | `auth_key_issue` (per node, daily) | `401 unauthorized`, `422 validation_error`, `429 rate_limit_exceeded` |

## Notes

- Spend-gated endpoints require active subscription or active trial; credits alone do not bypass gating.
- Revoked API keys return `403 forbidden` (distinct from missing/invalid key `401 unauthorized`).
- Successful `/v1/recovery/complete` revokes all prior active keys and returns one new plaintext API key.
- Metered endpoints charge credits only on successful HTTP 200 responses.
- Rate limit values are configurable via environment variables and default to MVP baseline values in `src/config.ts`.
