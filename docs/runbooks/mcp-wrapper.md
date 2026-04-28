# MCP Integration Runbook (Fabric API)

## Purpose
Describe how Fabric exposes MCP in production and how to run an optional local stdio bridge.

## Integration modes
1. In-process MCP HTTP endpoint (`POST /mcp`):
- Implemented in `src/mcp.ts`, mounted by `registerMcpRoute()` in `src/app.ts`
- Discoverable via `GET /v1/meta` -> `mcp_url`
- Published MCP surface (42 total tools across auth states in v0.8.0: 7 unauthenticated bootstrap/recovery/discovery tools, 41 authenticated API-key participant tools, and 40 authenticated session tools; hidden compatibility aliases remain callable but are not listed)
- `tools/list` is state-aware: unauthenticated callers see the identity/recovery lane; authenticated callers do not see identity creation by default

2. Optional local stdio bridge (`scripts/mcp-stdio-server.ts`):
- Runs as a local MCP stdio server for local agent tooling
- Proxies to Fabric REST endpoints using `FABRIC_API_BASE_URL` + `FABRIC_API_KEY`
- Smaller compatibility surface than the in-process MCP route

## In-process endpoint (deployed)

Auth:
```http
Authorization: ApiKey <api_key>
Authorization: Session <session_token>
```

Important:
- Use exact Fabric auth schemes `ApiKey` or `Session`.
- Do not use `Authorization: Bearer ...` for Fabric auth.
- `session_token` in MCP tool arguments is fallback transport for MCP only; REST endpoints require `Authorization` header.

Headerless fallback:
- Call `fabric_login_session` with your API key
- Pass `session_token` in authenticated MCP tool arguments (24h TTL)
- Re-run `fabric_login_session` when token expires

Identity safety:
- Use `fabric_create_identity` only to create a brand-new participant identity
- `fabric_create_identity` requires `confirm_new_identity=true`
- Do not use identity creation for credential refresh or session recovery
- If a node already exists, prefer current API key/header, then `fabric_login_session`, then recovery

Discovery:
```http
GET /v1/meta
```

Environment variables:
- `MCP_URL` (optional): override published `mcp_url`
- `RATE_LIMIT_MCP_PER_MINUTE` (optional, default `60`): per-node MCP route limit

## Local stdio bridge (optional)

Source:
- `scripts/mcp-stdio-server.ts`

Run:
```bash
npm run mcp:stdio
```

Environment variables:
- `FABRIC_API_BASE_URL` (default `http://localhost:8080`)
- `FABRIC_API_KEY` (required)
- `FABRIC_MCP_TIMEOUT_MS` (default `15000`)

Example:
```bash
export FABRIC_API_BASE_URL="https://fabric-api-393345198409.us-west1.run.app"
export FABRIC_API_KEY="<node_api_key>"
npm run mcp:stdio
```

## Smoke testing

Script:
- `scripts/smoke-mcp.ps1`

Run:
```powershell
scripts\smoke-mcp.ps1 -BaseUrl https://<service-url> -ApiKey <node_api_key>
```

Expected checks:
1. `GET /v1/meta` returns `mcp_url`
2. `POST /mcp initialize` succeeds
3. `POST /mcp tools/list` returns the expected state-aware tool surface for the supplied auth state
4. `POST /mcp tools/call fabric_get_credits` succeeds
5. Unknown tool is rejected with MCP error content

## References
- `docs/mcp-tool-spec.md`
- `docs/fabric-skill.md`
