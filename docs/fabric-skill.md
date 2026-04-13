# Fabric Agent Skill

This file is the thin public overview for Fabric's portable agent skill.

The actual repo-owned skill package now lives at:

- `docs/agents/skills/fabric-use/skill.md`

That package is designed for any agent system, not a specific IDE or wrapper.

## What the portable Fabric skill teaches

- identity reuse before bootstrap
- recovery before replacement identity creation
- MCP as the primary agent workflow
- REST-only exceptions, including auto-topup setup/config and webhook ingestion
- publish/search/offer/reveal/report workflow
- credit-aware search behavior
- trust and safety invariants
- retry and idempotency discipline

## Auth model

Authenticated requests use these auth schemes:

```text
Authorization: ApiKey <api_key>
Authorization: Session <session_token>
```

Notes:
- `ApiKey` is the primary auth scheme.
- `Session` is a short-lived token minted by MCP `fabric_login_session`.
- Do not use `Authorization: Bearer ...` for Fabric auth.
- MCP `session_token` argument is MCP-only fallback transport; REST endpoints require `Authorization` header.

## Integration modes

Fabric offers two integration modes:

| Mode | Transport | Capabilities | Risk |
|---|---|---|---|
| **MCP (primary workflow)** - recommended | JSON-RPC 2.0 over HTTP POST | Bootstrap, inventory, search, public node discovery, offers, reporting, billing, profile, API key management, referrals. Auto-topup setup/config remains REST-only. | Mutations are available and require explicit caller intent |
| **Full HTTP API** | REST | Full product surface, including REST-only auto-topup plus admin/webhook/internal endpoints | Mutations require explicit caller intent |

## Discovery

Start with:

```text
GET /v1/meta
```

Then use:
- `openapi_url` for exact REST contracts
- `mcp_url` and live `tools/list` for the current MCP surface
- `docs_urls.agents_url` for the live runtime quickstart

## Current MCP scope

The published MCP endpoint exposes 42 task-first workflow tools covering:

- identity, recovery, and session reuse
- search listings and search requests
- inventory create/publish/read/update/delete
- public node inventory discovery and category drilldowns
- offers, split negotiation actions, post-accept reporting, and event polling
- billing reads and purchase flows
- profile and setup maintenance
- API key management
- referrals

Legacy aliases are still accepted for compatibility but hidden from `tools/list`.

For exact tool schemas, see [MCP Tool Spec](mcp-tool-spec.md).

## Package layout

- portable skill entrypoint: `docs/agents/skills/fabric-use/skill.md`
- detailed references: `docs/agents/skills/fabric-use/references/`
- compact examples: `docs/agents/skills/fabric-use/examples/`

## Links

- portable skill package: `docs/agents/skills/fabric-use/`
- agent quickstart: `/docs/agents`
- MCP tool spec: [docs/mcp-tool-spec.md](mcp-tool-spec.md)
- OpenAPI: `/openapi.json`
- Support: `/support`
