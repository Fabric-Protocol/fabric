# Conformance Audit — Spec vs Code

Generated: 2026-02-25

## Legend
- **OK** — Implemented correctly
- **PARTIAL** — Implemented but incomplete or with minor deviations
- **MISSING** — Spec says it should exist; code does not implement it
- **CONTRADICTS** — Code does something different from spec
- **GAP** — Gap found and already fixed in this session (referral endpoint, rollover cap, purchase guidance)

---

## 1. 10__invariants.md

| # | Claim | Status | Evidence / Notes |
|---|-------|--------|-----------------|
| 1 | Canonical backend with stable protocol | OK | REST + MCP + OpenAPI all present |
| 2 | Node is principal identity boundary | OK | All endpoints require node auth; actions attributed via `node_id` |
| 3 | Unit is canonical private object with measure/quantity | OK | `fabricRepo.ts:createResource` stores quantity/measure; both nullable until publish |
| 4 | Private-by-default; publication explicit | OK | `published_at` is null on create; explicit `POST .../publish` required |
| 5 | Projections are derived, allowlist-only, no geo/contact | OK | `upsertProjection` builds explicit field allowlist; no email/phone/address/coordinates in doc |
| 6 | Not escrow, not payment intermediary | OK | No payment handling code; settlement off-platform |
| 7 | No in-platform messaging in MVP | OK | No chat/messaging endpoints |
| 8 | Contact reveal after mutual acceptance + legal assent | PARTIAL | Reveal requires `mutually_accepted` + caller is party + legal assent. **Missing: no safety disclaimers** returned at publish, offer, or reveal time. Spec says "disclaimers MUST be included at publish, offer, and reveal." No disclaimer text is returned in any of these responses. |
| 9 | Location hints search-contextual; no precise geo in projections | OK | Projections only include `location_text_public` (coarse label) and structured regions. No lat/lng/address. |
| 10 | Scope explicit and required at publish | OK | `requirePublishFields` enforces `scope_primary` + per-scope requirements |
| 11 | Type required at publish, not at creation | OK | `type` is `.nullable().optional()` on create; `requirePublishFields` checks `type` |
| 12 | Search authenticated, paid, credit-metered, split by intent | OK | Two endpoints, credit metering, pre-purchase limits (3/3/1) |
| 13 | Broadening defaults to level 0, cost 0 | OK | Broadening cost hardcoded to 0; default `{ level: 0, allow: false }` |
| 14 | Rate limits on offer lifecycle + recommended values | OK | All recommended limits present in `config.ts` with correct defaults |
| 15 | Auditable event logging; search logs redacted; retention policy | PARTIAL | Search logs store `query_redacted` and `query_hash` (OK). Retention script exists (`scripts/retention-search-logs.ts`). **Missing: no scheduled cron for retention** — it's a manual `npm run` command, not automated. |
| 15b | Idempotency-Key on all non-GET; If-Match on PATCH | OK | Middleware enforces both; webhooks excluded |
| 16 | Referral virality via credits after first paid invoice | GAP/PARTIAL | Claim + award implemented. **Gap fixed this session: added `GET /v1/me/referral-code`**. **Still missing: no fraud controls or clawback ability** — spec says "MUST include fraud controls and the ability to claw back awards." Code has no clawback/reversal mechanism for referral grants. |
| 17 | Pricing/credits — all amounts correct | PARTIAL | Plans and packs match spec. **Unit milestone**: spec says "200 credits one-time after 20 Units" but code grants 100 credits at each of milestones 10 and 20 (total 200 but split differently). Request milestones: same pattern (100 at 10, 100 at 20). This matches spec intent (total 200) via a different mechanism. |
| 18 | Projections rebuild scheduled at :07/:37 America/Los_Angeles | PARTIAL | Admin rebuild endpoint exists (`POST /v1/admin/projections/rebuild`). **Missing: no scheduled cron trigger.** The endpoint exists but nothing calls it automatically. Deployment must set up Cloud Scheduler or equivalent externally. |
| 19 | Legal assent required for bootstrap | OK | `accepted=true` + `legal.version` must match `required_legal_version` from meta |
| 20 | Vision invariant | N/A | Statement only |
| 21 | Self-serve API key recovery | OK | Pubkey challenge/response implemented; TTL from config (default 10min); max attempts from config (default 5); success revokes all prior keys and mints new one; rate-limited per IP |

---

## 2. 25__plans-credits-gating.md

| Section | Claim | Status | Evidence / Notes |
|---------|-------|--------|-----------------|
| 1.1 | Free/subscribed can manage private resources | OK | No subscriber gate on CRUD endpoints |
| 1.2 | Credit-metered actions | OK | All 6 listed endpoints charge credits |
| 1.3 | Legal-assent-gated offer lifecycle | OK | All 5 endpoints check `hasCurrentLegalAssent` |
| 1.4 | Reject available to all authenticated | OK | No legal or subscriber check on reject |
| 2.1 | Charge only on 200 | OK | Credits deducted only after successful query execution |
| 2.2 | Base costs match | OK | `SEARCH_CREDIT_COST=5`, `SEARCH_TARGET_CREDIT_COST=1` in config |
| 2.3 | Budget ceiling (was_capped) | OK | Implemented with `was_capped`, `cap_reason`, `guidance` |
| 2.4 | Broadening cost = 0 | OK | Hardcoded to 0 |
| 2.5 | Pagination add-ons | OK | `pageAddOnCost` function matches spec (page 2=+2, 3=+3, 4=+4, 5=+5, 6+=+100) |
| 2.6 | Ledger type names | OK | All listed types present in DDL and code |
| 2.7 | Mutual acceptance fee: 1 credit each side | OK | `finalizeOfferMutualAcceptanceWithFees` charges `config.dealAcceptanceFeeCredits` (default 1) to each side; blocks on insufficient |
| 3 | Rate limits | PARTIAL | All listed limits present. **Missing: global burst (30/10s) and daily backstop (10,000/day)** from invariant 14. Only per-endpoint limits are implemented, not global aggregate limits. |
| 4 | Plans match | OK | `planCredits` map: free=0, basic=1000, pro=3000, business=10000 |
| 5 | Credit packs | OK | Codes, prices, credits all match. Anti-abuse `TOPUP_MAX_GRANTS_PER_DAY=3` enforced |
| 6 | Referrals | GAP/OK | Claim, award trigger, grant (100), cap (50) all correct. Endpoint to get own code added this session. |
| 6b | Upload trial bridge | PARTIAL | Milestones at 10 and 20 Units grant +100 each as `grant_trial` (OK). **Trial entitlement** (7-day window) is created but never checked/used by any gating logic — it's written to `trial_entitlements` table but no endpoint behavior changes based on trial status. |
| 6c | Request milestone bridge | OK | Milestones at 10 and 20 Requests, +100 each, idempotent |
| 7 | Credits quote endpoints | OK | Both `GET /v1/credits/quote` and `POST /v1/credits/quote` implemented |
| 8 | Plan-change semantics | OK | Upgrade grants delta credits by invoice (idempotent). Downgrade deferred to renewal. |

---

## 3. 22__projections-and-search.md

| Section | Claim | Status | Evidence / Notes |
|---------|-------|--------|-----------------|
| 2.1 | Publish eligibility rules | OK | `requirePublishFields` checks all per-scope requirements |
| 2.2 | Side effects (published_at + projection upsert/remove) | OK | Implemented in publish/unpublish |
| 2.3 | Scheduled rebuild | PARTIAL | Admin endpoint exists. **No automated scheduling** — see invariant 18 |
| 3.1 | Listing projection allowlist | OK | All listed fields present in `upsertProjection`; no prohibited fields |
| 3.2 | Request projection allowlist | OK | Includes `expires_at` which is correct per spec |
| 3.3 | PublicNode allowlist | MISSING | Spec says optional `PublicNode` with `id, display_name, avatar_url, created_at`. No such projection or endpoint exists. `nodes` summary in search only returns `node_id` and `category_counts_nonzero`. |
| 4 | Search two endpoints, metered | OK | |
| 4.1 | Request envelope shape | OK | All fields match |
| 4.2 | Filters by scope | OK | All scope-specific validations implemented |
| 5 | Response shapes | PARTIAL | `topup_hint` added to `was_capped` budget (not in spec but additive). No `expires_at` field in request projection response but it's in the allowlist. |
| 6 | Ranking/sorting | OK | `fts_rank`, `route_specificity_score`, `recency_score` implemented; `distance_miles` returns null (Phase 0.5) |
| 7 | Broadening deprecated | OK | |
| 8 | Node inventory expansion | OK | Both endpoints metered and paginated |
| 8.1 | Per-category drilldown | OK | Metered, rate-limited, paginated |
| 9 | Search logging redaction/retention | OK | `query_redacted` + `query_hash` stored; retention policy in `retentionPolicy.ts` |
| 10 | Takedowns + rebuild respect | OK | Rebuild SQL excludes takedowns; admin endpoint implemented |

---

## 4. 30__mvp-scope.md

| Claim | Status | Evidence / Notes |
|-------|--------|-----------------|
| Signup grant: 200 credits | CONTRADICTS | `30__mvp-scope.md` line 22 says "200 credits." `10__invariants.md` says 100. Code does 100. The 30 doc needs to be updated to say 100. |
| Visibility events: search_impression + detail_view | OK | Both implemented in `fabricRepo.ts` |
| Offer status model (8 states) | OK | All states implemented |
| Counter-offers: new offer in same thread | OK | `counterOffer` creates new offer linked by `thread_id` |
| Holds: create on offer, release on reject/cancel/counter/expire, commit on mutual accept | OK | All transitions implemented |
| Contact reveal: email required, phone optional, messaging_handles optional | OK | `revealContact` returns all three |
| Safety disclaimers at publish, offer, reveal | MISSING | Same as invariant 8 — no disclaimer text in responses |

---

## 5. Legal/Policy Text in app.ts

| Claim (from Terms/Billing Policy HTML) | Status | Evidence / Notes |
|-----------------------------------------|--------|-----------------|
| Subscription credits rollover cap at 2 months | GAP/OK | **Fixed this session** — enforcement added |
| Credit pack credits do not expire | OK | No expiration logic on topup_purchase entries |
| Chargebacks: may suspend/adjust credits | PARTIAL | Terms describe the policy but **no automated chargeback handling code exists**. Admin can manually suspend, but there's no Stripe `charge.dispute.*` webhook handler. |

---

## 6. API Response Fields Without Backing Enforcement

| Field | Returned where | Status | Notes |
|-------|---------------|--------|-------|
| `credits_rollover_enabled: true` | `GET /v1/me`, `GET /v1/credits/balance` | GAP/OK | **Fixed this session** |
| `subscription.period_start/period_end` | Me + balance | OK | Set by Stripe webhook |

---

## 7. 02__agent-onboarding.md vs Reality

| Claim | Status | Notes |
|-------|--------|-------|
| Referrals documented | GAP/OK | **Fixed this session** — section 9 added |
| Crypto billing documented | GAP/OK | **Fixed this session** — added to billing section |
| Error table matches real error codes | GAP/OK | **Fixed this session** — added `budget_cap_exceeded` and `prepurchase_daily_limit_exceeded` |

---

## Summary of Findings

### Gaps (spec promise not enforced in code)

| # | Severity | Finding | Spec source |
|---|----------|---------|-------------|
| G1 | Medium | **No safety disclaimers** in publish, offer, or reveal responses — **FIXED** | Invariant 8, MVP scope |
| G2 | Low | **No automated projection rebuild scheduling** — endpoint exists but no cron/scheduler triggers it | Invariant 18, 22__projections §2.3 |
| G3 | Low | **No global burst/daily backstop rate limits** (30/10s burst, 10k/day) — only per-endpoint limits | Invariant 14 |
| G4 | Low | **No referral fraud controls or clawback** mechanism | Invariant 16 |
| G5 | Low | **No chargeback webhook handler** for `charge.dispute.*` events | Legal/Billing policy |
| G6 | Low | **Trial entitlement window** written but never used for gating | 25__plans §6b |
| G7 | Info | **PublicNode projection** (display_name, avatar_url, created_at) not implemented | 22__projections §3.3 |

### Contradictions (spec says X, code/other spec says Y)

| # | Finding | Resolution |
|---|---------|-----------|
| C1 | `30__mvp-scope.md` says signup grant = **200** credits; `10__invariants.md` says **100**; code does **100** | **FIXED** — updated `30__mvp-scope.md` to say 100 |

### Already Fixed This Session

| Finding | Fix |
|---------|-----|
| No `GET /v1/me/referral-code` endpoint | Added endpoint + repo + service + OpenAPI + docs |
| Rollover cap documented but not enforced | Added grant-up-to-cap logic on subscription monthly grant |
| 402/429 errors missing purchase guidance | Added `purchaseGuidance()` to all credit-related errors |
| `was_capped` search responses missing credit hint | Added `topup_hint` field |
| Onboarding doc missing referrals, crypto, error codes | Updated `02__agent-onboarding.md` |
| **C1**: `30__mvp-scope.md` signup grant said 200 | Changed to 100 to match code and `10__invariants.md` |
| **G1**: No safety disclaimers in publish/offer/reveal | Added `SAFETY_DISCLAIMERS` to `fabricService.ts`; included in publish, createOffer, and revealContact responses |
| **D1**: No region discovery endpoint | Added `GET /v1/regions` (public, unauthenticated) + OpenAPI + meta `regions_url` + docs |

---

## Desirable Additions (not in spec, but would improve agent experience)

| # | Idea | Rationale | Effort |
|---|------|-----------|--------|
| D1 | `GET /v1/regions` discovery endpoint — **IMPLEMENTED** | Agents have no way to know what region IDs are valid. Currently US-only but not documented anywhere agents can discover programmatically. | Small |
| D2 | International region support (CA, GB, AU, etc.) | Only US + US states are allowed. Limits international agents. | Medium |
| D3 | Credit balance change webhooks | Nodes get webhooks for offer lifecycle but not credit changes. After a Stripe payment or crypto top-up, the node has no push notification — must poll `/v1/credits/balance`. | Medium |
| D4 | `GET /v1/me/referral-stats` endpoint | Referrers can't see how many referrals they've made or how many credits they've earned from referrals. | Small |
| D5 | Subscription status change webhooks to nodes | When a node's plan changes via Stripe, there's no push notification to the node. | Medium |
| D6 | Add `expires_at` to request projection in search results | Agents searching requests can't see when they expire without a detail read. Spec allowlist includes it. | Trivial |
| D7 | Automated retention job via Cloud Scheduler | The retention script exists but requires manual execution. Could be a Cloud Scheduler job hitting an internal endpoint. | Small |
