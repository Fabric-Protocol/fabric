# Fabric - TODO (thread-active)

Last updated: 2026-02-24




### Phase 0.5 — Search economics + onboarding (latest thread notes)
- [ ] Review agent onboarding docs and flows for gaps (separate pass after copy updates).
- [ ] Review full agent workflows for MVP feature/anti-abuse gaps:
  - search -> offer -> acceptance -> contact reveal -> fulfillment


### Phase 0.5 / Phase 1 — Payments + enforcement (latest thread notes)
- [ ] Keep "credit packs" terminology consistent in Stripe display naming and docs.
- [x] Add `GET /internal/admin/daily-metrics` as the source for daily email digest (Done 2026-02-25):
  - `GET /internal/admin/daily-metrics` returns full snapshot
  - `POST /internal/admin/daily-digest` added: fetches metrics, logs structured digest, sends email if provider configured
  - Cloud Scheduler job `fabric-daily-digest` added to setup script (daily 06:00 UTC)
  - Internal admin POST routes exempted from idempotency (Cloud Scheduler compat)
- [x] Lightweight MCP server (initial MCP phase, pre-go-live):
  - expose safe read operations only (search, get unit/request, get offer, get events, get credits)
  - no mutations
  - thin wrapper over existing HTTP API (no new business logic)
  - strict allowlist + rate limits
  - publish `mcp_url` via GET /v1/meta
  - document briefly in /docs/agents
- [x] Improve 402 credits-exhausted response (Done 2026-02-25: purchaseGuidance() added to 402/429/was_capped with Stripe + crypto instructions)

### Phase 0.5 — Workflow hardening (latest thread notes)
- [ ] Update `AGENTS.md` DB/DDL wording:
  - explicitly state generated SQL scripts are for manual Supabase execution, not agent execution

### Phase 0.5 — Pricing + grants + acceptance fee (latest thread notes)
- [x] Create `supabase_migrations/2026-02-23__apply_credit_ledger_types.sql` for the new credit-ledger constraint migration, and run APPLY+VERIFY in Supabase before go-live (manual step). (Verified applied 2026-02-25)

### Phase 0.5 — Current phase (latest thread notes)
- [ ] Add/maintain `agent_toc` schema in OpenAPI + regression tests.
- [ ] Enforce "no contact info in item content" across all relevant text-bearing objects (verify future objects don't bypass validation).

### Agent-readiness improvements (from QA audit 2026-02-24)
- [ ] Move rate limiting from per-instance in-memory to a shared store (Redis/Upstash) so limits are consistent across horizontally scaled Cloud Run instances.
- [ ] Reduce Cloud Run cold-start latency: set `--min-instances=1` in production, evaluate startup profile for lazy-init opportunities, and consider `--cpu-boost` flag.

### Conformance audit findings (2026-02-25)
- [x] **G2** (fixed): Cloud Scheduler setup script created covering projections rebuild at :07/:37 America/Los_Angeles.
- [ ] **G3** (low): Add global burst rate limit (30 req/10s) and daily backstop (10,000/day non-search). Currently only per-endpoint limits exist.
- [ ] **G4** (low): Add referral fraud controls and clawback mechanism (spec says MUST include). No reversal/clawback code for referral grants exists.
- [ ] **G5** (low): Add Stripe `charge.dispute.created` / `charge.dispute.closed` webhook handler to auto-suspend or adjust credits on chargebacks. Terms describe the policy but no automation exists.
- [x] **G6** (fixed): Dead `trial_entitlements` write removed from unit creation CTE. Trial read functions and `has_active_trial` join in `findApiKey` also cleaned up.
- [x] **G7** (fixed): `display_name` now included in search result `nodes[]` array via batch lookup.
- [x] **C1** (fixed): `30__mvp-scope.md` signup grant changed from 200 → 100 to match code and `10__invariants.md`.
- [x] **G1** (fixed): Safety disclaimers added to publish, offer-create, and reveal-contact responses.
- [x] **D1** (fixed): `GET /v1/regions` discovery endpoint added (public, unauthenticated).
- [ ] **D2** (medium, future): International region support beyond US.
- [ ] **D3** (nice to have someday): Credit balance change webhooks to nodes. Not urgent — agents already get `X-Credits-Remaining` on every metered response and can poll `GET /v1/credits/balance`. Only revisit if users report confusion about balance changes.
- [x] **D4** (done): `GET /v1/me/referral-stats` endpoint implemented (referral count, credits earned, cap, remaining).
- [x] **D5** (done): Subscription status change webhook notifications to nodes (`subscription_changed` event type on `invoice.paid` and `invoice.payment_failed`). DB migration to allow nullable `offer_id` and new event types in `offer_events` table.
- [x] **D7** (done): Cloud Scheduler setup script created (`scripts/setup-cloud-scheduler.ps1`) covering all 3 jobs: projections rebuild (30min), sweep (5min), retention (daily). Internal `POST /internal/admin/retention` endpoint added.

### Audit findings (2026-02-26, logic+spec completeness)
- [ ] Add daily velocity limit (`CREDIT_PACK_MAX_GRANTS_PER_DAY`) enforcement to NOWPayments IPN handler — Stripe path already enforces via `countCreditPackPurchasesSince`; crypto path skips it. Low urgency (idempotency by `order_id` already prevents duplicate grants per payment; velocity limit only matters if a node creates 4+ separate crypto invoices in one UTC day).
- [ ] Add `crypto_payments` table to `21__db-ddl.sql` (currently only in `supabase_migrations/`).
- [ ] Spec `20__api-contracts.md` section 15c response shape drift: code returns `expiration_estimate_date` instead of `valid_until`, plus extra fields (`send_amount`, `chain`, `payment_status`, `warning`). Align spec or code.
- [ ] Document ops admin endpoints in `20__api-contracts.md`: `POST /internal/admin/health-pulse`, `POST /internal/admin/daily-digest`, `POST /internal/admin/sweep`, `POST /internal/admin/retention`.
- [ ] Add NOWPayments/crypto billing rows to `26__enforcement-coverage.md` coverage matrix.
- [ ] Fix Request PATCH TTL bounds in `20__api-contracts.md` line 927: `[60, 43200]` should be `[60, 525600]` to match code.
- [ ] Fix `GET /v1/events` metering label in `20__api-contracts.md`: "Conditional" should be "None".

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
- [x] Add regions catalog / stricter ISO 3166-2 validation endpoint (Done 2026-02-25: `GET /v1/regions` added).

### Decisions locked
- Offer/deal progression is not subscriber-gated; use suspension/legal/rate-limit controls.

## Phase 1 — Near-term product completeness

### Phase 1.5 (High Priority After Go Live)
- [x] ~~Crypto pay-ins via Bcon~~ — CANCELLED (Bcon removed; see decision-log 2026-02-25)

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
- [ ] LangChain integration: build and publish `langchain-fabric` Python package to PyPI (FabricToolkit wrapping API endpoints as LangChain Tools), submit docs PR to `langchain-ai/docs`
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
