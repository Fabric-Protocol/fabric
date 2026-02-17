# Enforcement Coverage Checklist (MVP)

Last updated: 2026-02-17

This checklist maps endpoint groups to required enforcement behavior from `10__invariants.md` and `20__api-contracts.md`.

## Coverage matrix

| Endpoint(s) | Auth | Subscriber gate | Credits meter | Rate limit rule | Primary non-2xx codes |
|---|---|---|---|---|---|
| `POST /v1/bootstrap` | None | No | No | `bootstrap` (per IP, hourly) | `422 validation_error`, `422 legal_required`, `422 legal_version_mismatch`, `409 idempotency_key_reuse_conflict`, `429 rate_limit_exceeded` |
| `POST /v1/search/listings` | ApiKey | Yes | Yes (200 only) | `search` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `402 credits_exhausted`, `422 validation_error`, `429 rate_limit_exceeded` |
| `POST /v1/search/requests` | ApiKey | Yes | Yes (200 only) | `search` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `402 credits_exhausted`, `422 validation_error`, `429 rate_limit_exceeded` |
| `GET /v1/public/nodes/:id/listings` | ApiKey | Yes | Yes (200 only) | `inventory_expand` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `402 credits_exhausted`, `429 rate_limit_exceeded` |
| `GET /v1/public/nodes/:id/requests` | ApiKey | Yes | Yes (200 only) | `inventory_expand` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `402 credits_exhausted`, `429 rate_limit_exceeded` |
| `POST /v1/offers` | ApiKey | Yes | No | `offer_write` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `409 conflict`, `422 validation_error`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/counter` | ApiKey | Yes | No | `offer_write` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `404 not_found`, `422 validation_error`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/accept` | ApiKey | Yes | No | `offer_decision` (per node, minutely) | `401 unauthorized`, `403 subscriber_required`, `404 not_found`, `409 invalid_state_transition`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/reject` | ApiKey | No (auth required) | No | `offer_decision` (per node, minutely) | `401 unauthorized`, `403 forbidden`, `404 not_found`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/cancel` | ApiKey | No (auth required) | No | `offer_decision` (per node, minutely) | `401 unauthorized`, `403 forbidden`, `404 not_found`, `429 rate_limit_exceeded` |
| `POST /v1/offers/:id/reveal-contact` | ApiKey | Preconditions require both subscribers | No | `reveal_contact` (per node, hourly) | `401 unauthorized`, `403 subscriber_required`, `409 offer_not_mutually_accepted`, `429 rate_limit_exceeded` |
| `POST /v1/auth/keys` | ApiKey | No | No | `auth_key_issue` (per node, daily) | `401 unauthorized`, `422 validation_error`, `429 rate_limit_exceeded` |

## Notes

- Subscriber-gated endpoints are subscription-only by design; credits do not bypass subscriber checks.
- Metered endpoints charge credits only on successful HTTP 200 responses.
- Rate limit values are configurable via environment variables and default to MVP baseline values in `src/config.ts`.
