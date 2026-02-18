# Fabric × “How to Sell to Agents” — Alignment, Gaps, and Action Plan

Source: internal summary of Flynnjamm “How to Sell to Agents” + Fabric MVP direction.

## 1) Article summary (compressed)
Agents collapse search + evaluation transaction costs. They don’t browse or respond to branding at runtime; they query structured registries and optimize for:
- Capability fit
- Speed (pipeline latency)
- Cost (machine-readable at runtime)
- Liveness/reliability
- Confidence/accuracy/provenance
Discovery must be machine-readable; onboarding must be automatable; trust becomes measurable; adversarial endpoints exist; compliance can become machine-readable.

## 2) Fabric’s positioning (what applies / what does not)
Fabric is a network/search/market coordination layer. Our moat is not raw compute speed; it is:
- Coverage (more nodes + more units)
- Policy gating / allowlisting
- Predictable protocol contracts
- Trust signals + anti-abuse
Speed matters only to avoid blocking agent workflows; it is not the guiding product metric.

## 3) Where Fabric matches well (keep)
- Agent-first API + structured search results (agents query, don’t browse).
- Strong protocol discipline: idempotency, consistent envelopes, concurrency/versioning.
- Canonical vs projections separation: safe discovery without oversharing.
- Explicit staged workflows: search → offer → acceptance → contact reveal → fulfillment.
- Operational focus on reliability (dead services get zero traffic).

## 4) Where Fabric does not match yet (gaps)
### 4.1 Cost transparency (credits feel like a blind bet)
Agents need deterministic, machine-readable mapping from “credits spent” → “expected outputs / effort / selectivity.”
Current risk: paying 10–20 credits for sparse results feels undesirable; spending more credits can narrow results and surprise the buyer unless this is explicit.

### 4.2 Runtime feedback loops (market velocity)
Polling for offers slows commerce. Agents need near-real-time signals:
- offer.created
- offer.updated
- offer.accepted
- contact.revealed
- fulfillment.updated

### 4.3 Trust / adversarial environment
Beyond uptime: quality, confidence, provenance, and anti-abuse need to be measurable and routable.

### 4.4 Machine-readable compliance (later)
Policies like retention/licensing/data handling can be exposed as structured metadata so enterprise agents can verify constraints programmatically.

## 5) Improvements that are feasible for Fabric (and how we interpret them)
### 5.1 “Be faster/cheaper than self-computation” (NOT our guiding light)
We do not compete as a pure compute service. For Fabric, the durable advantage is access/coordination: coverage + trust + policy + settlement primitives.

### 5.2 Make credits transparent (GO-LIVE priority)
Introduce a minimal “Search Budget Contract” returned on every search:
- credits_requested
- credits_charged
- search_strategy: broad | balanced | precise
- eligible_count / queried_count / coverage_ratio
- returned_count
- reason_codes for sparse results (NO_SUPPLY, POLICY_BLOCKED, LOW_CONFIDENCE_FILTERED, TIMEOUTS, etc.)

Near-term follow-on: separate “effort” vs “selectivity” so paying more credits increases effort without implicitly narrowing unless the agent asks for it.

Optional preflight (Phase 2): “quote/preview” mode that estimates expected result band and likely coverage before charging.

### 5.3 Ex-post quality signals (GO-LIVE or Phase 2)
Return diagnostics that let agents learn what different credit levels do:
- result_quality_score (0–1, heuristic confidence in the result set)
- coverage_ratio (queried/eligible)
- duplicates_merged_count, stale_filtered_count, timeouts_count
- distribution stats (p50/p90 score) if ranking exists

Principle: these are “confidence-in-results” signals, not promises.

### 5.4 Near-real-time communication (GO-LIVE priority)
Implement eventing:
- Webhooks for agents that can receive inbound HTTP.
- Poll fallback: /events?since=cursor
- Optionally SSE/long-poll for near-instant delivery without inbound connectivity.

### 5.5 Network growth transparency + incentives (GO-LIVE priority)
Expose running totals:
- registered_nodes_total
- visible_units_total
- (later) offers_accepted_total

Add consistent messaging (docs + check-in surfaces):
- Early network → searches may be sparse; improves as nodes join and publish units.
- Encourage sharing referral/advertising links to grow supply and improve search quality.

Prefer short response headers + a network stats endpoint; keep referral details in docs/response bodies, not verbose headers.

## 6) Go-live vs later (recommended ordering)
### Go-live (high leverage, low scope)
1) Add network stats endpoint: nodes_total + visible_units_total (+ updated_at).
2) Add “early network” reminder in onboarding docs + short headers on key responses.
3) Add search response transparency fields (Search Budget Contract).
4) Add eventing for offer lifecycle (webhooks + poll cursor; optional SSE).
5) Add minimal ex-post quality signals (coverage_ratio + reason codes; result_quality_score optional if easy).

### Phase 2 (after go-live)
- Quote/preview for searches.
- Effort vs selectivity separation.
- Per-node reputation metrics and routing.
- Expand public stats: offers_accepted_total once definition is stable.

### Phase 3 (hardening)
- Machine-readable compliance metadata.
- Verification/provenance frameworks.
- Dispute/recourse primitives.

## 7) Notes / non-goals
- Do not optimize the product narrative around raw latency alone.
- Avoid marketing-style promises; provide machine-readable diagnostics + truthful expectations.
