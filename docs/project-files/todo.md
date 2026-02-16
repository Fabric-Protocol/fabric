# Fabric — TODO (thread-active)

Last updated: 2026-02-16

## P0 — Unblock local verification (required before merging backend code PR)
- [ ] Confirm you are on `codex/implement-fabric-api-mvp-backend-service` and up to date:
  - `git switch codex/implement-fabric-api-mvp-backend-service`
  - `git pull`
- [ ] Ensure PostgreSQL service is running and listening on port 5432:
  - Verify: `netstat -ano | findstr :5432`
- [ ] Ensure `psql` is available in PATH (Postgres bin):
  - Verify: `psql --version`
- [ ] Create DB `fabric` (once):
  - In `psql`: `CREATE DATABASE fabric;`
- [ ] Configure repo env:
  - Create `.env` from `.env.example`
  - Set `DATABASE_URL=postgres://postgres:<password>@localhost:5432/fabric`
  - Set `ADMIN_KEY=<non-empty>`
- [ ] Run DB bootstrap:
  - `npm run db:bootstrap`
- [ ] Run tests:
  - `npm test`
- [ ] If failures: capture logs and classify root cause:
  - DB connectivity/service/credentials
  - DB/schema/bootstrap issues
  - Env var issues
  - Contract mismatch
  - Node version/toolchain mismatch (LTS vs non-LTS)

## P0 — Confirm runtime/toolchain matches “stack A”
- [ ] Stack A is canonical: Node.js (LTS) + TypeScript + Fastify + Postgres + Cloud Run-compatible Dockerfile.
- [ ] If issues appear, align Node to LTS (v22.x recommended).

## P1 — Merge backend scaffold PR once locally verified
- [ ] Verify on branch `codex/implement-fabric-api-mvp-backend-service`:
  - `npm run typecheck`
  - `npm test`
- [ ] Merge into `main` after local verification passes.

## P1 — Repo hygiene
- [ ] Ensure `.gitignore` includes: `node_modules/`, `dist/`, `coverage/`, `.env`, `.env.*`
- [ ] Decide policy for `package-lock.json` and record it in decision-log:
  - A) commit it (recommended for deterministic installs)
  - B) keep untracked (current)
  - C) ignore repo-wide (only if intentional)
