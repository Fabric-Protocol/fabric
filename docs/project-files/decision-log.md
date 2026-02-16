# Fabric - Decision Log

Format: newest first. Keep entries short; link to spec sections when applicable.

## 2026-02-15 - Local verification baseline set to PostgreSQL 17 + `fabric` database
Decision: Local MVP verification uses PostgreSQL 17 with a local `fabric` database on `localhost:5432`.
Reason: `npm run db:bootstrap` failed with `ECONNREFUSED` until a local Postgres instance was installed and initialized.
Where captured:
- `docs/project-files/thread-notes.md` (What changed, Errors / fixes, Next step)
Impact:
- `.env` must set `DATABASE_URL=postgres://postgres:<password>@localhost:5432/fabric` before bootstrap/tests.

## 2026-02-15 - MVP backend stack locked (Stack A)
Decision: MVP backend stack is:
- Node.js (LTS) + TypeScript
- Fastify
- Postgres
- Cloud Run-compatible Dockerfile (container-first deploy)

Where captured:
- `docs/specs/30__mvp-scope.md` (Stack locked)
- `docs/specs/01__implementation-map.md` (Runtime/DB assumptions)
- `docs/specs/20__api-contracts.md` (removed "Vercel Cron" wording)

Implementation note:
- Docs stack-lock commit: `e26d7c7`
- Merged to `main` via merge commit: `12fb556`

## 2026-02-15 - Specs bundle is the source of truth for agents/Codex
Decision: Specs live under `docs/specs/` and are the canonical reference for implementation and changes.

Where captured:
- `docs/specs/00__read-first.md` precedence list
- `AGENTS.md` pointers and doc mapping

## 2026-02-15 - Local verification required before merging backend scaffold PR
Decision: Do not merge code scaffold PR until `npm run db:bootstrap` + `npm test` pass locally with a real Postgres instance.

Reason:
- tests fail with 500s if DATABASE_URL / Postgres is not available.

## 2026-02-15 - Git hygiene decisions (temporary)
Decision:
- Do not commit unrelated/unplanned artifacts into docs-only changes.
- Keep build outputs out of git via `.gitignore` (`node_modules/`, `dist/`, `coverage/`, `.env*`).

Open decision:
- Whether `package-lock.json` is committed as policy (recommended) vs kept untracked.

## (Add future decisions below)
Template:
## YYYY-MM-DD - <Decision title>
Decision:
Reason:
Where captured:
Impact:
