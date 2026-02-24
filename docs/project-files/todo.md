# Fabric - TODO (thread-active)

Last updated: 2026-02-24




### Phase 0.5 — Search economics + onboarding (latest thread notes)
- [ ] Review agent onboarding docs and flows for gaps (separate pass after copy updates).
- [ ] Review full agent workflows for MVP feature/anti-abuse gaps:
  - search -> offer -> acceptance -> contact reveal -> fulfillment


### Phase 0.5 / Phase 1 — Payments + enforcement (latest thread notes)
- [ ] Keep "credit packs" terminology consistent in Stripe display naming and docs.
- [ ] Add `GET /internal/admin/daily-metrics` as the source for daily email digest:
  - abuse/throttles/suspensions
  - Stripe + credits health
  - liquidity/reliability metrics
  - webhook health (when applicable)
- [x] Lightweight MCP server (read-only, pre–go live):
  - expose safe read operations only (search, get unit/request, get offer, get events, get credits)
  - no mutations
  - thin wrapper over existing HTTP API (no new business logic)
  - strict allowlist + rate limits
  - publish `mcp_url` via GET /v1/meta
  - document briefly in /docs/agents
- [ ] Improve 402 credits-exhausted response:
  - replace “not enough credits” with actionable message
  - include direct “get credits” URL (Stripe Checkout)
  - keep response machine-readable for agents  

### Phase 0.5 — Workflow hardening (latest thread notes)
- [ ] Update `AGENTS.md` DB/DDL wording:
  - explicitly state generated SQL scripts are for manual Supabase execution, not agent execution

### Phase 0.5 — Pricing + grants + acceptance fee (latest thread notes)
- [ ] Create `supabase_migrations/2026-02-23__apply_credit_ledger_types.sql` for the new credit-ledger constraint migration, and run APPLY+VERIFY in Supabase before go-live (manual step).

### Phase 0.5 — Current phase (latest thread notes)
- [ ] Add/maintain `agent_toc` schema in OpenAPI + regression tests.
- [ ] Enforce "no contact info in item content" across all relevant text-bearing objects (verify future objects don't bypass validation).

### Next Phase (ranked by likelihood)
High likelihood:
- [ ] Encrypt webhook secrets at rest (KMS/pgcrypto/vault) with rotation plan and docs update.
- [ ] Expand enforcement coverage to any additional text fields/endpoints that can surface publicly (publish/projection paths, future objects).
- [ ] Internationalization baseline (Phase 1):
  - verify Supabase/Postgres UTF-8 encoding (manual SQL check)
  - add optional `language_tag` (BCP-47) for user-entered free-text in units/requests
  - ensure Unicode-safe normalization for matching while preserving original text
  - keep structured discovery fields language-neutral and first-class (categories/capabilities/regions)
- [ ] Add crypto pay-per-use rail (x402-like) for wallet-based top-ups/payment-required flows with node credit-attribution mapping.
- [ ] Support saved payment method + Stripe off-session top-ups for agents (auto-top-up product logic on low-credit threshold).
- [ ] Saved searches / scheduled alerts after corpus density improves.
- [ ] Revisit supply-vs-demand pricing divergence using observed market behavior.
- [ ] Compute and surface visibility/discoverability scoring (private first; weighting to be decided).
- [ ] Implement photos/media using future `unit_media` references (no DB blobs); select storage provider later.
- [ ] Revisit basket/bundle pricing mode once sparse-corpus risk is lower.
- [ ] Add post-accept report/complaint endpoint with one-report-per-side-per-offer uniqueness and reason enum (`no_show|unresponsive|refused_after_accept|fraud_suspected|other`).
- [ ] Define trust policy constants:
  - `REPORT_WINDOW_DAYS` (suggested default: 14)
  - per-node report rate limits
  - conservative enforcement threshold based on unique counterparties
- [ ] Add trust enforcement ladder and routing effects:
  - `good|watch|limited|suspended|banned`
  - admin override path and audit logging
- [ ] Revisit drilldown/storefront handling for marketplace nodes (special search lanes vs higher caps) once corpus grows.
Medium likelihood:
- [ ] Add explicit retry/backoff and failure visibility docs/runbook for webhook delivery (timeouts/5xx behavior, operational signals).
- [ ] Cross-language free-text discovery (Phase Next):
  - decide bridging approach (pivot MT fields vs multilingual embeddings vs hybrid) with search budget/credit metering integration
  - add indexing/storage, abuse controls, and diagnostics for cross-language matches
- [ ] Add moderation heuristics/pattern flags and escalation logic (Phase 2).
- [ ] Add bounded lexical expansion mode as opt-in, while preserving diagnostics.
- [ ] Improve contact-info detector to reduce false positives/negatives (tighter patterns, allowlist of safe "@" usage if needed) + add fuzz/edge-case tests.
- [ ] Add geo widening tiers (`geo_addon`) when widening becomes a real knob; keep breakdown stable.
- [ ] Consider batch drilldown "multi-category peek" endpoint if UX needs fewer calls (ensure anti-scrape controls).
- [ ] Refine search-by-node operational pricing (cheap shallow pages + anti-scrape guardrails).
- [ ] Add storefront-tier higher limits for paid/verified nodes after abuse controls mature.
- [ ] Add messaging/negotiation threads for nuanced deals with moderation safeguards.
Low likelihood:
- [ ] Provide machine-readable "content_rules" block as a separately versioned artifact (if `/v1/meta` grows too large).
- [ ] Remove `broadening_cost` from breakdown in a versioned API bump (currently retained for compatibility).
- [ ] Add optional webhook receiver helper snippet/library in SDK (signature verification plus dedupe scaffolding).
- [ ] Add regions catalog / stricter ISO 3166-2 validation endpoint; keep current regex as format-only until catalog exists.

### Decisions locked
- Offer/deal progression is not subscriber-gated; use suspension/legal/rate-limit controls.

## Phase 1 — Near-term product completeness

### Phase 1.5 (High Priority After Go Live)
- [ ] Crypto pay-ins via Bcon (agent-first rail):
  - default: USDC on Base
  - create invoice → return pay-to address + amount
  - reconcile via webhook/tx hash
  - persist node ↔ invoice ↔ tx hash mapping
  - grant credits idempotently on confirmed payment

## Phase 2 — Agent adoption acceleration

### Phase 2 options (from audit 2026-02-24)
- [ ] Request-targeted offers: allow offers to target published requests (not just units), enabling richer demand-side negotiation
- [ ] Compound/hybrid offers: structured multi-sided deal terms beyond freeform `note` (offered units + requested units + monetary terms, enforced atomically)
- [ ] Photos on units: accept photos via API with Cloudflare R2 (or similar) storage; add `unit_media` references
- [ ] "Has ever purchased" flag refinement: evaluate whether lifetime flag needs time-bounding, expiry, or abuse controls

- [ ] SDKs (full): TS + Python, versioned, CI publish, examples
- [ ] MCP server (official): hosted on Cloud Run; discoverable via `/v1/meta`
- [ ] Docs portal expansion: `/docs/api`, `/docs/errors`, `/docs/security`, `/docs/credits`, `/docs/webhooks`
- [ ] Enable email recovery lane in Phase 2:
  - choose delivery provider (SendGrid or SMTP)
  - set Cloud Run email env/secrets
  - run live email verification + recovery smoke (`/v1/email/*`, `/v1/recovery/*` with `method=email`)
  - reconfirm pubkey recovery in final smoke sequence
- [ ] Add pre-charge search quote/preview:
  - estimated credits, expected result band, likely coverage before charging
- [ ] Separate search `effort` from `selectivity`:
  - higher credits increase effort without implicit narrowing unless requested
- [ ] Add per-node reputation metrics plus routing:
  - success rate, response timeliness, dispute rate
- [ ] Add `offers_accepted_total` to network stats after metric definition is finalized
- [ ] Stripe stablecoin enablement:
  - periodically re-check dashboard eligibility
  - request approval when eligible
  - document supported chains/tokens
  - [ ] Stripe x402 crypto API (eligibility-dependent):
  - request private preview access
  - design 402 → pay → resume flow
  - persist payment reference ↔ credits grant mapping

## Phase 3 — Hardening / abuse / trust
- [ ] Abuse controls: tiered limits by plan; anomaly detection; automated suspension triggers + review
- [ ] Admin endpoints for suspension (optional later)
- [ ] Audit & compliance: retention enforcement, deletion/export flows, security disclosure policy
- [ ] Backups / restore drill: documented restore; periodic verification
- [ ] Add machine-readable compliance metadata:
  - retention, licensing, and data-handling declarations
- [ ] Add verification/provenance framework and dispute/recourse primitives
- [ ] ACH readiness (deferred):
  - handle checkout.session.async_payment_succeeded
  - handle checkout.session.async_payment_failed
  - ensure fulfillment only on confirmed payment
  - add idempotency tests

## Consolidated phased list (canonical)
- Phase 0.5: OpenAPI publish, real /docs/agents, legal/support content, ops runbooks, verify gating + rate limits + retention, manual suspension
- Phase 1: /v1/credits/quote, credit packs top-ups, plan-change credit semantics
- Phase 2: SDKs + MCP + expanded docs + search quote/preview + effort/selectivity split + reputation/routing
- Phase 3: hardening + admin endpoints + anomaly detection + compliance + compliance metadata + provenance/recourse

