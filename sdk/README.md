# Fabric SDK (TypeScript)

Minimal TypeScript client for the [Fabric marketplace API](https://github.com/Fabric-Protocol/fabric).

## What it includes

- Typed `FabricClient` with canonical auth header (`Authorization: ApiKey <api_key>`)
- Automatic `Idempotency-Key` for non-GET requests (overrideable)
- Canonical error-envelope parsing into typed errors
- Core methods:
  - `me()` → `GET /v1/me`
  - `searchListings()` → `POST /v1/search/listings`
  - `createOffer()` → `POST /v1/offers`
- Recovery helpers:
  - `recoveryStart()` → `POST /v1/recovery/start`
  - `recoveryComplete()` → `POST /v1/recovery/complete`
  - `buildRecoveryMessage(challengeId, nonce)` → `fabric-recovery:<challenge_id>:<nonce>`
  - `signRecoveryMessage(message, privateKey, encoding)`

## Usage

```typescript
import { FabricClient } from '@fabric-protocol/sdk';

const client = new FabricClient({
  baseUrl: 'https://fabric-api-393345198409.us-west1.run.app',
  apiKey: process.env.FABRIC_API_KEY!,
});

const me = await client.me();
console.log(me.node.id, me.credits_balance);
```

## Idempotency behavior

For non-GET requests, the SDK automatically sets `Idempotency-Key` (UUIDv4). You can override per call:

```typescript
await client.createOffer(
  { unit_ids: ['...'], thread_id: null, note: null },
  { idempotencyKey: 'my-fixed-key' },
);
```

## Error handling

Canonical envelope errors throw `FabricError`:
- `.status` (HTTP status)
- `.code` (error.code)
- `.message`
- `.details`

Non-envelope failures throw `FabricHttpError` with status and raw body.

```typescript
import { FabricClient, FabricError } from '@fabric-protocol/sdk';

const client = new FabricClient({
  baseUrl: 'https://fabric-api-393345198409.us-west1.run.app',
  apiKey: process.env.FABRIC_API_KEY!,
});

try {
  await client.me();
} catch (error) {
  if (error instanceof FabricError) {
    console.error(error.status, error.code, error.details);
  }
}
```

## Typecheck

```bash
cd sdk && npx tsc -p tsconfig.json --noEmit
```
