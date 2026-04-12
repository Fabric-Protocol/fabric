# Fabric MCP Tool Spec

Public integration guide for Fabric's current MCP endpoint.

Fabric's MCP surface is intentionally smaller than the full REST API. In the current live runtime it is a compact workflow facade, not a 1:1 mirror of every route.

## Connection

1. Call `GET /v1/meta` on a running Fabric instance.
2. Read the `mcp_url` field.
3. Use JSON-RPC 2.0 over HTTP POST to that URL.

Do not hardcode infrastructure URLs from repository docs. Discover them from the live service.

## Authentication

Authenticated MCP calls use the same Fabric auth schemes as REST:

```http
Authorization: ApiKey <api_key>
Authorization: Session <session_token>
```

Notes:
- `ApiKey` is the primary auth scheme.
- `Session` is a short-lived credential for MCP runtimes that cannot reliably set API-key headers.
- `Authorization: Bearer ...` is not a Fabric auth scheme.
- `session_token` passed in MCP tool arguments is an MCP fallback transport only.

If your MCP client cannot reliably set headers:
1. Call `fabric_login_session` with the current API key.
2. Pass `session_token` in authenticated tool arguments.
3. Re-run `fabric_login_session` when the token expires.
4. If the API key is lost, use recovery first, then mint a new session token.

## Current published surface

The current live MCP surface publishes 28 workflow tools.

Main groups:
- bootstrap and discovery
- recovery and session login
- search
- inventory
- public node discovery
- auth keys
- offers and events
- billing and credits
- profile
- referrals

In the current live runtime, the no-auth lane includes:
- `fabric_bootstrap`
- `fabric_get_meta`
- `fabric_get_categories`
- `fabric_get_regions`
- `fabric_recovery_start`
- `fabric_recovery_complete`
- `fabric_login_session`
- `fabric_logout_session`

## Compact tool model

The current live MCP surface uses several compact workflow tools rather than a larger task-split surface.

Examples:
- `fabric_search`
- `fabric_create_inventory`
- `fabric_set_inventory_visibility`
- `fabric_list_inventory`
- `fabric_update_inventory`
- `fabric_delete_inventory`
- `fabric_get_inventory`
- `fabric_get_node_inventory`
- `fabric_get_nodes_categories_summary`
- `fabric_auth_keys`
- `fabric_get_offers`
- `fabric_get_events`
- `fabric_write_offer`
- `fabric_decide_offer`
- `fabric_reveal_contact`
- `fabric_report_offer`
- `fabric_get_billing_info`
- `fabric_start_purchase`
- `fabric_profile`
- `fabric_referrals`

Use `tools/list` on a live instance for the current exact schemas and argument shapes.

## Protocol

Supported JSON-RPC method families:
- initialize
- tools
- prompts
- resources

The live runtime is the final source for exact currently supported methods and schemas.

## Compatibility

Older compatibility aliases may still be callable for existing clients, but external integrations should prefer the current names published by `tools/list`.

## REST-only areas

Some Fabric functionality remains REST-only and is not part of the public MCP workflow surface:
- billing auto-topup setup and configuration
- webhook ingestion endpoints
- email verification endpoints
- administrative or internal operations

## Error format

Tool failures use Fabric's standard error envelope:

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "human readable",
    "details": {}
  }
}
```

For exact tool names, schemas, and availability, connect to a running Fabric instance and inspect the MCP server directly.
