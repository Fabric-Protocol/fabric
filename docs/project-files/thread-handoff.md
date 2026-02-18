# Thread Handoff

Last updated: 2026-02-18

## Repo and branches
- Repo: `fabric-api`
- Current branch: `main`
- Target branch: `feat/agent-commerce-go-live` (create from `main`)

## Current snapshot
- Snapshot commands run:
  - `git status -sb` -> `## main...origin/main`
  - `git branch --show-current` -> `main`
  - `git log -1 --oneline` -> `81f5a35 docs: add agent-commerce-fit reference`
- Working tree state at snapshot: clean.

## What just changed
- Synced project files from latest `docs/project-files/thread-notes.md`.
- Added explicit Phase 0.5 TODO to track workflow guidance from thread notes:
  - concise responses
  - request missing artifacts instead of assumptions
- Preserved existing go-live deltas and prior TODO/decision history.

## Current blocker
- No new human-only blocker introduced in this thread.
- Existing open blockers/workstreams remain:
  - production email provider secrets for live email recovery smoke
  - holds ownership invariant enforcement
  - `display_name` uniqueness enforcement
  - agent-commerce go-live deltas (network stats, search budget contract, diagnostics, eventing)

## Exact next command sequence (PowerShell)
1) Baseline + branch:
   - `git switch main`
   - `git pull --ff-only`
   - `git switch -c feat/agent-commerce-go-live`
   - `git status -sb`
2) Re-read normative specs before coding:
   - `Get-Content docs/specs/00__read-first.md`
   - `Get-Content docs/specs/10__invariants.md`
   - `Get-Content docs/specs/20__api-contracts.md`
3) Locate implementation touchpoints:
   - `rg -n "meta|search|credits|coverage|events|offer|cursor|registered_nodes|visible_units" src tests`
4) Implement and test in order:
   - network stats surface (`registered_nodes_total`, `visible_units_total`)
   - Search Budget Contract response fields + sparse-result reason codes
   - ex-post search diagnostics + offer lifecycle eventing fallback (`/events?since=cursor`)
   - `npm test`
5) Keep prior blockers on track in same branch only if scope allows:
   - email provider wiring smoke prerequisites
   - holds invariant enforcement
   - `display_name` uniqueness enforcement

## Carry-forward notes
- Keep thread outputs concise.
- If a required source artifact is missing, request it explicitly before implementation.
