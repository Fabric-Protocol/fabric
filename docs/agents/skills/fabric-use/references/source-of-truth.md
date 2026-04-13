# Source Of Truth

## Truth order

Use this order when deciding what Fabric currently supports:

1. live Fabric instance metadata from `GET /v1/meta`
2. live OpenAPI from `GET /openapi.json`
3. live MCP discovery from `tools/list`
4. repo source-of-truth docs:
   - `docs/specs/02__agent-onboarding.md`
   - `docs/specs/20__api-contracts.md`
   - `docs/mcp-tool-spec.md`

## Conflict rule

If a portable skill file, old example, or stale wrapper conflicts with the live Fabric surface, trust the live Fabric surface and current repo specs.

## Why this matters

Fabric evolves. Skills are guidance layers, not the protocol itself.

The skill should tell the agent how to behave, but exact endpoint shapes, tool schemas, and live runtime behavior belong to the current source-of-truth surfaces.
