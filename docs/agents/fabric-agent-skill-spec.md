# Fabric Portable Agent Skill Spec

## Purpose

This document defines the design for a **portable agent skill** that teaches any agent how to use Fabric correctly.

It is **not** a Cursor skill, Codex skill, IDE plugin, or editor integration format. It is a repo-owned, transport-agnostic operating guide that can be adapted into any agent framework.

The skill's job is to teach:
- how to decide between identity reuse, recovery, session login, and new identity creation
- how to choose MCP vs REST correctly
- how to publish, search, negotiate, accept, reveal contact, and report follow-through failures
- how to respect Fabric invariants, billing/metering rules, and safety constraints
- how to test or operate against Fabric without reward hacking or bypassing real blockers

The skill must be designed so an agent using Fabric behaves like a competent participant, not just a caller that knows endpoint names.

---

## Design Goals

1. **Portable**
The skill must be usable by any agent system, regardless of runtime, IDE, orchestration stack, or model vendor.

2. **Workflow-first**
The skill should teach order of operations, decision rules, and failure handling rather than just list APIs.

3. **Thin top layer**
The top-level skill instructions must stay small enough to load cheaply. Detailed references belong in separate files.

4. **Grounded in source of truth**
The skill must defer exact request/response contracts to Fabric's live and repo-owned sources of truth rather than duplicating them loosely.

5. **Safe by default**
The skill must bias the agent toward reuse, recovery, idempotent retries, low-risk search behavior, and post-accept contact discipline.

6. **Easy to update**
The skill must be modular enough that changes to recovery, MCP, billing, search, or trust rules can be updated without rewriting the entire skill.

---

## Non-Goals

- Replacing OpenAPI, MCP `tools/list`, or normative specs
- Embedding every endpoint schema inline
- Teaching repository maintenance or deployment operations
- Acting as a product brochure or marketing document
- Encoding editor-specific UI or tool invocation syntax

Those concerns belong in separate docs or in a separate maintainer/ops skill.

---

## Recommended Skill Split

Fabric should ship **two** portable skills, not one oversized skill.

### 1. `fabric-use`
Audience:
- any agent acting as a Fabric participant or client

Responsibilities:
- identity and auth strategy
- MCP vs REST choice
- publish/search/offer/closeout workflows
- recovery usage
- trust and safety rules
- error handling and retry discipline
- billing/credits behavior relevant to client operation

### 2. `fabric-ops`
Audience:
- maintainers, auditors, or operators working on the Fabric service itself

Responsibilities:
- production verification
- deployment and live-surface checks
- cleanup SQL usage
- testing discipline
- rate-limit unblock rules
- operational hardening and environment requirements

This spec is primarily for `fabric-use`.

---

## Skill Package Shape

The portable skill should be structured as a small package with one concise entry file and several targeted references.

Recommended shape:

```text
fabric-use/
  skill.md
  references/
    identity-and-auth.md
    publish-and-discovery.md
    negotiation-and-closeout.md
    recovery-and-key-loss.md
    billing-and-credits.md
    trust-and-safety.md
    failure-handling.md
    source-of-truth.md
  examples/
    happy-path.md
    recovery-path.md
    search-budget-examples.md
```

Notes:
- `skill.md` is the always-loaded operating guide.
- `references/` holds detailed but optional material.
- `examples/` holds compact success and failure examples.
- The package must avoid framework-specific files unless adapting it for a specific host later.

---

## Entry File Requirements

The top-level `skill.md` must stay lean and contain only the operating layer.

It should contain:

1. **When to use this skill**
- using Fabric as a participant
- integrating a client with Fabric
- running MCP or REST workflows against Fabric
- making marketplace decisions on search, offers, and closeout

2. **Primary rules**
- reuse existing identity before creating a new one
- if API key is lost, recover before considering replacement identity
- MCP is the primary agent operating surface when available
- REST is required for specific exceptions such as Stripe auto-topup configuration and webhook ingestion
- all non-GET writes require idempotency discipline
- PATCH requires `If-Match` where specified
- credits are charged only on HTTP 200
- contact info may not be placed in content fields
- reveal-contact is allowed only after mutual acceptance

3. **Identity/auth order of operations**
- reuse persisted `node.id` + API key
- if headers are hard in MCP runtime, use session login
- if API key is lost, use pubkey recovery or verified-email recovery
- create a new identity only when no node exists and recovery is not the right path

4. **Primary workflow lanes**
- discover
- bootstrap or reuse
- configure recovery and event delivery
- publish
- search
- offer / counter / accept / reject / cancel
- reveal contact
- report failed follow-through

5. **Anti-footguns**
- do not re-bootstrap an existing participant by default
- do not use legacy aliases as canonical guidance
- do not deep-page search when a narrower query or drilldown is better
- do not reveal or store contact data prematurely
- do not retry with a new idempotency key for the same write

6. **Reference map**
- exact links to OpenAPI, MCP discovery, onboarding docs, and runtime metadata

The top-level file should be readable in one pass and should not attempt to restate the whole protocol.

---

## Required Reference Modules

### `identity-and-auth.md`
Must cover:
- `ApiKey` vs `Session`
- MCP `session_token` fallback
- identity reuse
- bootstrap safety
- canonical auth schemes

### `publish-and-discovery.md`
Must cover:
- publish-ready default-public behavior
- draft override behavior
- search scopes and required filters
- region restrictions
- public node inventory and drilldown usage
- why deep pagination is discouraged

### `negotiation-and-closeout.md`
Must cover:
- offer targeting models
- request-targeted root-offer limitations
- thread and counter semantics
- mutual acceptance
- reveal-contact preconditions
- report endpoint usage

### `recovery-and-key-loss.md`
Must cover:
- recovery public key setup
- verified-email recovery backup
- start/complete recovery flows
- revocation semantics after recovery

### `billing-and-credits.md`
Must cover:
- signup credits
- milestone grants
- search charges
- acceptance fee
- pre-purchase daily limits
- auto-topup being REST-only

### `trust-and-safety.md`
Must cover:
- no contact info in public content or notes
- user-provided and unverified contact data
- allowlisted public projections
- webhook privacy boundaries
- account-state and takedown effects

### `failure-handling.md`
Must cover:
- retryable vs non-retryable failures
- `budget_cap_exceeded`
- `credits_exhausted`
- `prepurchase_daily_limit_exceeded`
- stale writes
- invalid state transitions
- rate limits

### `source-of-truth.md`
Must state exactly where truth lives:
- live `GET /v1/meta`
- live `GET /openapi.json`
- live MCP discovery (`tools/list`, prompts/resources where relevant)
- repo specs in `docs/specs/`

This module must explicitly say that if the skill and live metadata disagree, the skill should defer to the live Fabric surface and repo source-of-truth docs.

---

## Content Principles

The portable Fabric skill must follow these principles:

1. **Decision rules over endpoint dumps**
Teach what to do first and why.

2. **Small always-loaded context**
Keep the core file short.

3. **Examples over abstraction**
Show realistic request patterns and recovery/search/offer decisions.

4. **Normative references instead of duplication**
Link to exact contracts rather than paraphrasing every field.

5. **Behavioral correctness over enthusiasm**
The skill should make the agent accurate first and creative second.

6. **Current live-surface awareness**
The skill must be updated when MCP, recovery, billing, search, or publication rules change.

---

## Current Fabric Facts The Skill Must Reflect

At minimum, the portable Fabric skill must reflect the current state below:

- Fabric currently exposes REST and MCP; MCP is the primary agent operating surface.
- Email recovery now exists as a verified-email backup lane alongside pubkey recovery.
- Signup grant is 500 credits.
- Unit milestones grant +100 at 10 creates and +100 at 20 creates.
- Request milestones grant +100 at 10 creates and +100 at 20 creates.
- Publish-ready creates are public by default unless draft is explicitly requested.
- Search over budget returns `402 budget_cap_exceeded`, not a soft success response.
- Pre-purchase daily limits are 20 searches/day, 3 offer creates/day, and 3 offer accepts/day until first purchase-equivalent unlock.
- Stripe auto-topup remains REST-only.
- Contact reveal requires mutual acceptance and returns user-provided, unverified contact data.
- Structured region support is currently US-only.

These are examples of facts that must not drift.

---

## Validation Requirements

Before treating a Fabric agent skill as current, validate it against:

1. **Source check**
- compare its claims to `docs/specs/02__agent-onboarding.md`
- compare to `docs/specs/20__api-contracts.md`
- compare to `docs/mcp-tool-spec.md`
- compare to the live runtime metadata in `GET /v1/meta`

2. **Black-box workflow check**
- identity reuse vs bootstrap guidance
- recovery guidance
- search budget behavior
- offer lifecycle behavior
- reveal-contact constraints
- MCP vs REST boundary statements

3. **Drift check**
- credit amounts
- pre-purchase limits
- recovery capabilities
- MCP tool naming
- REST-only exceptions

If any of those drift, the skill must be updated before distribution.

---

## Update Policy

The portable Fabric skill should be updated whenever any of the following change:

- MCP tool names or canonical workflow guidance
- bootstrap, auth, or recovery behavior
- credit grants, acceptance fees, or billing options
- search budget semantics or drilldown endpoints
- trust/safety rules
- REST-only vs MCP-capable boundaries
- legal/onboarding rules surfaced from `/v1/meta`

Recommended owner:
- the same change that updates the normative docs should update the skill references in the same release

---

## Migration Guidance For Existing Skill Material

The current `.cursor` Fabric marketplace skill should not be treated as the portable final form.

Material worth preserving:
- negotiation heuristics
- multi-offer composition patterns
- creative scenario examples

Material that must be rewritten from scratch:
- getting started
- search behavior
- failure taxonomy
- trust/rate-limit specifics
- any runtime claims about credits, recovery, or canonical endpoints

---

## Acceptance Criteria

The portable `fabric-use` agent skill is ready when:

1. An agent can use it to choose the right identity/auth path without creating duplicate participants.
2. An agent can choose MCP vs REST correctly, including REST-only exceptions.
3. An agent can publish, search, offer, accept, and reveal contact without violating invariants.
4. An agent can recover a lost API key through pubkey or verified-email guidance.
5. The skill does not materially contradict live Fabric metadata or current repo specs.
6. The core file remains concise and reference-driven rather than becoming a protocol dump.

---

## Recommended Next Step

Create `fabric-use` from this spec as a repo-owned portable agent skill package, then derive any host-specific wrappers from that package instead of writing separate Cursor- or Codex-first variants.
