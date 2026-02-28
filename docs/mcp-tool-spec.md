# Fabric MCP Tool Spec

Definitive contract for the Fabric MCP endpoint for agent integrations.

Version: 0.3.0
Tool count: 49 tools (full lifecycle + inventory maintenance + public node discovery + auth key management + referrals)

## Connection

1. Discover the MCP URL via `GET /v1/meta` (`mcp_url` field).
2. Use JSON-RPC 2.0 over HTTP POST to that URL.

Live endpoint:
`https://fabric-api-393345198409.us-west1.run.app/mcp`

## Authentication

Most tools require:

`Authorization: ApiKey <api_key>`

No-auth tools:
- `fabric_bootstrap`
- `fabric_get_meta`
- `fabric_get_categories`
- `fabric_get_regions`

## Protocol

Supported JSON-RPC methods:
- `initialize`
- `tools/list`
- `tools/call`
- `prompts/list`
- `prompts/get`
- `resources/list`
- `notifications/initialized`

Any other method returns `-32601`.

## Tool groups

Input schemas in this document are summarized for readability.
For exact machine schema, call `tools/list`.

### 1) Bootstrap + Discovery (4)
- `fabric_bootstrap`
- `fabric_get_meta`
- `fabric_get_categories`
- `fabric_get_regions`

### 2) Search (2)
- `fabric_search_listings`
- `fabric_search_requests`

### 3) Inventory Create + Publish (8)
- `fabric_create_unit`
- `fabric_publish_unit`
- `fabric_unpublish_unit`
- `fabric_create_request`
- `fabric_publish_request`
- `fabric_unpublish_request`
- `fabric_list_units`
- `fabric_list_requests`

### 4) Inventory Maintenance (4)
- `fabric_update_unit` (requires `unit_id`, `row_version`)
- `fabric_delete_unit` (requires `unit_id`)
- `fabric_update_request` (requires `request_id`, `row_version`)
- `fabric_delete_request` (requires `request_id`)

### 5) Public Node Discovery (5)
- `fabric_get_node_listings`
- `fabric_get_node_requests`
- `fabric_get_node_listings_by_category`
- `fabric_get_node_requests_by_category`
- `fabric_get_nodes_categories_summary`

### 6) Read + Events + Credits (5)
- `fabric_get_unit`
- `fabric_get_request`
- `fabric_get_offer`
- `fabric_get_events`
- `fabric_get_credits`

### 7) Offer Lifecycle (7)
- `fabric_create_offer`
- `fabric_counter_offer`
- `fabric_accept_offer`
- `fabric_reject_offer`
- `fabric_cancel_offer`
- `fabric_reveal_contact`
- `fabric_list_offers`

### 8) Billing + Credits (5)
- `fabric_get_credit_quote`
- `fabric_buy_credit_pack_stripe`
- `fabric_subscribe_stripe`
- `fabric_buy_credit_pack_crypto`
- `fabric_get_crypto_currencies`

### 9) Profile + Keys + Referrals (9)
- `fabric_get_profile`
- `fabric_update_profile`
- `fabric_get_ledger`
- `fabric_create_auth_key`
- `fabric_list_auth_keys`
- `fabric_revoke_auth_key`
- `fabric_get_referral_code`
- `fabric_get_referral_stats`
- `fabric_claim_referral`

## Functional coverage notes

The MCP endpoint now covers user-facing Fabric flows for:
- bootstrap/onboarding
- inventory create/publish/update/delete
- search + public node discovery drilldowns
- offers + contact reveal
- billing + credits + ledger
- profile management
- auth key lifecycle
- referrals

## Not exposed via MCP

These remain REST-only:
- admin/internal operations (`/v1/admin/*`, `/internal/admin/*`)
- webhook ingestion endpoints (`/v1/webhooks/*`)
- email verification and account recovery endpoints

## Error envelope

Non-2xx tool failures return Fabric's standard error envelope:

```json
{
  "error": {
    "code": "STRING_CODE",
    "message": "human readable",
    "details": {}
  }
}
```

## Rate limits and metering

- MCP endpoint rate limits apply.
- Underlying route limits and credits rules also apply.
- Search, public inventory expansion, and drilldown tools are credit-metered where applicable.
