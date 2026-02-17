# Thread Handoff

Last updated: 2026-02-17

## Repo and branches
- Repo: `fabric-api`
- Current branch: `main`
- Target branch: `main`

## Current snapshot
- Working tree: clean (`git status --short` empty at handoff prep).
- Latest commit: `e4be4fb chore(pricing): adjust top-up price defaults`.
- Recent relevant commits:
  - `e4be4fb chore(pricing): adjust top-up price defaults`
  - `e9659b7 docs(db): add supabase migration for nodes legal assent columns`
  - `a513b02 docs(ops): add go-live runbook and env var checklist`
  - `b70da37 feat(search): exclude caller-owned results by default`

## What just changed
- Phase 0.5 + Phase 1 implementation items were completed and validated in-thread.
- Production schema drift fix was landed and documented:
  - SQL patch file: `docs/runbooks/sql/2026-02-17_nodes_legal_assent_columns.sql`
  - Runbook section: `docs/runbooks/go-live-cloudrun-stripe.md` (Supabase schema apply)
- Deployed smoke on Cloud Run reached checkout creation successfully at:
  - `https://fabric-api-393345198409.us-west1.run.app`
- Public endpoints confirmed `200`:
  - `/v1/meta`
  - `/openapi.json`
  - `/legal/terms`

## Current blocker
- No code blocker.
- Human-only step remains whenever running deployed smoke end-to-end:
  - complete Stripe Checkout in browser using the returned `checkout_url` so `/v1/me` flips to active.

## Exact next command sequence (PowerShell)
1) Baseline repo check:
   - `git switch main`
   - `git pull --ff-only`
   - `git status -sb`
   - `git log -5 --oneline`
2) Quick production sanity:
   - `$BASE="https://fabric-api-393345198409.us-west1.run.app"`
   - `Invoke-RestMethod "$BASE/v1/meta" | ConvertTo-Json -Depth 10`
3) Run deployed smoke:
   - `.\scripts\smoke-stripe-subscription.ps1 -BaseUrl "$BASE" -PlanCode "basic"`
4) Human-only action:
   - Open the returned `checkout_url` and complete Stripe test checkout.
5) Verify subscription state:
   - `Invoke-RestMethod "$BASE/v1/me" -Method Get -Headers @{ Authorization = "ApiKey <api_key_from_smoke>" } | ConvertTo-Json -Depth 10`
6) If schema drift reappears:
   - run SQL from `docs/runbooks/sql/2026-02-17_nodes_legal_assent_columns.sql` in Supabase SQL Editor, then rerun step 3.

## Next backlog focus
- Remaining TODO focus is Phase 2+ hardening, plus any manual-suspension enforcement gaps still open in `docs/project-files/todo.md`.
