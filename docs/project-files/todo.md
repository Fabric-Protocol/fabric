# Fabric - TODO (thread-active)

Last updated: 2026-02-16

## P0 - Post-merge decisions and hygiene
- [ ] Decide repo policy for `package-lock.json` and record it in `docs/project-files/decision-log.md`:
  - A) commit it and keep it updated
  - B) keep it untracked (current after revert)
- [ ] Apply the chosen lockfile policy in a clean follow-up PR.
- [x] Keep local-only project-files artifacts out of git using `.git/info/exclude` (done in this thread).

## P0 - Keep local verification baseline healthy
- [x] Sync `main` and verify status is clean:
  - `git switch main`
  - `git pull`
  - `git status --short`
- [x] Run local test suite on current `main`:
  - `npm test`
- [ ] Ensure PostgreSQL service is running and listening on port 5432:
  - Verify: `netstat -ano | findstr :5432`
- [ ] Ensure `psql` is available in PATH:
  - Verify: `psql --version`
- [ ] Validate repo `.env` values for local DB remain correct:
  - `DATABASE_URL=postgres://postgres:<password>@localhost:5432/fabric`
  - `ADMIN_KEY=<non-empty>`

## P1 - Backend branch follow-ups
- [x] Merge backend API contract/test gap work into `main` (PR #1 merged).
- [ ] If new backend changes are needed, branch from updated `main` and rerun:
  - `npm run typecheck`
  - `npm test`

## P1 - Repo hygiene
- [ ] Ensure `.gitignore` includes: `node_modules/`, `dist/`, `coverage/`, `.env`, `.env.*`
