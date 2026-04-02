# Examples

Runnable TypeScript examples using the Fabric SDK.

## Prerequisites
- Node.js 20+
- An explicit Fabric target instance selected via `BASE_URL` or `MCP_URL`

## Setup

1. Install dependencies:
```bash
npm --prefix sdk install
```

2. Set environment variables:
```bash
export BASE_URL="http://localhost:8080"
export MCP_URL="http://localhost:8080/mcp"
export API_KEY="<your_api_key>"
```

These examples are intentionally target-explicit. They do not default to production.

## Run

```bash
npx --yes tsx examples/bootstrap-recovery-me.ts
npx --yes tsx examples/search-offer.ts
node examples/mcp-smoke.mjs
```

- `bootstrap-recovery-me.ts` - bootstraps a new node, starts pubkey recovery, completes recovery, then calls `/v1/me`.
- `search-offer.ts` - searches listings then creates an offer using the first result. Requires `API_KEY`.
- `mcp-smoke.mjs` - minimal MCP smoke test: tools/list, bootstrap, session login, current profile, inventory, and offers snapshot through the published wrapper tools.

`mcp-smoke.mjs` uses `MCP_URL` if set, otherwise defaults to:
No default. Set `MCP_URL` explicitly before running it.
