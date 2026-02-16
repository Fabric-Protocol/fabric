# Fabric - TODO (thread-active)

Last updated: 2026-02-16

## P0 - Unblock local verification on backend branch
- [ ] Confirm branch is `codex/implement-fabric-api-mvp-backend-service` and sync with `git pull`.
- [ ] Ensure PostgreSQL service is listening on `localhost:5432` (`netstat -ano | findstr :5432`).
- [ ] Create `.env` from `.env.example`.
- [ ] Set `.env` values: `DATABASE_URL=postgres://postgres:<password>@localhost:5432/fabric` and `ADMIN_KEY=<non-empty>`.
- [ ] Run `npm run db:bootstrap`.
- [ ] Run `npm test`.
- [ ] If either command fails, capture full bootstrap output and first failing test block.

## P1 - Merge readiness
- [ ] Run `npm run typecheck` once bootstrap/tests are passing.
- [ ] Merge `codex/implement-fabric-api-mvp-backend-service` into `main` after local verification succeeds.

## P2 - Cleanup decisions
- [ ] Add PostgreSQL `bin` to PATH to avoid full-path `psql` calls.
- [ ] Decide and document repo policy for `package-lock.json`.
