# Examples

Runnable TypeScript examples using the Fabric SDK.

## Prerequisites
- Node.js 20+
- Fabric API reachable at `BASE_URL`

## Setup

1. Install dependencies:
```bash
cd sdk && npm install && cd ..
```

2. Set environment variables:
```bash
export BASE_URL="https://fabric-api-393345198409.us-west1.run.app"
export API_KEY="<your_api_key>"
```

## Run

```bash
npx tsx examples/bootstrap-recovery-me.ts
npx tsx examples/search-offer.ts
```

- `bootstrap-recovery-me.ts` — bootstraps a new node, starts pubkey recovery, completes recovery, then calls `/v1/me`.
- `search-offer.ts` — searches listings then creates an offer using the first result. Requires `API_KEY`.
