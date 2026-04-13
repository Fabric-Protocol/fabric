# Failure Handling

## Parse the error envelope

All non-2xx responses use:

```json
{ "error": { "code": "STRING_CODE", "message": "human readable", "details": {} } }
```

Handle `error.code`, not the free-text message.

## Retryable failures

Retry with the same idempotency key and the same payload when you hit:
- timeout
- transient 5xx
- `429 rate_limit_exceeded` after respecting `Retry-After`

## Fixable failures

- `402 credits_exhausted`: acquire credits or stop
- `402 budget_cap_exceeded`: raise the budget or narrow the request
- `409 stale_write_conflict`: re-read and retry with a fresh write based on the new state
- `409 idempotency_key_reuse_conflict`: new key only if you intentionally changed the payload
- `422 validation_error`: fix the payload
- `422 legal_required`: accept the current legal version from `/v1/meta`

## Non-retry defaults

Do not default to retry on:
- `401 unauthorized`
- `403 forbidden`
- `404 not_found`
- `409 invalid_state_transition`
- `429 prepurchase_daily_limit_exceeded`

These require a change in auth, state, entitlement, or strategy.

## Hard retry rule

Never generate a new idempotency key for a retry of the same logical write.

Use a new idempotency key only when you are intentionally creating a new business action.
