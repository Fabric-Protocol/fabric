# Manual Suspension Runbook (MVP)

## Purpose
Apply emergency/manual suspension for a Node involved in abuse, security incidents, or policy violations.

Normative behavior reference: `docs/specs/00__read-first.md` and `docs/specs/20__api-contracts.md`.

## Preconditions
- Operator has DB access with write permissions.
- Operator has incident ticket/reference and evidence summary.

## Procedure
1. Identify target node and active keys:
```sql
select id, status, suspended_at from nodes where id = '<NODE_ID>';
select id, label, revoked_at from api_keys where node_id = '<NODE_ID>' and revoked_at is null;
```
2. Set suspension timestamp:
```sql
update nodes
set suspended_at = now(), status = 'SUSPENDED'
where id = '<NODE_ID>';
```
3. Revoke all active API keys:
```sql
update api_keys
set revoked_at = now()
where node_id = '<NODE_ID>' and revoked_at is null;
```
4. Remove public projection visibility by running rebuild:
- `POST /v1/admin/projections/rebuild?kind=all&mode=full`

## Verify
- `GET /v1/me` with old keys returns `403 forbidden` (revoked key).
- Node no longer appears in public projections/search results after rebuild.

## Unsuspend
1. Clear suspension and restore ACTIVE status:
```sql
update nodes
set suspended_at = null, status = 'ACTIVE'
where id = '<NODE_ID>';
```
2. Mint new API key (do not un-revoke old keys).
3. Rebuild projections.

## Communication
- Document reason, timestamp, operator, and next review checkpoint.
- Notify impacted operator/account channel with policy reference.
