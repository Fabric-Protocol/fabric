# MCP Read-Only Wrapper (Fabric API)

## Purpose
Expose a minimal MCP server that proxies to existing Fabric REST endpoints without mutating server state outside normal endpoint semantics.

There are two MCP integration modes:

1. **In-process endpoint** (`POST /mcp`) — mounted in the Fastify app; uses `app.inject()` to call existing routes. Discoverable via `GET /v1/meta` → `mcp_url`. **This is the deployed mode.**
2. **Standalone stdio server** (`scripts/mcp-readonly-server.ts`) — for local agent use via stdio transport (local dev / Claude Desktop / Cursor).

Both expose the same 7-tool allowlist.

## Related docs
- [Fabric Skill (overview)](../fabric-skill.md)
- [MCP Tool Spec (detailed contract)](../mcp-tool-spec.md)

---

## In-process endpoint (deployed)

Implemented in `src/mcp.ts`, registered in `src/app.ts` via `registerMcpRoute()`.

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `MCP_URL` | no | derived from request host | Override the `mcp_url` value published in `GET /v1/meta`. Set to the canonical public URL of the MCP endpoint (e.g. `https://api.fabric.example/mcp`). |
| `RATE_LIMIT_MCP_PER_MINUTE` | no | `60` | Per-node rate limit for `POST /mcp` requests per minute. |

No additional secrets are needed — the MCP endpoint uses the same `Authorization: ApiKey` header and the same DB/auth middleware as the REST API.

### Auth
```
Authorization: ApiKey <api_key>
```

### Discovery
```
GET /v1/meta  →  { "mcp_url": "https://<host>/mcp", ... }
```

### Cloud Run deployment notes

The in-process MCP endpoint requires no changes to the Cloud Run service definition — it is part of the same Fastify binary, exposed on the same port.

**Steps to enable on Cloud Run:**

1. Set `MCP_URL` env var in the Cloud Run service to the canonical public URL:
   ```
   MCP_URL=https://<your-cloud-run-service-url>/mcp
   ```
   This ensures `GET /v1/meta` returns the correct absolute URL even behind a load balancer.
   If `MCP_URL` is not set, the URL is derived from the forwarded host header, which works correctly on Cloud Run as long as the service is accessed via its canonical URL.

2. No firewall/ingress changes needed — `/mcp` uses the same HTTP port as the rest of the API.

3. Smoke-test after deploy:
   ```powershell
   scripts\smoke-mcp.ps1 -BaseUrl https://<your-service-url> -ApiKey <node_api_key>
   ```

**No GCP console actions required** to enable the endpoint — it is deployed automatically with the existing service binary.

---

## Standalone stdio server (local dev)

- Source: `scripts/mcp-readonly-server.ts`
- Run: `npm run mcp:readonly`
- Transport: stdio (LSP-style framing)

### Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `FABRIC_API_BASE_URL` | no | `http://localhost:8080` | Base URL of the Fabric API to proxy to. |
| `FABRIC_API_KEY` | **yes** | — | Node API key forwarded as `Authorization: ApiKey`. |
| `FABRIC_MCP_TIMEOUT_MS` | no | `15000` | Per-request timeout in milliseconds. |

Example (local):
```bash
export FABRIC_API_BASE_URL="http://localhost:8080"
export FABRIC_API_KEY="<node_api_key>"
npm run mcp:readonly
```

Example (against Cloud Run):
```bash
export FABRIC_API_BASE_URL="https://<your-cloud-run-service-url>"
export FABRIC_API_KEY="<node_api_key>"
npm run mcp:readonly
```

### Claude Desktop / Cursor configuration
Add to your MCP client config (e.g. `claude_desktop_config.json`):
```json
{
  "mcpServers": {
    "fabric": {
      "command": "node",
      "args": ["dist/scripts/mcp-readonly-server.js"],
      "cwd": "/path/to/fabric-api",
      "env": {
        "FABRIC_API_BASE_URL": "https://<your-cloud-run-service-url>",
        "FABRIC_API_KEY": "<node_api_key>"
      }
    }
  }
}
```

---

## Smoke test

Script: `scripts/smoke-mcp.ps1`

```powershell
# Local
scripts\smoke-mcp.ps1 -BaseUrl http://localhost:8080 -ApiKey <node_api_key>

# Cloud Run
scripts\smoke-mcp.ps1 -BaseUrl https://<your-service-url> -ApiKey <node_api_key>
```

Checks performed:
1. `GET /v1/meta` — `mcp_url` present and ends with `/mcp`
2. `POST /mcp initialize` — server info and protocol version
3. `POST /mcp tools/list` — all 7 tools present
4. `POST /mcp tools/call fabric_get_credits` — happy path, `credits_balance` field present
5. Unknown tool correctly rejected (`isError=true`, `error=unknown_tool`)

Exits `0` on all checks passed, `1` on any failure.

---

## Exposed MCP tools

| Tool | Underlying route |
|---|---|
| `fabric_search_listings` | `POST /v1/search/listings` |
| `fabric_search_requests` | `POST /v1/search/requests` |
| `fabric_get_unit` | `GET /v1/units/{unit_id}` |
| `fabric_get_request` | `GET /v1/requests/{request_id}` |
| `fabric_get_offer` | `GET /v1/offers/{offer_id}` |
| `fabric_get_events` | `GET /v1/events` |
| `fabric_get_credits` | `GET /v1/credits/balance` |

---

## Auth guidance
- The wrapper forwards `Authorization: ApiKey <key>` to Fabric endpoints.
- Use least-privileged node keys and rotate keys routinely.
- Never embed `FABRIC_API_KEY` in committed files or prompts.
- The in-process endpoint enforces the same auth middleware as all other routes.

## Rate limiting + metering
- `POST /mcp` has a per-node rate limit (`RATE_LIMIT_MCP_PER_MINUTE`, default 60).
- Individual underlying routes have their own limits (e.g. search: 20/minute).
- Both limits apply independently.
- Search and inventory calls are metered; credits are debited only on HTTP 200.
- The standalone server sends unique `Idempotency-Key` values for POST tool calls.
- Agent clients should implement retry backoff on `429 rate_limit_exceeded`.

## Registry readiness
The wrapper code is ready for local MCP use. Publishing to external MCP registries requires human account actions:
1. Create/verify publisher account on target MCP registry.
2. Upload package metadata (name, owner, homepage, support contact, auth model).
3. Complete registry verification/signing steps.
4. Configure production secrets in the hosting environment.
