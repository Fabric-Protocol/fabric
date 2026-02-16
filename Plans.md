# Plans.md (Agent Execution Planning)

This file is a planning template for Codex/agents. It is NOT a product spec.
Product requirements live under `docs/specs/` and conflicts resolve per `docs/specs/00__read-first.md`.

## When to create an ExecPlan
Create an ExecPlan for any change that touches more than ~3 files, adds a new subsystem (auth, DB, projections, credits), or spans multiple endpoints.

- Create/update ExecPlans under `/tasks/`.
- Name: `tasks/execplan__<topic>.md` (example: `tasks/execplan__projections-and-search.md`).
- Keep the ExecPlan updated as milestones complete.

## ExecPlan Template (copy for each task)
Required Codex instruction header fields:

Model
Reasoning (low/medium/high/extra high)
IDE Context (what it should rely on: repo files only vs include Project Files/spec pack)
Planning (on/off)
Execution (local vs cloud)
Permissions (default vs full access)

### Goal
- What outcome should exist when done (must be verifiable).

### Sources of truth
- List the exact spec files from `docs/specs/` you will follow for this task.

### Milestones
#### Milestone 1: <title>
- Scope:
- Files likely touched:
- Steps:
- Validations (must run):
- Edge cases:
- Notes/decisions:

#### Milestone 2: <title>
- Scope:
- Files likely touched:
- Steps:
- Validations (must run):
- Edge cases:
- Notes/decisions:

#### Milestone 3: <title>
- Scope:
- Files likely touched:
- Steps:
- Validations (must run):
- Edge cases:
- Notes/decisions:

## Completion checklist (must be true)
- All required endpoints/contracts for this task match `docs/specs/20__api-contracts.md`.
- Canonical error envelope is used everywhere (per invariants).
- Tests added/updated and passing.
- Lint/format passing (if present).
- README / docs updated if behavior changes.

## Decisions / surprises log
- Record any conflicts or ambiguities found in specs (quote file + section) and how they were resolved per precedence.
