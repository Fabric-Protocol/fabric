# Thread Handoff

Last updated: 2026-02-17

## Repo and branches
- Repo: `fabric-api`
- Current branch: `main`
- Target branch: `main`

## Current git snapshot
- Last commit: `9b4b31c` (`db:bootstrap: make trigger creation idempotent`)
- Working tree: clean (`git status --short` empty)

## What just changed
- Local DB bootstrap rerun failure was fixed:
  - Root cause was non-idempotent `CREATE TRIGGER` statements in `docs/specs/21__db-ddl.sql`.
  - Triggers now use `DROP TRIGGER IF EXISTS ... ON ...` before `CREATE TRIGGER` for `nodes`, `subscriptions`, `units`, `requests`, `offers`.
- Validation completed:
  - `netstat -ano | findstr ":5432"` showed LISTENING on `0.0.0.0:5432` and `[::]:5432`.
  - `psql --version` returned `psql (PostgreSQL) 17.8`.
  - `npm run db:bootstrap` succeeded twice in a row.
  - `npm test` passed (`17/17`).

## Current blocker
- No active blocker.
- Next operational step is thread switch bookkeeping only.

## Operator preferences captured from thread-notes
- Use explicit one-block Codex instruction headers (repo/branch/mode/execution/model/reasoning/permissions/context).
- Prefer run-to-completion checklists with SUCCESS/BLOCKED outcome.
- Keep instructions to next 1-2 concrete steps; leave later steps as placeholders.
- Codex executes all local/CLI actions; user only handles unavoidable UI/credential work.

## Exact next command sequence
1. `git switch main`
2. `git pull`
3. `git status --short`
4. `npm run db:bootstrap`
5. `npm run db:bootstrap`
6. `npm test`
7. `powershell -ExecutionPolicy Bypass -File .\scripts\thread-switch.ps1 -Slug "bootstrap-idempotent"`
8. `# Start a new ChatGPT thread and paste only docs/project-files/thread-handoff.md`

## Handoff objective for next thread
- Continue from clean `main` after thread switch and execute the next bounded task with the operator protocol above.
