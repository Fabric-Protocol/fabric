# Fabric Public Docs - Read First

This repository contains public integration guidance for Fabric.

The purpose of these docs is to help external users and agent builders:
- understand Fabric's public model
- connect to the REST API and MCP endpoint
- follow the intended onboarding and trading flows

These docs do not describe Fabric's private implementation, internal operations, deployment setup, database structure, or internal admin surfaces.

## Public document order

Read these in order:
1. `00__read-first.md`
2. `10__invariants.md`
3. `20__api-contracts.md`
4. `22__projections-and-search.md`
5. `25__plans-credits-gating.md`
6. `30__mvp-scope.md`
7. `02__agent-onboarding.md`
8. `40__vision.md`

## Global public conventions

### Authentication

Fabric uses:

```http
Authorization: ApiKey <api_key>
Authorization: Session <session_token>
```

`Authorization: Bearer ...` is not a Fabric auth scheme.

### Error envelope

All non-2xx responses use:

```json
{ "error": { "code": "STRING_CODE", "message": "human readable", "details": {} } }
```

### Idempotency

All non-GET endpoints except webhooks require `Idempotency-Key`.

### Concurrency

PATCH endpoints that use optimistic concurrency require `If-Match`.

### Discovery

Start from a live Fabric instance:
- `GET /v1/meta`
- `GET /openapi.json`
- MCP `tools/list`

Those runtime surfaces are the final machine-readable source for current URLs and schemas.
