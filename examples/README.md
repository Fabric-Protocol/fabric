# Examples

Runnable TypeScript examples for the in-repo SDK.

## Prerequisites
- Node.js 20+
- Dependencies installed at repo root (`npm install`)
- Fabric API running and reachable at `BASE_URL`

## Setup
1. Copy env template:

```bash
cp examples/.env.example examples/.env
```

2. Set required variables in `examples/.env`:
- `BASE_URL`
- `API_KEY` (required for `search-offer.ts`; `example:bootstrap` prints one you can paste back into `examples/.env`)

## Run
From repo root:

```bash
npm run example:bootstrap
```

Copy the printed `api_key` into `examples/.env` as `API_KEY=...`, then run:

```bash
npm run example:search
```

Notes:
- `example:bootstrap` bootstraps a new node, starts pubkey recovery, completes recovery, then calls `/v1/me`.
- `example:search` searches listings then creates an offer using the first result.
