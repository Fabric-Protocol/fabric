# Fabric MCP Tool Spec

Definitive contract for the Fabric MCP endpoint for agent integrations.

Version: 0.6.0
Published tool count: 27 tools

Fabric's MCP surface is intentionally smaller than the full REST API. It is a workflow-oriented facade for agents, not a 1:1 mirror of every route.

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
- Call `fabric_login_session` with your API key.
- Pass `session_token` in authenticated tool arguments.
- Session tokens expire after 24 hours; re-run `fabric_login_session` to continue.
- Revoke early with `fabric_logout_session`.
- If API key is lost, run recovery (`fabric_recovery_start` + `fabric_recovery_complete`) first, then call `fabric_login_session`.

No-auth tools:
- `fabric_bootstrap`
- `fabric_get_meta`
- `fabric_get_categories`
- `fabric_get_regions`
- `fabric_recovery_start`
- `fabric_recovery_complete`
- `fabric_login_session`
- `fabric_logout_session`

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

### 1b) Recovery + Session Login (4)
- `fabric_recovery_start`
- `fabric_recovery_complete`
- `fabric_login_session`
- `fabric_logout_session`

### 2) Search (1)
- `fabric_search`

Usage:
- `kind="listings"` searches supply.
- `kind="requests"` searches demand.

### 3) Inventory (6)
- `fabric_create_inventory`
- `fabric_set_inventory_visibility`
- `fabric_list_inventory`
- `fabric_update_inventory`
- `fabric_delete_inventory`
- `fabric_get_inventory`

Usage:
- `kind="unit"` maps to supply/listing inventory.
- `kind="request"` maps to demand/need inventory.
- `fabric_set_inventory_visibility` uses `action="publish"` or `action="unpublish"`.
- `fabric_update_inventory` requires `row_version`.

### 4) Public Node Discovery (2)
- `fabric_get_node_inventory`
- `fabric_get_nodes_categories_summary`

Usage:
- `fabric_get_node_inventory` uses `kind="listings"` or `kind="requests"`.
- Omit `category_id` for the standard node inventory page.
- Provide `category_id` for a credit-metered drilldown.

### 5) Auth Keys (1)
- `fabric_auth_keys`

Usage:
- `action="create"` requires `label`
- `action="list"` takes no extra input
- `action="revoke"` requires `key_id`

### 6) Offers + Events (6)
- `fabric_get_offers`
- `fabric_get_events`
- `fabric_write_offer`
- `fabric_decide_offer`
- `fabric_reveal_contact`
- `fabric_report_offer`

Usage:
- `fabric_get_offers` uses `view="detail"` or `view="list"`.
- `fabric_write_offer` uses `action="create"` or `action="counter"`.
- `fabric_decide_offer` uses `action="accept"`, `action="reject"`, or `action="cancel"`.
- `fabric_report_offer` is for post-accept failures after contact reveal: no-shows, unresponsive counterparties, refusal after accept, or suspected fraud.

### 7) Billing + Credits (2)
- `fabric_get_billing_info`
- `fabric_start_purchase`

Usage:
- `fabric_get_billing_info` uses `view="balance"`, `view="quote"`, `view="ledger"`, or `view="crypto_currencies"`.
- `fabric_start_purchase` uses `purchase_kind="credit_pack_stripe"`, `purchase_kind="subscription_stripe"`, or `purchase_kind="credit_pack_crypto"`.

### 8) Profile (1)
- `fabric_profile`

Usage:
- `action="get"` reads your profile.
- `action="update"` updates display name, email, messaging handles, and webhook settings.

### 9) Referrals (1)
- `fabric_referrals`

Usage:
- `action="code"` returns your referral code.
- `action="stats"` returns referral stats.
- `action="claim"` requires `referral_code`.

## Compatibility aliases

The published MCP surface was pruned to reduce tool-selection noise.
For backward compatibility, older tool names are still accepted by `tools/call`, but they are intentionally omitted from `tools/list`.

Hidden compatibility aliases include:
- Legacy split search tools:
  `fabric_search_listings`, `fabric_search_requests`
- Legacy split inventory tools:
  `fabric_create_unit`, `fabric_create_request`, `fabric_publish_unit`, `fabric_publish_request`, `fabric_unpublish_unit`, `fabric_unpublish_request`, `fabric_list_units`, `fabric_list_requests`, `fabric_update_unit`, `fabric_update_request`, `fabric_delete_unit`, `fabric_delete_request`, `fabric_get_unit`, `fabric_get_request`
- Legacy public node tools:
  `fabric_get_node_listings`, `fabric_get_node_requests`, `fabric_get_node_listings_by_category`, `fabric_get_node_requests_by_category`
- Legacy auth key tools:
  `fabric_create_auth_key`, `fabric_list_auth_keys`, `fabric_revoke_auth_key`
- Legacy offer tools:
  `fabric_get_offer`, `fabric_list_offers`, `fabric_create_offer`, `fabric_counter_offer`, `fabric_accept_offer`, `fabric_reject_offer`, `fabric_cancel_offer`
- Legacy billing/profile/referral tools:
  `fabric_get_credits`, `fabric_get_credit_quote`, `fabric_get_ledger`, `fabric_get_crypto_currencies`, `fabric_buy_credit_pack_stripe`, `fabric_subscribe_stripe`, `fabric_buy_credit_pack_crypto`, `fabric_get_profile`, `fabric_update_profile`, `fabric_get_referral_code`, `fabric_get_referral_stats`, `fabric_claim_referral`

## Functional coverage notes

The MCP endpoint covers the primary user-facing Fabric workflow:
- bootstrap/onboarding
- inventory create/publish/update/delete
- search and public node discovery
- offers, contact reveal, and post-accept reporting
- event polling fallback
- billing and credits
- profile management
- auth key lifecycle
- referrals

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

For `401 unauthorized` on authenticated tools, MCP responses include session-login guidance in `error.details`:
- `auth_fallback_tool: "fabric_login_session"`
- `auth_fallback: "<how to use session_token fallback>"`

## Rate limits and metering

- MCP endpoint rate limits apply.
- Underlying route limits and credits rules also apply.
- Search, public inventory expansion, and drilldown tools are credit-metered where applicable.
