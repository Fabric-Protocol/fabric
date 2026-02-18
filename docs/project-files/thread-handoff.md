# Thread Handoff

Last updated: 2026-02-18

## Repo and branches
- Repo: `fabric-api`
- Current branch: `main`
- Target branch: `feat/agent-commerce-go-live` (create from `main`)

## Current snapshot
- Snapshot commands run:
  - `git status -sb` -> `## main...origin/main [ahead 1]` and local untracked `docs/project-files/agent-commerce-fit.md`
  - `git log -1 --oneline` -> `e2c740a project-files: update handoff/todo/decisions from thread notes`
- Last merged product commit on `main`:
  - `1f954c2 merge: feat/self-serve-recovery`
- Cloud Run service:
  - Service: `fabric-api`
  - Region: `us-west1`
  - URL: `https://fabric-api-2x2ettafia-uw.a.run.app`

## What just changed
- Thread notes were updated from the "How to Sell to Agents" alignment review.
- TODO now includes the explicit go-live additions:
  - network stats surface (`registered_nodes_total`, `visible_units_total`)
  - onboarding/search reminders for early network sparsity and referral growth
  - Search Budget Contract response fields + sparse-result reason codes
  - ex-post search diagnostics and near-real-time offer lifecycle notifications
  - explicit onboarding/workflow review tasks
  - Phase 2/3 carry-forward items (quote preview improvements, effort/selectivity split, reputation metrics, compliance metadata/provenance)
- Decision log now records:
  - positioning baseline (coverage/trust/protocol correctness over speed-only moat)
  - collaboration invariants (concise output, no assumptions when source artifacts are missing)

## Current blocker
- No new human-only blocker from this thread.
- Execution blockers from prior threads still open:
  - production email provider secrets for live email recovery smoke
  - holds ownership invariant enforcement
  - `display_name` uniqueness enforcement

## Exact next command sequence (PowerShell)
1) Baseline and branch:
   - `git switch main`
   - `git pull --ff-only`
   - `git switch -c feat/agent-commerce-go-live`
   - `git status -sb`
2) Locate implementation touchpoints for new go-live priorities:
   - `rg -n "search|credits|coverage|events|offer|cursor|meta|registered_nodes|visible_units" src tests docs/specs`
3) Implement network stats surface first:
   - `rg -n "v1/meta|meta" src tests`
   - `npm test -- --runInBand`
4) Implement Search Budget Contract + diagnostics fields:
   - `rg -n "credits_charged|search_strategy|coverage_ratio|returned_count|timeout" src tests`
   - `npm test -- --runInBand`
5) Implement near-real-time offer lifecycle delivery fallback:
   - `rg -n "webhook|events|cursor|offer" src tests`
   - `npm test -- --runInBand`
6) Update onboarding/reminder messaging in API responses/docs paths:
   - `rg -n "bootstrap|search|docs/agents|onboarding|sparsity|referral" src docs`
   - `npm test -- --runInBand`
7) Final quality gates:
   - `npm test`
   - `npm run lint`
   - `npm run build`
   - `git status -sb`

## Carry-forward notes
- Keep thread responses concise by default.
- If any referenced source text/artifact is missing, request it explicitly instead of assuming content.
