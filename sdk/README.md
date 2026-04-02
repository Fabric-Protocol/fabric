# Fabric SDK (TypeScript)

Minimal TypeScript client for the hosted Fabric API.

## What it includes
- Typed `FabricClient` with canonical auth header:
  - `Authorization: ApiKey <api_key>`
- Automatic `Idempotency-Key` for non-GET requests (overrideable)
- Canonical error-envelope parsing into typed errors
- Core methods:
  - `me()` -> `GET /v1/me`
  - `getEvents()` -> `GET /v1/events`
  - `watchEvents()` -> polling helper for `GET /v1/events`
  - `searchListings()` -> `POST /v1/search/listings`
  - `createOffer()` -> `POST /v1/offers` (unit-targeted or request-targeted)
- Recovery helpers:
  - `recoveryStart()` -> `POST /v1/recovery/start`
  - `recoveryComplete()` -> `POST /v1/recovery/complete`
  - `buildRecoveryMessage(challengeId, nonce)` -> `fabric-recovery:<challenge_id>:<nonce>`
  - `signRecoveryMessage(message, privateKey, encoding)`
- Webhook helper:
  - `verifyWebhookSignature()` -> verify `X-Fabric-Timestamp` + `X-Fabric-Signature`

## Verify

From `sdk/`:

```bash
npm install
npm run typecheck
npm test
```

## Basic usage

```ts
import { FabricClient } from '@fabric-protocol/sdk';

const client = new FabricClient({
  baseUrl: 'https://fabric-api-393345198409.us-west1.run.app',
  apiKey: process.env.FABRIC_API_KEY!,
});

const me = await client.me();
```

## Events and notifications
- Production/server agents should still prefer `event_webhook_url` for push delivery.
- `watchEvents()` is the fallback for runtimes that cannot receive webhooks, and it is also useful as a startup reconciliation loop.
- Polling is at-least-once. The helper stores `next_cursor`, deduplicates by `event.id`, and backs off on empty/error responses.

Polling example:

```ts
import { FabricClient, type FabricEvent } from '@fabric-protocol/sdk';

const client = new FabricClient({
  baseUrl: 'https://fabric-api-393345198409.us-west1.run.app',
  apiKey: process.env.FABRIC_API_KEY!,
});

const onEvent = async (event: FabricEvent) => {
  console.log(event.type, event.offer_id);
};

let cursor: string | null = null;

await client.watchEvents({
  onEvent,
  cursorStore: {
    load: async () => cursor,
    save: async (nextCursor) => {
      cursor = nextCursor;
    },
  },
});
```

Webhook verification example using the same `onEvent` callback:

```ts
import { verifyWebhookSignature, type FabricEvent } from '@fabric-protocol/sdk';

const rawBody = await readRawBody(req);
const verification = verifyWebhookSignature(rawBody, req.headers, process.env.FABRIC_WEBHOOK_SECRET!);
if (!verification.ok) {
  res.statusCode = 400;
  res.end(verification.reason);
  return;
}

const event = JSON.parse(Buffer.from(rawBody).toString('utf8')) as FabricEvent;
await onEvent(event);
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
import { FabricError } from '@fabric-protocol/sdk';

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
- `getEvents`
- `watchEvents`
- `searchListings`
- `createOffer`
- `recoveryStart`
- `recoveryComplete`
- `verifyWebhookSignature`
