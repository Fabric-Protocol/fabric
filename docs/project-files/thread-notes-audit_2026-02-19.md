# THREAD NOTES RECONCILIATION REPORT

Scope audited:
- `docs/project-files/thread-notes.md`
- `docs/project-files/thread-notes-archive/*.md`

Method (deterministic):
- Extracted 361 candidate lines matching: `Decision|TODO|Add|Remove|Change|Phase|Invariant|Must|We will|Support|Implement|billing|402|enforcement|auth|ledger`.
- Reconciled each candidate against:
  - `docs/project-files/decision-log.md`
  - `docs/project-files/todo.md`
  - `docs/specs/*`
- Ambiguous equivalents are recorded as `PARTIALLY_INTEGRATED`.

## Missing Decisions (NOT_FOUND)
| Thread | Item | Notes |
|---|---|---|
| - | None identified after excluding section headers/metadata-only lines. | Explicit decision statements from audited notes were found in canonical logs or marked partial where wording diverged. |

## Missing TODOs (NOT_FOUND)
| Thread | Item | Notes |
|---|---|---|
| `2026-02-17_2252__agent-commerce-fit-todos.md` | `1) Add network stats surface:` | Not found in `docs/project-files/todo.md` as a standalone task (line duplicated in `2026-02-17_2334__fabric-contact-comms-messaging-trust-todos.md`). |
| `2026-02-17_2252__agent-commerce-fit-todos.md` | `2) Add onboarding + response-level reminders:` | Not found as an explicit TODO line (line duplicated in `2026-02-17_2334__fabric-contact-comms-messaging-trust-todos.md`). |
| `2026-02-17_2252__agent-commerce-fit-todos.md` | `4) Add ex-post search quality diagnostics (minimum viable):` | Not found in `docs/project-files/todo.md` as an explicit task (line duplicated in `2026-02-17_2334__fabric-contact-comms-messaging-trust-todos.md`). |
| `2026-02-17_2252__agent-commerce-fit-todos.md` | `- implement as short headers on key agent check-in/search responses + docs text` | Not found as a concrete implementation TODO (line duplicated in `2026-02-17_2334__fabric-contact-comms-messaging-trust-todos.md`). |

## Partial Integrations
| Thread | Item | Where Reflected | Gaps |
|---|---|---|---|
| `thread-notes.md` | `Docs/specs: explicitly document API-key auth (Authorization: ApiKey <api_key>); email required at account creation as backup; email not required for normal auth.` | `docs/specs/20__api-contracts.md:11`, `docs/specs/00__read-first.md:47`, `docs/project-files/decision-log.md` | API-key auth is documented; bootstrap request still allows `"email": "string|null"` in `docs/specs/20__api-contracts.md:101`. |
| `thread-notes.md` | `Bootstrap/onboarding: require setup/issuance of recovery public key at signup (agent must retain); document that agents have two self-serve recovery lanes (pubkey + email).` | `docs/project-files/todo.md:229`, `docs/project-files/decision-log.md:17` | `docs/specs/20__api-contracts.md:103` still shows `"recovery_public_key": "string|null"` for bootstrap request. |
| `thread-notes.md` | `Events: implement near-real-time offer lifecycle notifications:` | `docs/project-files/todo.md:232`, `docs/project-files/decision-log.md:25` | No `/events?since=cursor` endpoint contract found in `docs/specs/*`. |
| `thread-notes.md` | `Add post-accept report/complaint endpoint:` | `docs/project-files/todo.md:249`, `docs/project-files/decision-log.md:58` | No report endpoint contract or payload enum found in `docs/specs/*`. |
| `thread-notes.md` | `Add trust features + search routing down-rank; add enforcement ladder good|watch|limited|suspended|banned with admin overrides + audit log.` | `docs/project-files/todo.md:254` | No trust-ladder states/contract in `docs/specs/*`. |

## Spec Drift
| Thread | Item | Expected Spec Area | Status |
|---|---|---|---|
| `thread-notes.md` | `Docs/specs: explicitly document API-key auth (Authorization: ApiKey <api_key>); email required at account creation as backup; email not required for normal auth.` | `docs/specs/20__api-contracts.md` (`POST /v1/bootstrap` request rules) | Partial: auth documented; account-creation email requirement not locked (`email` remains nullable in request shape). |
| `thread-notes.md` | `DB/API: add optional node messaging_handles[] and validations (length/charset; sanitize URLs); store as unverified user-provided.` | `docs/specs/20__api-contracts.md` (node/public contact surfaces), `docs/specs/22__projections-and-search.md` | Not reflected in specs (`messaging_handles` textual match not found). |
| `thread-notes.md` | `API contract: update reveal-contact response to include messaging_handles[] (retain email required; phone optional).` | `docs/specs/20__api-contracts.md` (`POST /v1/offers/{offer_id}/reveal-contact`) | Not reflected: response currently lists only `email` and `phone` (`docs/specs/20__api-contracts.md:1501`). |
| `thread-notes.md` | `webhooks + polling cursor fallback (/events?since=cursor)` | `docs/specs/20__api-contracts.md` (event endpoint), optionally `docs/specs/22__projections-and-search.md` (event payload shape) | Not reflected in specs (`/events?since=cursor` not found). |
| `thread-notes.md` | `Add post-accept report/complaint endpoint:` | `docs/specs/20__api-contracts.md` (new endpoint), `docs/specs/21__db-ddl.sql` (persistence), `docs/specs/25__plans-credits-gating.md` or `docs/specs/10__invariants.md` (limits/enforcement) | Not reflected in specs (endpoint/reason enum/rate-limit constants not found). |

## Superseded Items
| Thread | Item | Superseded By |
|---|---|---|
| `2026-02-16_1711__billing-e2e-smoke.md` | `POST /v1/billing/checkout-session → Stripe Checkout → checkout.session.completed webhook → /v1/me shows subscription.status=active, plan=plus, credits_balance=1700.` | `docs/project-files/decision-log.md` entry `2026-02-17 - Canonical paid-plan surface excludes plus` (canonical plan set `free|basic|pro|business`). |
| `2026-02-17_2252__agent-commerce-fit-todos.md` | `3) Add “Search Budget Contract” fields to search responses for credit transparency:` | Canonical search budget contract now locked in `docs/specs/20__api-contracts.md` and `docs/specs/22__projections-and-search.md` with different field set (`budget` + `breakdown` + `coverage`). |
| `2026-02-17_2334__fabric-contact-comms-messaging-trust-todos.md` | `3) Add “Search Budget Contract” fields to search responses for credit transparency:` | Same supersession as above; duplicate archived thread note. |

## Totals
- Reviewed candidate items: `361`
- Missing (NOT_FOUND, actionable rows listed above): `4`
- Partial integrations listed: `5`
- Superseded listed: `3`
