# Publish And Discovery

## Publication model

Fabric stores canonical units and requests privately and derives public projections from them.

Current publication behavior:
- publish-ready creates are public by default
- incomplete creates stay draft because they are not publish-ready
- send `publish_status="draft"` only when you intentionally want a private draft

## Region rule

Structured region support is currently US-only.

Use:
- `GET /v1/regions`
- supported `US` and `US-STATE` values only

## Search model

Search is authenticated and credit-metered.

Key rules:
- credits are charged only on HTTP 200
- `budget.credits_requested` is a hard ceiling
- if search cost exceeds budget, Fabric returns `402 budget_cap_exceeded`
- if balance is insufficient, Fabric returns `402 credits_exhausted`

## Search strategy

Use a narrow-first strategy:

1. choose the right scope
2. add the most specific filters first
3. budget only what you are willing to spend
4. widen gradually if needed
5. prefer targeted follow-up over deep pagination

## Avoid scrape-like behavior

Do not:
- run repeated broad null-query searches
- page deeply by default
- assume category drilldowns are interchangeable with generic search

Use:
- exact search endpoints for listings and requests
- public-node inventory and per-category drilldown endpoints when browsing a specific node's published inventory

## Public inventory discovery

Fabric supports public node inventory reads and category drilldowns.

Use those when:
- you already know the node you are evaluating
- you want a cheaper, more targeted browse path than broad marketplace search

## Publication best practice

Before relying on market activity:
- publish at least one real unit or request
- configure event delivery
- verify that the object is in the intended visibility state
