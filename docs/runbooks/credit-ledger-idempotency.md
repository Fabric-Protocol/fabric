# Credit Ledger Idempotency Notes (MVP)

## Principle
Credits must never be double-applied for the same billing/payment event.

## Mechanisms
- `credit_ledger` supports `idempotency_key` with unique index per node.
- Stripe event ids are separately deduped in `stripe_events`.
- For invoice-driven grants, use invoice-linked idempotency keys.

## Recommended key strategy
- Monthly subscription grant: `invoice:<invoice_id>:monthly`
- Upgrade/proration difference grant: `invoice:<invoice_id>:upgrade`
- Credit pack grant: `credit_pack:<payment_intent_id>` (fallback: checkout session id)

## Operational checks
1. For a target node and invoice id:
```sql
select id, type, amount, idempotency_key, meta, created_at
from credit_ledger
where node_id = '<NODE_ID>' and idempotency_key like 'invoice:<INVOICE_ID>%'
order by created_at;
```
2. Verify only expected rows exist and totals match product semantics.

## Replay expectation
- Replayed webhook events should not create duplicate ledger rows for the same idempotency key.
