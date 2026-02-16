### Goal
- Deliver a runnable Fastify + TypeScript Fabric API MVP that matches endpoint contracts in `docs/specs/20__api-contracts.md` and invariants in `docs/specs/10__invariants.md`, including auth, idempotency, optimistic concurrency, projections/search, credits/metering, offers/holds, referrals/webhooks, and admin tools.

### Sources of truth
- `docs/specs/00__read-first.md`
- `docs/specs/10__invariants.md`
- `docs/specs/20__api-contracts.md`
- `docs/specs/22__projections-and-search.md`
- `docs/specs/25__plans-credits-gating.md`
- `docs/specs/30__mvp-scope.md`
- `docs/specs/21__db-ddl.sql`

### Milestones
#### Milestone 1: Platform scaffold + runtime contracts
- Scope: Server bootstrap, env/config, DB bootstrap, canonical error envelope, headers, auth middleware skeleton, idempotency plumbing.
- Files likely touched: `src/server.ts`, `src/app.ts`, `src/config.ts`, `src/http.ts`, `src/db/*`, `scripts/bootstrap-db.ts`, `README.md`, `.env.example`, `Dockerfile`.
- Steps:
  - Ensure Cloud Run-compatible startup and local run.
  - Ensure non-2xx envelope and required headers on responses.
  - Implement API key and admin key auth middleware.
  - Implement non-GET idempotency-key requirement and replay conflict semantics.
- Validations (must run): `npm run lint`, `npm test`.
- Edge cases: bootstrap idempotency without node context.
- Notes/decisions: none.

#### Milestone 2: Endpoints 1–4 (bootstrap, auth keys, me, credits)
- Scope: `POST /v1/bootstrap`, `/v1/auth/keys*`, `/v1/me*`, `/v1/credits/*`.
- Files likely touched: `src/routes/*`, `src/services/*`, `src/db/*`, `tests/*`.
- Steps:
  - Implement exact request/response contracts.
  - Wire signup grant and balance/ledger reads.
  - Ensure key masking/listing/revoke semantics.
- Validations (must run): `npm run lint`, `npm test`.
- Edge cases: unauthorized and validation envelope correctness.
- Notes/decisions: none.

#### Milestone 3: Endpoints 5–7 (Units, Requests, publish/unpublish)
- Scope: CRUD + soft delete + optimistic concurrency + projection writes.
- Files likely touched: `src/routes/resources.ts`, `src/services/resources.ts`, `src/db/resources.ts`, `tests/resources.test.ts`.
- Steps:
  - Implement Units and Requests create/list/read/patch/delete.
  - Enforce `If-Match` for PATCH and stale-write conflict.
  - Implement publish eligibility checks and projection upsert/removal.
- Validations (must run): `npm run lint`, `npm test`.
- Edge cases: scope-specific publish validation rules.
- Notes/decisions: none.

#### Milestone 4: Endpoints 8–9 (search + node inventory expansion)
- Scope: `/v1/search/listings`, `/v1/search/requests`, `/v1/public/nodes/{node_id}/(listings|requests)`.
- Files likely touched: `src/routes/search.ts`, `src/services/search.ts`, `src/db/search.ts`, `tests/search.test.ts`.
- Steps:
  - Enforce subscriber-only gating and filter schema by scope.
  - Implement metering (charge only on 200) and search log redaction/hash.
  - Implement cursor pagination and metered expansion endpoints.
- Validations (must run): `npm run lint`, `npm test`.
- Edge cases: unknown filters => 422 validation_error.
- Notes/decisions: none.

#### Milestone 5: Endpoints 10–12 (offers, holds, reveal-contact)
- Scope: offer lifecycle + hold lifecycle + contact reveal gating.
- Files likely touched: `src/routes/offers.ts`, `src/services/offers.ts`, `src/db/offers.ts`, `tests/offers.test.ts`.
- Steps:
  - Implement create/counter/accept/reject/cancel/list/get + state machine.
  - Create/release/commit holds and return hold summaries.
  - Enforce mutual acceptance + both-subscriber preconditions on reveal-contact.
- Validations (must run): `npm run lint`, `npm test`.
- Edge cases: free recipient reject allowed.
- Notes/decisions: none.

#### Milestone 6: Endpoints 13–15 (referrals, stripe webhook, admin)
- Scope: referrals claim + webhook idempotency + admin takedown/credits adjust/rebuild.
- Files likely touched: `src/routes/referrals-admin.ts`, `src/services/referrals-admin.ts`, `src/db/admin.ts`, `tests/admin.test.ts`.
- Steps:
  - Implement referral claim lock rule (first paid event).
  - Implement webhook idempotency on `stripe_events.id` and subscription/credit effects.
  - Implement admin takedown (reversible state), manual credit adjust, full rebuild endpoint.
- Validations (must run): `npm run lint`, `npm test`.
- Edge cases: admin auth failures and envelope.
- Notes/decisions: map API takedown `public_listing|public_request|node` to DDL `listing|request|node`.

#### Milestone 7: End-to-end tests + docs polish
- Scope: complete HTTP test coverage for critical invariants and endpoint flows, README finalization.
- Files likely touched: `tests/*.test.ts`, `README.md`, `tasks/*`.
- Steps:
  - Add auth/error/idempotency/metering tests for touched endpoint families.
  - Ensure local run and test commands documented.
  - Run full test suite and fix failing cases.
- Validations (must run): `npm run lint`, `npm test`.
- Edge cases: metering only on 200 and replay does not double-charge.
- Notes/decisions: none.

## Completion checklist (must be true)
- All required endpoints/contracts for this task match `docs/specs/20__api-contracts.md`.
- Canonical error envelope is used everywhere (per invariants).
- Tests added/updated and passing.
- Lint/format passing (if present).
- README / docs updated if behavior changes.

## Decisions / surprises log
- Ambiguity: API contract takedown request uses `target_type=public_listing|public_request|node` (`docs/specs/20__api-contracts.md`, section "15) Admin"), while DDL allows `listing|request|node` in `takedowns.target_type` check (`docs/specs/21__db-ddl.sql`, "Admin takedowns"). Resolution via precedence (`00__read-first.md`): API accepts contract values and maps internally to DB enum values (`public_listing -> listing`, `public_request -> request`).
