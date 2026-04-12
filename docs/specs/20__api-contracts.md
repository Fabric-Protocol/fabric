# Fabric Public API Contracts

This document summarizes the public API surface for external integrators.

For exact machine-readable schemas, use:
- `GET /openapi.json`
- `GET /v1/meta`

This public guide intentionally excludes internal and administrative surfaces.

## Public endpoint groups

### Discovery
- `GET /v1/meta`
- `GET /v1/categories`
- `GET /v1/regions`
- `GET /openapi.json`
- public legal/support/docs pages served by the running instance

### Identity and auth lifecycle
- `POST /v1/bootstrap`
- `GET /v1/me`
- `PATCH /v1/me`
- `POST /v1/auth/keys`
- `GET /v1/auth/keys`
- `DELETE /v1/auth/keys/{key_id}`
- `POST /v1/recovery/start`
- `POST /v1/recovery/complete`

### Credits and billing
- `GET /v1/credits/balance`
- `GET /v1/credits/ledger`
- `GET /v1/credits/quote`
- `POST /v1/credits/quote`
- `POST /v1/billing/checkout-session`
- `POST /v1/billing/credit-packs/checkout-session`
- `POST /v1/billing/crypto-credit-pack`
- `GET /v1/billing/crypto-currencies`
- public purchase and subscription outcomes are reflected through normal account and credits reads

### Inventory
- `POST /v1/units`
- `GET /v1/units`
- `GET /v1/units/{unit_id}`
- `PATCH /v1/units/{unit_id}`
- `DELETE /v1/units/{unit_id}`
- `POST /v1/units/{unit_id}/publish`
- `POST /v1/units/{unit_id}/unpublish`
- matching request endpoints under `/v1/requests`

### Search and public discovery
- `POST /v1/search/listings`
- `POST /v1/search/requests`
- `GET /v1/public/nodes/{node_id}/listings`
- `GET /v1/public/nodes/{node_id}/requests`
- category drilldown endpoints for public node inventory
- `POST /v1/public/nodes/categories-summary`

### Offers and events
- `POST /v1/offers`
- `GET /v1/offers`
- `GET /v1/offers/{offer_id}`
- `POST /v1/offers/{offer_id}/counter`
- `POST /v1/offers/{offer_id}/accept`
- `POST /v1/offers/{offer_id}/reject`
- `POST /v1/offers/{offer_id}/cancel`
- `POST /v1/offers/{offer_id}/reveal-contact`
- `POST /v1/offers/{offer_id}/report`
- `GET /v1/events`

### Referrals
- `POST /v1/referrals/claim`
- `GET /v1/me/referral-code`
- `GET /v1/me/referral-stats`

## Public contract rules

### Authentication

Most authenticated endpoints use:

```http
Authorization: ApiKey <api_key>
```

Session auth is also supported where advertised:

```http
Authorization: Session <session_token>
```

### Idempotency

All non-GET endpoints except webhooks require `Idempotency-Key`.

### Error handling

All non-2xx responses use the standard Fabric error envelope.

### Metering

Metered operations charge only on HTTP 200.

### Concurrency

PATCH endpoints that use optimistic concurrency require `If-Match`.

## Public guidance for exact shapes

This document is intentionally concise.

Use the runtime OpenAPI spec for:
- exact request bodies
- exact response bodies
- exact field-level validation
- exact current enum values exposed by the running service
