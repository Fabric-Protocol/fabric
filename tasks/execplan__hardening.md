### Goal
- Harden the existing MVP implementation to eliminate runtime crashes, enforce contract semantics from `docs/specs`, and make quality checks (`lint`, `typecheck`, `test`) executable and passing.

### Sources of truth
- `docs/specs/00__read-first.md`
- `docs/specs/10__invariants.md`
- `docs/specs/20__api-contracts.md`
- `docs/specs/22__projections-and-search.md`
- `docs/specs/25__plans-credits-gating.md`
- `docs/specs/30__mvp-scope.md`
- `docs/specs/21__db-ddl.sql`

### Milestones
#### Milestone 1: Inventory expansion GET runtime safety + idempotency correctness
- Scope: fix GET inventory endpoints to avoid `req.idem` dereference and preserve contract semantics.
- Files likely touched: `src/app.ts`, tests.
- Steps:
  - remove `req.idem` dependency on GET paths.
  - keep idempotency requirements limited to non-GET (per spec).
- Validations (must run): `npm run lint`, `npm run typecheck`, `npm test`.
- Edge cases: GET endpoints with no `Idempotency-Key`.
- Notes/decisions: none.

#### Milestone 2: Test runner reliability
- Scope: make `npm test` runnable in clean environment.
- Files likely touched: `package.json`, tests config/files.
- Steps:
  - ensure chosen test runner is available and wired.
  - verify tests execute without hidden global assumptions.
- Validations (must run): `npm run lint`, `npm run typecheck`, `npm test`.
- Edge cases: environments where npm registry access is blocked.
- Notes/decisions: prefer built-in Node test runner fallback if dependency install blocked.

#### Milestone 3: Real lint + typecheck
- Scope: remove TS ignore lint workaround and add real typecheck gate.
- Files likely touched: `eslint.config.js`, `package.json`, `tsconfig.json`.
- Steps:
  - lint must parse/check TS files.
  - add `npm run typecheck` and run in milestone validation.
- Validations (must run): `npm run lint`, `npm run typecheck`, `npm test`.
- Edge cases: no external eslint TS plugin availability.
- Notes/decisions: may use `tsc --noEmit` as mandatory TS correctness gate.

#### Milestone 4: Referral claim contract completion
- Scope: implement referral code lookup and lock rules.
- Files likely touched: `src/app.ts`, `src/services/fabricService.ts`, `src/db/fabricRepo.ts`, tests.
- Steps:
  - validate request shape.
  - enforce “allowed only if no prior paid Stripe event”.
  - persist claim with proper issuer lookup.
- Validations (must run): `npm run lint`, `npm run typecheck`, `npm test`.
- Edge cases: unknown/disabled referral code, duplicate claims.
- Notes/decisions: map duplicate/invalid states to contract-safe error envelope.

#### Milestone 5: Stripe webhook correctness
- Scope: signature verification + idempotency + required side effects.
- Files likely touched: `src/app.ts`, services/db, `.env.example`, README, tests.
- Steps:
  - verify Stripe signature with 5-minute tolerance.
  - idempotent processing via `stripe_events`.
  - apply subscription updates + monthly grant + referral award logic.
- Validations (must run): `npm run lint`, `npm run typecheck`, `npm test`.
- Edge cases: replayed events, out-of-order events.
- Notes/decisions: use HMAC verification and event payload constraints documented in contracts.

#### Milestone 6: Search validation completeness
- Scope: enforce per-scope required filter constraints and numeric bounds.
- Files likely touched: `src/app.ts` + tests.
- Steps:
  - enforce required filter combinations.
  - enforce ranges (radius_miles, max_ship_days).
  - reject invalid/missing constraints with 422 envelope.
- Validations (must run): `npm run lint`, `npm run typecheck`, `npm test`.
- Edge cases: unknown keys + missing required keys.
- Notes/decisions: none.

#### Milestone 7: Coverage hardening for invariants
- Scope: add tests for idempotency replay/conflict, metering-on-200, soft delete, projection rebuild, failure contracts.
- Files likely touched: `tests/*`, possibly app/service/db bugfixes.
- Steps:
  - implement test setup helpers.
  - add endpoint tests for required invariant checklist.
- Validations (must run): `npm run lint`, `npm run typecheck`, `npm test`.
- Edge cases: deterministic idempotency with identical payload and different payload.
- Notes/decisions: none.

## Completion checklist (must be true)
- All required endpoints/contracts for this task match `docs/specs/20__api-contracts.md`.
- Canonical error envelope is used everywhere.
- Tests added/updated and passing.
- Lint + typecheck are real and passing.
- README / env docs updated.

## Decisions / surprises log
- Ambiguity persisted from prior plan: API takedown request enum `public_listing|public_request|node` vs DDL check `listing|request|node`; resolved by API-level mapping to DB enum per precedence (`00__read-first.md` > API contracts for external shape). (`docs/specs/20__api-contracts.md` section 15, `docs/specs/21__db-ddl.sql` Admin takedowns)

## Completion notes
- Final hardening completed on `feat/mvp-scaffold`.
- Addressed remaining contract mismatches:
  - bootstrap referral claim recording,
  - auth key prefix masking format,
  - checkout.session.completed webhook side effects and event id idempotency,
  - projection rebuild takedown exclusions.
- Replaced string-assertion tests with endpoint-level HTTP tests using `app.inject`.
