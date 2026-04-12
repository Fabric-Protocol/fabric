# Fabric — Vision (non-normative)

This document is **background and vision only**. It must not introduce requirements that conflict with the normative specs (00/10/20/22/30). When in doubt, defer to the normative files.

---

## Vision line

**Fabric is the shared substrate of allocatable reality.**

---

## What Fabric is

- Fabric is the **canonical backend/protocol** for coordinating allocatable resources between participants (“Nodes”).
- It is **protocol-like infrastructure**, not an escrow/payment intermediary.
- It is **agent-native**: all capabilities are exposed via authenticated APIs; agents may operate as principals (their own Nodes).
- Moira’s Map (MM) can be a specialized UI/client over Fabric.

---

## Core abstractions

- **Participant = Node** (individual, organization, agent)
- **Canonical object = Unit**
- **Quantification = quantity + measure** (explicit; quantity may be unknown/null)

Fabric also treats **Requests** (“wanted units”) as first-class objects parallel to Units/Listings.

---

## Privacy and safety philosophy

- **Private by default.** Marketplace behavior exists only via **opt-in publication projections**.
- **Geo is internal-only** for ranking/filtering; do not reveal precise coordinates node-to-node.
- **No in-platform chat in MVP**; use controlled contact handoff after mutual acceptance + subscriber gating.

---

## Canonical schema direction (high level)

- `nodes`: identity for individuals/orgs/agents.
- `units`: canonical private objects (owner, type, quantity/measure, title/description, status/visibility, timestamps).
- `requests`: canonical private objects parallel to units (needs/wants), publishable/searchable.
- Publication is a **projection**:
  - `public_units` derived from Units (listings)
  - `public_requests` derived from Requests
  - Canonical objects remain the source of truth.

---

## Search and predictable economics

- The primary cost driver is **network-wide search**, not private CRUD.
- Search is authenticated and credit-metered; credits are intended to meter:
  - query execution
  - pagination
  - broadening
  - node inventory expansion endpoints
- Scope-specific required filters are intended to prevent global scraping and keep costs predictable at scale.

---

## Scope model (MVP concept)

Each listing/request has a scope, and searches include scope + required filters:

- `LOCAL_IN_PERSON` → geo/radius required (internal-only geo; coarse public label only)
- `REMOTE_SERVICE` → geo irrelevant; require region constraints (at least country)
- `SHIPS_FROM` / `SHIP_TO` → origin + destination region required (structured region fields)
- `DIGITAL_DELIVERY` → country (default) + optional `delivery_format`

---

## Agent onboarding concept

Two lanes (MVP ships lane 1):

- **Agent-as-Principal (MVP):** agent has its own Node, subscription, API key.
- **Agent-as-Delegate (later):** scoped delegated keys tied to a principal.

---

## Free-tier wedge and cold start

- Free users can create private inventory.
- Free users can create/publish Requests (to seed demand early).
- Monetize network effects primarily through paid search and subscriber-only offer actions.

---

## Offers and contact policy (product posture)

- Search: subscriber-only (credits required).
- Offers: subscriber-only to create/accept/counter.
- Reject: free recipients may reject offers.
- Contact reveal: only after mutual acceptance, and reveal fails until both parties are subscribers.

---

## Verification policy (staged)

- MVP: no phone/email verification required to publish (caps/rate limits are primary controls).
- Future: step-up verification beyond thresholds (publish volume, anomalies).

---

## Cost containment posture (from day 1)

- Token-bucket rate limits with bursts.
- Pagination everywhere; cap response sizes.
- Incremental sync endpoints as needed (future).
- Retry-After only on actual throttling.

---

## Virality plan: referral links for credits

- Each subscriber gets a referral link/code.
- When a referred user qualifies (first successful paid invoice), referrer receives bonus credits.
- Implement with:
  - referral tracking table
  - credit ledger entries
  - Stripe webhook awarding
- Fraud controls:
  - delay (pending → available)
  - clawback on refunds/chargebacks
  - soft monthly caps and anomaly flags
  - self-referral detection (log + flag early)

---

## Open questions (non-exhaustive)

- Type system details (enum vs free-form + subtype; measure kinds).
- Exact credit pricing numbers per scope/query class.
- Whether contact reveal consumes credits (currently: gated by subscription + mutual accept).
- Search stack evolution (Postgres FTS initially; add Typesense/Meili later).
- Agent-as-Delegate permissions model (later).

---

## Pre-Codex packaging checklist (informational)

Before a single “build the MVP” prompt, ensure these are locked in the normative specs:

- Fabric invariants (1 page)
- MVP scope + acceptance criteria
- Exact endpoints + request/response schemas
- Scope matrix (required fields/filters per scope)
- Credit rules (numbers + per-plan budgets)
- Minimal abuse controls + admin endpoints
