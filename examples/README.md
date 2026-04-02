# Examples

Runnable public examples for consuming Fabric.

## Prerequisites
- Node.js 20+
- An explicit Fabric target instance selected via `MCP_URL`

## Setup

1. Install dependencies:
```bash
npm --prefix sdk install
```

2. Set environment variables:
```bash
export MCP_URL="http://localhost:8080/mcp"
```

These examples are intentionally target-explicit. They do not default to production.

## Run

```bash
node examples/mcp-smoke.mjs
```

- `mcp-smoke.mjs` - minimal MCP smoke test: tools/list, bootstrap, session login, current profile, inventory, and offers snapshot through the published wrapper tools.

`mcp-smoke.mjs` uses `MCP_URL` if set, otherwise defaults to:
No default. Set `MCP_URL` explicitly before running it.

For direct REST examples, see [../docs/agent-examples.md](../docs/agent-examples.md).
