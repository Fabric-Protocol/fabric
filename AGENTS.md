# AGENTS.md — Fabric API

This repo implements the **Fabric backend/API**. Fabric is agent-native: Nodes are first-class principals, and many callers will be autonomous agents.

## 0) Source-of-truth specs (read in this order)

All implementation MUST conform to these docs under `docs/specs/` (precedence order):
1. `00__read-first.md`
2. `10__invariants.md`
3. `20__api-contracts.md`
4. `22__projections-and-search.md`
5. `25__plans-credits-gating.md
6. `30__mvp-scope.md`
7. `40__vision.md` (non-normative)
8. `01__implementation-map.md` (implementation guidance; non-authoritative vs items 1–6)
9. `02__agent-onboarding.md` (onboarding guidance; non-authoritative vs items 1–6)
10. `40__vision.md` (non-normative)

If anything conflicts, update the later doc(s). Do not “resolve” by inventing new behavior in code.

## 1) What to build in MVP (high-level)

- Canonical private objects: Units, Requests
- Public marketplace behavior via projections: public_listings/public_requests
- Paid/authenticated search (credits + subscriber gating)
- Offer lifecycle + holds + countering + contact reveal gating
- Stripe webhook handling (if enabled in MVP)
- Admin takedown + projection rebuild endpoints (admin auth only)

## 2) Guardrails (do not guess)

- Do not invent endpoints, fields, enums, or error codes.
- Use request/response bodies exactly as specified in `20__api-contracts.md`.
- Enforce error envelope for all non-2xx responses.
- Do not charge credits except on HTTP 200.
- Idempotency: all non-GET endpoints require `Idempotency-Key` (webhooks excluded). Reuse with different payload must return 409.
- Optimistic concurrency: PATCH requires `If-Match` where specified.

## 3) Conventions required across the codebase

### 3.1 Error envelope
All non-2xx must be:
```json
{ "error": { "code": "STRING_CODE", "message": "human readable", "details": {} } }
3.2 Auth
Normal endpoints:

Authorization: ApiKey <api_key>

Admin endpoints:

X-Admin-Key: <admin_key>

3.3 Soft delete
Canonical objects use deleted_at tombstones. Default list endpoints exclude deleted.

3.4 Projections are derived (never edited directly by callers)
Only publish/unpublish and rebuild actions change projections.

4) Where logic should live (layering)
Agent instruction: do NOT scatter business rules in route handlers.

Required layering:

routes/controllers: parse/validate, call service, translate service errors to error envelope

services: enforce invariants + transitions + metering decisions

db: queries/transactions only, no business rules

shared http: auth, idempotency, error helpers, metering middleware

5) Implementation tasks (how to work safely)
When making changes:

Identify the exact spec section that governs the behavior.

Implement the smallest change that conforms to the spec.

Add/adjust tests for:

status codes

error envelope

idempotency replay behavior (same key/same payload)

metering “charge only on 200” (if endpoint is metered)

Update docs/specs only if the spec itself is changing (not for implementation detail).

6) Required tests for any agent-visible behavior
Minimum test checklist per touched endpoint:

success response shape matches contract

failure responses use error envelope + correct error.code

auth failures return 401

idempotency:

first call stores/returns response

replay returns same response

replay with different payload returns 409

metering (if applicable):

success decrements credits and writes ledger

failure does not decrement

7) Out of scope (MVP)
No escrow / payment intermediation

No in-app chat

No contact reveal before mutual acceptance

No background matching unless explicitly specified

No “combined” search endpoint (listings and requests are separate)

8) Repo workflow expectations
Keep changes minimal and spec-aligned.

Do not refactor unrelated files in the same change.

Prefer additive changes over wide rewrites.

If a decision is required (e.g., plan thresholds), do not guess; leave a TODO and document the required decision in docs/specs/decision-log.md (or the repo’s chosen decision log file).