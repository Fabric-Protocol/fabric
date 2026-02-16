# Fabric - Decision Log

Format: newest first. Keep entries short; link to spec sections when applicable.

## 2026-02-16 - Production target locked: Supabase direct + Cloud Run
Decision: Production deployment uses Supabase Postgres via direct connection string (non-pooler), with Supabase Data API disabled, and deploy target set to GCP Cloud Run (container-first).
Reason: Keep API-to-DB connectivity explicit through `DATABASE_URL` and standardize deployment path for productionization.
Impact: Production rollout should proceed via Cloud Run image deploy + Cloud Run env var wiring (`DATABASE_URL`, `ADMIN_KEY`, Stripe secrets); no Data API dependency in runtime path.

## 2026-02-16 - ADMIN_KEY boundary (API auth only)
Decision: Treat `ADMIN_KEY` strictly as an API/admin authentication secret, not a PostgreSQL credential.
Reason: Avoid cross-system secret coupling and prevent mistaken DB password rotations during API key changes.
Impact: Postgres authentication remains exclusively governed by `DATABASE_URL`; rotate `ADMIN_KEY` independently.

## 2026-02-16 - Track package-lock.json (repo policy)
Decision: Commit and maintain package-lock.json in git.
Reason: Deterministic installs/CI; avoid dependency drift across machines.
Impact: Any dependency change requires running npm install and committing lockfile changes.

Track package-lock.json (repo policy), merged PR #2, rationale: deterministic installs/CI
ADMIN_KEY is API-only; rotate before deploy; never reuse DB creds.

## 2026-02-16 - Track package-lock.json (repo policy)
Decision: Commit and maintain package-lock.json in git (merged PR #2).
Reason: Deterministic installs/CI; avoids dependency drift.
Impact: Any dependency change requires committing lockfile updates.


## 2026-02-16 - Keep local project-files workflow artifacts untracked
Decision: Local workflow artifacts under `docs/project-files` (workflow/prompt/archive files) and `scripts/thread-switch.ps1` should stay local-only and not be tracked in repo commits.
Reason: Keep shared git history focused on product code/spec/docs changes while allowing local thread workflow files.
Where captured:
- `docs/project-files/thread-notes.md` (2026-02-15/16 merge + cleanup thread)
Impact:
- Local excludes were added via `.git/info/exclude`; `git status` remains clean locally.

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
