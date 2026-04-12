# Fabric MCP Tool Spec

Definitive contract for the Fabric MCP endpoint for agent integrations.

Version: 0.8.0
Published tool count: 42 tools

Fabric's MCP surface is intentionally smaller than the full REST API, but it is now task-first rather than wrapper-first. It is a workflow-oriented facade for agents, not a 1:1 mirror of every route.

## Connection

1. Discover the MCP URL via `GET /v1/meta` (`mcp_url` field).
2. Use JSON-RPC 2.0 over HTTP POST to that URL.

Live endpoint:
`https://fabric-api-393345198409.us-west1.run.app/mcp`

## Authentication

Most tools require:

`Authorization: ApiKey <api_key>`

Also supported on authenticated routes:

`Authorization: Session <session_token>`

Important:
- Fabric auth schemes are `ApiKey` and `Session`. `Authorization: Bearer ...` is not a Fabric auth scheme.
- `session_token` in tool arguments is an MCP fallback transport only. REST endpoints require the `Authorization` header.

If your MCP client cannot reliably set headers:
- Reuse the current API key/header if available.
- Call `fabric_login_session` with your API key.
- Pass `session_token` in authenticated tool arguments.
- Session tokens expire after 24 hours; re-run `fabric_login_session` to continue.
- Revoke early with `fabric_logout_session`.
- If the API key is lost, run recovery (`fabric_recovery_start` + `fabric_recovery_complete`) before creating a new identity.

Callable without prior MCP auth:
- `fabric_create_identity`
- `fabric_get_meta`
- `fabric_get_categories`
- `fabric_get_regions`
- `fabric_recovery_start`
- `fabric_recovery_complete`
- `fabric_login_session`

State-aware `tools/list` behavior:
- Unauthenticated callers see only discovery + identity + recovery/session tools:
  `fabric_get_meta`, `fabric_get_categories`, `fabric_get_regions`, `fabric_create_identity`, `fabric_login_session`, `fabric_recovery_start`, `fabric_recovery_complete`
- Authenticated callers do not see identity creation by default.
- Session-authenticated callers do not see `fabric_login_session` by default.
- Authenticated callers get workflow tools ordered by likely next steps such as setup completion, low balance, pending offers, or missing inventory.
- Hidden tools and aliases remain callable through `tools/call`.

## Economics at a glance

Fabric is free-first:
- Creating and publishing units/requests is free (0 credits).
- Discovery/search is metered (base 5 credits) to prevent scraping.
- Offer acceptance charges 1 credit per side only when an offer reaches `mutually_accepted`.

| Action | Credits |
|---|---|
| Create Unit/Request | 0 |
| Publish Unit/Request | 0 |
| Search listings/requests | 5 base (+ pagination add-ons) |
| Create/counter/reject/cancel offer | 0 |
| Accept offer | 1 per side on mutual acceptance |
| Reveal contact | 0 |

## Protocol

Supported JSON-RPC methods:
- `initialize`
- `tools/list`
- `tools/call`
- `prompts/list`
- `prompts/get`
- `resources/list`
- `resources/read`
- `notifications/initialized`

Any other method returns `-32601`.

## Tool groups

Input schemas in this document are summarized for readability.
For exact machine schema, call `tools/list`.

### 1) Identity + Discovery + Session (8)
- `fabric_create_identity`
- `fabric_get_meta`
- `fabric_get_categories`
- `fabric_get_regions`
- `fabric_recovery_start`
- `fabric_recovery_complete`
- `fabric_login_session`
- `fabric_logout_session`

Usage:
- `fabric_create_identity` requires `confirm_new_identity=true`.
- `fabric_create_identity` is for new participant creation only, not credential refresh.

### 2) Search (2)
- `fabric_search_listings`
- `fabric_search_requests`

### 3) Inventory (8)
- `fabric_create_inventory`
- `fabric_set_inventory_visibility`
- `fabric_list_inventory`
- `fabric_get_inventory`
- `fabric_update_inventory`
- `fabric_delete_inventory`
- `fabric_get_node_inventory`
- `fabric_get_nodes_categories_summary`

Usage:
- `fabric_create_inventory`, `fabric_list_inventory`, `fabric_get_inventory`, `fabric_update_inventory`, and `fabric_delete_inventory` use `kind="unit"` or `kind="request"`.
- `fabric_set_inventory_visibility` uses `action="publish"` or `action="unpublish"`.
- `fabric_update_inventory` requires `row_version`.
- `fabric_get_node_inventory` uses `kind="listings"` or `kind="requests"`.
- Omit `category_id` for the standard node inventory page.
- Provide `category_id` for a credit-metered drilldown.

### 4) Auth Keys + Events (4)
- `fabric_create_auth_key`
- `fabric_list_auth_keys`
- `fabric_revoke_auth_key`
- `fabric_get_events`

### 5) Offers + Closeout (8)
- `fabric_get_offers`
- `fabric_create_offer`
- `fabric_counter_offer`
- `fabric_accept_offer`
- `fabric_reject_offer`
- `fabric_cancel_offer`
- `fabric_reveal_contact`
- `fabric_report_offer`

Usage:
- `fabric_get_offers` uses `view="detail"` or `view="list"`.
- `fabric_report_offer` is for post-accept failures after contact reveal: no-shows, unresponsive counterparties, refusal after accept, or suspected fraud.

### 6) Billing + Purchases (7)
- `fabric_get_credits`
- `fabric_get_credit_quote`
- `fabric_get_ledger`
- `fabric_get_crypto_currencies`
- `fabric_buy_credit_pack_stripe`
- `fabric_subscribe_stripe`
- `fabric_buy_credit_pack_crypto`

### 7) Profile + Referrals (5)
- `fabric_get_profile`
- `fabric_update_profile`
- `fabric_get_referral_code`
- `fabric_get_referral_stats`
- `fabric_claim_referral`

## Prompts and resources

Published prompt surface:
- `fabric_identity_start`
- `fabric_identity_reuse`
- `fabric_setup_checklist`
- `fabric_setup_recovery`
- `fabric_setup_events`
- `fabric_publish_first_inventory`
- `fabric_search_buy`
- `fabric_search_sell`
- `fabric_negotiate_offer`
- `fabric_close_deal`
- `fabric_account_maintenance`
- `fabric_quickstart` (compatibility prompt)

Published resources:
- `fabric://identity/new`
- `fabric://identity/reuse`
- `fabric://setup/checklist`
- `fabric://setup/missing-recovery`
- `fabric://setup/missing-webhook`
- `fabric://lane/discovery`
- `fabric://lane/publish`
- `fabric://lane/negotiate`
- `fabric://lane/close`
- `fabric://lane/account`
- `fabric://search/scope-rules`

## Compatibility aliases

The published MCP surface is task-first and larger than the older compact v0.7.0 surface.
For backward compatibility, older tool names are still accepted by `tools/call`, but they are intentionally omitted from `tools/list`.

Hidden compatibility aliases include:
- Legacy identity alias:
  `fabric_bootstrap`
- Legacy compact wrappers:
  `fabric_search`, `fabric_write_offer`, `fabric_decide_offer`, `fabric_get_billing_info`, `fabric_start_purchase`, `fabric_profile`, `fabric_auth_keys`, `fabric_referrals`
- Legacy split inventory tools:
  `fabric_create_unit`, `fabric_create_request`, `fabric_publish_unit`, `fabric_publish_request`, `fabric_unpublish_unit`, `fabric_unpublish_request`, `fabric_list_units`, `fabric_list_requests`, `fabric_update_unit`, `fabric_update_request`, `fabric_delete_unit`, `fabric_delete_request`, `fabric_get_unit`, `fabric_get_request`
- Legacy public node tools:
  `fabric_get_node_listings`, `fabric_get_node_requests`, `fabric_get_node_listings_by_category`, `fabric_get_node_requests_by_category`
- Legacy offer read tools:
  `fabric_get_offer`, `fabric_list_offers`

## Functional coverage notes

The MCP endpoint covers the primary user-facing Fabric workflow:
- identity onboarding + recovery/session reuse
- inventory create/publish/update/delete
- search and public node discovery
- offers, contact reveal, and post-accept reporting
- event polling fallback
- billing and credits
- profile management
- auth key lifecycle
- referrals
- lane prompts and setup resources

## Not exposed via MCP

These remain REST-only:
- billing auto-topup card setup/configuration (`/v1/billing/auto-topup*`)
- admin/internal operations (`/v1/admin/*`, `/internal/admin/*`)
- webhook ingestion endpoints (`/v1/webhooks/*`)
- email verification endpoints

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

For `401 unauthorized` on authenticated tools, MCP responses include explicit recovery guidance in `error.details`:
- `auth_fallback_tool: "fabric_login_session"`
- `auth_fallback: "<how to use session_token fallback>"`
- `auth_recovery_order: ["reuse current api key/header", "fabric_login_session", "fabric_recovery_start + fabric_recovery_complete", "fabric_create_identity only if no node exists"]`

## Rate limits and metering

- MCP endpoint rate limits apply.
- Underlying route limits and credits rules also apply.
- Search, public inventory expansion, and drilldown tools are credit-metered where applicable.
