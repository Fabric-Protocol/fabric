# Fabric SDK (in-repo, TypeScript)

This is a minimal in-repo SDK under `/sdk`. It is not published to npm yet.

## What it includes
- Typed `FabricClient` with canonical auth header:
  - `Authorization: ApiKey <api_key>`
- Automatic `Idempotency-Key` for non-GET requests (overrideable)
- Canonical error-envelope parsing into typed errors
- Core methods:
  - `me()` -> `GET /v1/me`
  - `searchListings()` -> `POST /v1/search/listings`
  - `createOffer()` -> `POST /v1/offers` (unit-targeted or request-targeted)
- Recovery helpers:
  - `recoveryStart()` -> `POST /v1/recovery/start`
  - `recoveryComplete()` -> `POST /v1/recovery/complete`
  - `buildRecoveryMessage(challengeId, nonce)` -> `fabric-recovery:<challenge_id>:<nonce>`
  - `signRecoveryMessage(message, privateKey, encoding)`

## Typecheck
From repo root:

```bash
npm run sdk:typecheck
```

## Basic usage

```ts
import { FabricClient } from '../sdk/src/index.ts';

const client = new FabricClient({
  baseUrl: 'http://localhost:3000',
  apiKey: process.env.API_KEY!,
});

const me = await client.me();
```

## Idempotency behavior
- For non-GET requests, the SDK automatically sets `Idempotency-Key` (UUIDv4).
- You can override per call:

```ts
await client.createOffer(
  { unit_ids: ['...'], thread_id: null, note: null },
  { idempotencyKey: 'my-fixed-key' },
);
```

Request-targeted offer example:

```ts
await client.createOffer(
  { request_id: '...', note: 'I can fulfill this request for $25.', unit_ids: ['optional-owned-unit-id'] },
  { idempotencyKey: 'my-fixed-key-2' },
);
```

## Error handling
- Canonical envelope errors throw `FabricError`:
  - `.status` (HTTP status)
  - `.code` (error.code)
  - `.message`
  - `.details`
- Non-envelope failures throw `FabricHttpError` with status and raw body.

```ts
import { FabricError } from '../sdk/src/index.ts';

try {
  await client.me();
} catch (error) {
  if (error instanceof FabricError) {
    console.error(error.status, error.code, error.details);
  }
}
```

## Supported methods in this iteration
- `me`
- `searchListings`
- `createOffer`
- `recoveryStart`
- `recoveryComplete`
