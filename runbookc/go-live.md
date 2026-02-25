# Go-Live Runbook (Stripe + Supabase + Cloud Run)

Owner: ___  
Date: ___  
Service: Fabric API (API-only)

This runbook is a human-executable go-live checklist for a single-day final readiness pass. It focuses on misconfiguration risk: secrets, webhooks, env drift, provider settings, and operational blind spots.

Normative references:
- API contracts: `docs/specs/20__api-contracts.md`
- DDL baseline: `docs/specs/21__db-ddl.sql`
- Current TODOs: `docs/project-files/todo.md`
- Decisions: `docs/project-files/decision-log.md`

---

## GO-LIVE CHECKLIST

### Stripe (Live)
1) Key mode alignment (`Developers > API keys`)
- PASS: Cloud Run prod uses `sk_live_*`; no test keys anywhere in prod.
- FAIL: any mixed test/live keys.

2) Webhook endpoint (`Developers > Webhooks`)
- PASS: endpoint URL is exactly `https://<prod-domain>/v1/webhooks/stripe` (correct host + path).
- FAIL: wrong host/path, or pointing at staging.

3) Subscribed event types (MVP contract)
Enable exactly what the runtime expects (at minimum):
- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
PASS: all enabled. FAIL: any missing.

4) Webhook signing secret
- PASS: `STRIPE_WEBHOOK_SECRET` is stored as a secret (not plaintext in a deploy script), owner + rotation cadence documented, and a post-rotation replay test plan exists.
- FAIL: secret only exists as a copied env var with no rotation plan.

5) Price/Pack ID correctness (`Products` / `Prices`)
Backend must map plan + credit-pack codes to active Stripe prices.
- Plans: `basic|pro|business` (subscription mode) — see `POST /v1/billing/checkout-session`.
- Credit packs: `credits_500|credits_1500|credits_4500` (payment mode) — see `POST /v1/billing/topups/checkout-session`.
PASS: all referenced price IDs exist, active, USD, correct recurrence (plans recurring; packs one-time).
FAIL: stale, missing, disabled, wrong currency, or wrong recurrence.

6) Live-mode enforcement
- PASS: `STRIPE_ENFORCE_LIVEMODE=true` in prod and a test-mode webhook event is rejected/ignored as intended.
- FAIL: test events accepted in prod.

7) Stripe webhook idempotency posture (contracted behavior)
- PASS: webhook handler is idempotent on Stripe `event.id` and credit grants are idempotent on payment reference (payment_intent/invoice) per contract; duplicate delivery causes no double-grant.
- FAIL: repeated webhook deliveries can double-grant credits.

---

### Supabase (Prod)
1) Schema baseline + migrations applied (manual)
- PASS: `docs/specs/21__db-ddl.sql` baseline is reflected in prod schema AND all required `supabase_migrations/*__apply_*.sql` for go-live have been executed in prod.
- FAIL: any “apply” migration not confirmed.

2) Verify scripts executed (manual)
- PASS: all required `supabase_migrations/*__verify_*.sql` were run and show expected objects (columns/indexes/triggers).
- FAIL: any missing object or verify mismatch.

3) Extensions / TLS
- PASS: required extensions enabled (e.g., `pgcrypto` if used); direct Postgres connection works with TLS CA pinning (`DATABASE_SSL_CA`).
- FAIL: TLS/cert mismatch or extension missing.

4) RLS/storage posture explicitly understood
- PASS: it is explicitly documented whether RLS/Storage policies are relied on (or not) by the API runtime; Supabase public surfaces reviewed for accidental exposure.
- FAIL: assumed protection without policies, or unreviewed exposure.

5) Auth settings posture
- PASS: redirect allowlists / templates / rate limits / confirmation settings reviewed so they cannot accidentally become a public user-auth surface.
- FAIL: defaults left unreviewed.

6) Service-role handling
- PASS: no Supabase service-role key is present in runtime unless explicitly required and rotation is documented.
- FAIL: service-role key present “just in case” with no plan.

7) Backup / restore posture
- PASS: backup/PITR posture confirmed; restore test window and operator documented.
- FAIL: no restore proof or no operator.

---

### Cloud Run / GCP (Prod)
1) Invocation model
- PASS: explicit decision documented for public endpoints (notably `/v1/meta` and `/v1/bootstrap`), and Cloud Run IAM/ingress aligns with it.
- FAIL: Cloud Run requires auth (`--no-allow-unauthenticated`) but onboarding requires unauth without a defined path.

2) Service account least privilege
- PASS: runtime service account has only needed roles (at minimum logging + secret accessor for referenced secrets); no broad `owner/editor`.
- FAIL: over-privileged service account.

3) Secret handling
- PASS: true secrets are provided via Secret Manager integration (not pasted plaintext into deploy scripts). Secrets include at minimum:
  - `DATABASE_URL`, `DATABASE_SSL_CA`, `ADMIN_KEY`
  - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - email provider secrets (if enabled)
- FAIL: secrets injected only as plain env vars in scripts/docs.

4) Runtime sizing for bursty agent traffic
Document chosen values and why; start-point guidance:
- CPU: 1 vCPU
- Memory: 512Mi–1Gi
- Timeout: 60s
- Concurrency: 20–40
- Min instances: 1
- Max instances: capped to protect DB connections
PASS: explicitly set and tested. FAIL: defaults/unbounded without DB consideration.

5) Domain/TLS/ingress
- PASS: custom domain + managed TLS healthy; ingress matches intended exposure; HTTPS-only; no hostname drift that could break Stripe webhook URL matching.
- FAIL: mixed hosts or wrong ingress.

6) Observability plumbing
- PASS: log retention known; error reporting and alert policies exist; notification channel exists.
- FAIL: logs only, no alerts.

---

### App
1) Env preflight hardening
- PASS: startup validates all production-critical env vars (not just a subset) and fails fast with clear error codes.
- FAIL: partial checks allow bad deploys.

2) Multi-instance correctness: idempotency + rate limits
- PASS: behavior is correct under >1 instance/revision (no in-memory-only assumptions that break correctness guarantees).
- FAIL: in-memory-only replay/rate buckets create inconsistent behavior.

3) Email provider readiness (only if used)
- PASS: chosen provider path is fully configured and smoke-tested in prod; failure modes are observable.
- FAIL: provider selected but runtime deps/secrets not present.

4) Manual suspension drill (if in MVP scope)
- PASS: runbook exists and has been exercised once in staging/prod-like.
- FAIL: procedure untested.

5) Search log retention automation (if policy requires)
- PASS: retention job is scheduled and monitored (and the “how to verify it ran” is documented).
- FAIL: policy exists but no scheduler.

---

## SECRETS & CONFIG TABLE (fill during checklist)
| Name | Type (Secret/Config) | Where referenced | Where stored (actual) | Risk | Action |
|---|---|---|---|---|---|
| DATABASE_URL | Secret | config/env |  | High |  |
| DATABASE_SSL_CA | Secret | config/env |  | Med |  |
| ADMIN_KEY | Secret | config/env |  | High |  |
| STRIPE_SECRET_KEY | Secret | config/env |  | High |  |
| STRIPE_WEBHOOK_SECRET | Secret | config/env |  | High |  |
| STRIPE_ENFORCE_LIVEMODE | Config | config/env |  | Med |  |
| STRIPE_TOPUP_PRICE_500 | Config | config/env |  | Med |  |
| STRIPE_TOPUP_PRICE_1500 | Config | config/env |  | Med |  |
| STRIPE_TOPUP_PRICE_4500 | Config | config/env |  | Med |  |
| CHECKOUT_REDIRECT_ALLOWLIST | Config | config/env |  | Med |  |
| EMAIL_PROVIDER / EMAIL_FROM | Config | config/env |  | Med |  |
| SENDGRID_API_KEY / SMTP_USER / SMTP_PASS | Secret | config/env |  | High/Med |  |

---

## SMOKE TEST RUNBOOK (Prod)

Goal: minimal, end-to-end sanity across onboarding, core workflow, Stripe checkout, webhook processing, and credits effects.

1) Health + discovery
- Call `GET /healthz` (if present) and `GET /v1/meta`.
PASS: 200 + valid JSON. FAIL: non-200 or wrong domain.

2) Bootstrap
- Call `POST /v1/bootstrap` with `Idempotency-Key`.
PASS: returns node + api_key; repeating with same idempotency key is safe. FAIL: unexpected 4xx/5xx.

3) Authenticated workflow sanity
Using the returned api_key:
- Create at least one listing or request (per contract).
- Perform one representative search/drilldown path used by agents.
- Create offer -> accept -> contact reveal; then poll `GET /v1/events`.
PASS: expected state transitions succeed and events are emitted. FAIL: blocked transition or missing events.

4) Stripe subscription checkout (manual)
- Call `POST /v1/billing/checkout-session` with `plan_code` and allowed redirect URLs.
- Complete checkout in browser.
- Confirm Stripe webhook delivery success in Stripe dashboard for the prod endpoint.
PASS: webhook deliveries succeed and subscriber status/credits effects occur. FAIL: webhook delivery failures or missing side effects.

5) Stripe credit-pack checkout (manual)
- Call `POST /v1/billing/topups/checkout-session` with `pack_code` (e.g., `credits_500`).
- Complete checkout in browser.
- Confirm webhook delivery success.
PASS: pack credits granted exactly once (no duplicates) and any daily velocity limit behavior is as designed. FAIL: missing or duplicated credits.

6) Post-conditions
- Confirm credits balance changed as expected and no double-grants occurred for repeated webhook deliveries.
PASS: all invariants hold. FAIL: anomalies.

---

## ROLLBACK PLAN
1) Cloud Run: immediately shift traffic to last known-good revision.
2) Secrets: revert secret versions only if a rotation caused breakage (track which secret changed).
3) Stripe webhook failures:
- Stop the bad revision first (traffic shift), then redeliver failed events from Stripe dashboard.
4) Credit anomalies:
- Temporarily disable purchase entrypoints if needed; reconcile ledger vs Stripe events; apply compensating admin adjustments if supported.
5) DB breakage:
- Restore from PITR/backup if needed; redeploy last good revision; re-run smoke.

---

## ALERTING / MONITORING MINIMUMS
- Availability: 5xx > 1% for 5 minutes (service-wide).
- Latency: p95 > 1500ms for 10 minutes on search + billing endpoints.
- Stripe webhook delivery: non-2xx deliveries > 0.5% for 5 minutes.
- Stripe processing errors: any processing-error signal > 0 in rolling 15 minutes (where observable).
- Abuse signals: sustained spikes in 429s and suspected scrape patterns.
- Secret/TLS errors: any certificate/SSL errors in logs (page immediately).
- Daily digest: if `GET /internal/admin/daily-metrics` exists, ensure it is scheduled and reviewed daily.

---

## FINAL GO / NO-GO
GO only if:
- Stripe webhook is verified end-to-end in livemode.
- Secrets are stored and rotated via a real secret store (not plaintext scripts).
- Supabase APPLY + VERIFY migrations for go-live are confirmed.
- Cloud Run invocation/ingress/auth matches onboarding requirements.
- Smoke test passes end-to-end with no credit anomalies.

NO-GO if any of the above fail.

---

## Notes / Canon alignment
(Only add if you had to change any text to match the canonical contracts/decisions/todos.)
---
