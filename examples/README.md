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
- `SEARCH_TARGET_NODE_ID` (use the seeded seller node ID printed by `example:bootstrap` for deterministic search results)

## Run
From repo root:

```bash
npm run example:bootstrap
```

Copy the printed `api_key` into `examples/.env` as `API_KEY=...` and the printed `search_target_node_id` as `SEARCH_TARGET_NODE_ID=...`. `example:bootstrap` also seeds one published listing with `SEARCH_SCOPE_NOTES=sdk-example-scope`, so you can keep the default scope notes unless you intentionally change both scripts.

Then run:

```bash
npm run example:search
```

Notes:
- `example:bootstrap` bootstraps a buyer node, starts pubkey recovery, completes recovery, calls `/v1/me`, then bootstraps a second seller node and publishes one seeded listing for the search walkthrough.
- `example:search` searches listings and creates an offer using the first result. It exits non-zero if your env does not point at a matching published listing from another node.
- If you rerun `example:search` after a successful offer creation, rerun `example:bootstrap` first to seed a fresh listing. The previously seeded listing may already be tied up in an offer hold.
