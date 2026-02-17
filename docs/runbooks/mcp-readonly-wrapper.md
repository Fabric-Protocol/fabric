# MCP Read-Only Wrapper (Fabric API)

## Purpose
Expose a minimal MCP server that proxies to existing Fabric REST endpoints without mutating server state outside normal endpoint semantics.

## Script
- Source: `scripts/mcp-readonly-server.ts`
- Run: `npm run mcp:readonly`

## Required environment
- `FABRIC_API_BASE_URL` (default: `http://localhost:8080`)
- `FABRIC_API_KEY` (required for authenticated tools)
- `FABRIC_MCP_TIMEOUT_MS` (optional; default `15000`)

Example:
```bash
export FABRIC_API_BASE_URL="https://fabric-api.example.com"
export FABRIC_API_KEY="<node_api_key>"
npm run mcp:readonly
```

## Exposed MCP tools
- `fabric_get_me`
  - Calls `GET /v1/me`
- `fabric_search_listings`
  - Calls `POST /v1/search/listings`
- `fabric_search_requests`
  - Calls `POST /v1/search/requests`
- `fabric_list_public_node_inventory`
  - Calls `GET /v1/public/nodes/{node_id}/listings|requests`

## Auth guidance
- The wrapper forwards `Authorization: ApiKey <FABRIC_API_KEY>` to Fabric endpoints.
- Use least-privileged node keys and rotate keys routinely.
- Never embed `FABRIC_API_KEY` in committed files or prompts.

## Rate limiting + metering considerations
- Search and inventory routes are metered and rate-limited by the API.
- The wrapper sends unique `Idempotency-Key` values for POST tool calls.
- Agent clients should still implement retry backoff on `429 rate_limit_exceeded`.
- Metered routes only charge on HTTP `200`, per platform contract.

## Registry readiness
The wrapper code is ready for local MCP use. Publishing to external MCP registries requires human account actions:
1. Create/verify publisher account on target MCP registry.
2. Upload package metadata (name, owner, homepage, support contact, auth model).
3. Complete registry verification/signing steps.
4. Configure production secrets (`FABRIC_API_KEY`) in the hosting environment.
