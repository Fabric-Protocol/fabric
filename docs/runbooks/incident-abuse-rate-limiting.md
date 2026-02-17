# Incident Checklist: Abuse and Rate Limiting (MVP)

## Trigger examples
- Sudden request spikes from a node/IP.
- Repeated `401`/`429`/signature failures with suspicious patterns.
- Fraud indicators in top-up or subscription transitions.

## Immediate actions
1. Capture scope:
   - affected service/revision
   - timeframe (UTC)
   - node ids / API key prefixes / IP indicators
2. Contain:
   - apply manual suspension if needed
   - revoke active keys for abusive nodes
3. Preserve evidence:
   - request ids
   - webhook event ids
   - representative error envelope payloads

## Rate limit triage
1. Confirm 429 responses include `error.code=rate_limit_exceeded`.
2. Confirm correct rule bucket in details (`search`, `offer_write`, etc.).
3. If false positives:
   - tune environment rate-limit values
   - redeploy and re-verify.

## Post-incident steps
- Document root cause and rule adjustments.
- Add/extend automated tests reproducing the incident class.
- Review whether suspension can be lifted safely.
