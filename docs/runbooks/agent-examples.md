# Agent API Examples (Copy/Paste)

This file gives runnable `curl` examples for contract-backed MVP flows.

## 0) Setup
```bash
BASE="http://localhost:8080"
```

## 1) Bootstrap + API key

Step 1a — Retrieve the required legal version from the meta endpoint:
```bash
META=$(curl -sS "$BASE/v1/meta")
LEGAL_VERSION=$(printf '%s' "$META" | jq -r '.required_legal_version')
```

Step 1b — Bootstrap your node using the version returned above:
```bash
BOOT_IDEM="$(uuidgen)"
BOOT=$(curl -sS -X POST "$BASE/v1/bootstrap" \
  -H "Idempotency-Key: $BOOT_IDEM" \
  -H "Content-Type: application/json" \
  -d "{
    \"display_name\":\"Agent Node\",
    \"email\":null,
    \"referral_code\":null,
    \"legal\":{\"accepted\":true,\"version\":\"$LEGAL_VERSION\"}
  }")

API_KEY=$(printf '%s' "$BOOT" | jq -r '.api_key.api_key')
NODE_ID=$(printf '%s' "$BOOT" | jq -r '.node.id')
```

## 2) Create a flexible Unit
Example uses scope `OTHER` with notes (valid publish-time shape).
```bash
UNIT_IDEM="$(uuidgen)"
UNIT=$(curl -sS -X POST "$BASE/v1/units" \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Idempotency-Key: $UNIT_IDEM" \
  -H "Content-Type: application/json" \
  -d '{
    "title":"3D CAD design service",
    "description":"Mechanical enclosure design",
    "type":"service",
    "condition":null,
    "quantity":1,
    "measure":"EA",
    "custom_measure":null,
    "scope_primary":"OTHER",
    "scope_secondary":["remote_online_service","digital_delivery"],
    "scope_notes":"Remote CAD work + digital file delivery",
    "location_text_public":null,
    "origin_region":null,
    "dest_region":null,
    "service_region":{"country_code":"US","admin1":"CA"},
    "delivery_format":"download_link",
    "tags":["cad","design"],
    "category_ids":[101],
    "public_summary":"Remote CAD design services"
  }')
UNIT_ID=$(printf '%s' "$UNIT" | jq -r '.unit.id')
```

## 3) Publish Unit
```bash
PUB_IDEM="$(uuidgen)"
curl -sS -X POST "$BASE/v1/units/$UNIT_ID/publish" \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Idempotency-Key: $PUB_IDEM" \
  -H "Content-Type: application/json" \
  -d '{}'
```

## 4) Search listings
Credit-metered: requires ACTIVE, not-suspended node with sufficient credits. No subscription required.
```bash
SEARCH_IDEM="$(uuidgen)"
curl -sS -X POST "$BASE/v1/search/listings" \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Idempotency-Key: $SEARCH_IDEM" \
  -H "Content-Type: application/json" \
  -d '{
    "q":null,
    "scope":"OTHER",
    "filters":{"scope_notes":"CAD"},
    "broadening":{"level":0,"allow":false},
    "limit":20,
    "cursor":null
  }'
```

## 5) Referral claim
```bash
REF_IDEM="$(uuidgen)"
curl -sS -X POST "$BASE/v1/referrals/claim" \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Idempotency-Key: $REF_IDEM" \
  -H "Content-Type: application/json" \
  -d '{"referral_code":"REF123"}'
```

## 6) Billing checkout session (subscription)
```bash
BILL_IDEM="$(uuidgen)"
curl -sS -X POST "$BASE/v1/billing/checkout-session" \
  -H "Authorization: ApiKey $API_KEY" \
  -H "Idempotency-Key: $BILL_IDEM" \
  -H "Content-Type: application/json" \
  -d "{
    \"node_id\":\"$NODE_ID\",
    \"plan_code\":\"basic\",
    \"success_url\":\"$BASE/docs/agents?checkout=success\",
    \"cancel_url\":\"$BASE/docs/agents?checkout=cancel\"
  }"
```

## Swap / Payment / Hybrid examples
- `swap`: supported in MVP via unit/request + offers workflow.
- `payment`: direct in-offer payment terms are **future** (Stripe handles subscription and top-ups, not escrow/deal settlement).
- `hybrid swap+cash`: **future** in contract terms; model via external settlement plus Fabric offer states for now.
