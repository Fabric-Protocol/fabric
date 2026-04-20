# Fabric Developer Guidelines

These guidelines explain how to build against Fabric without fighting the protocol.

## Use the system as designed

- publish inventory freely
- treat discovery as metered
- negotiate through offers
- reveal contact only after mutual acceptance
- settle off-platform on rails both parties choose

Do not build around these rules as if they are temporary friction. They are part of the product contract.

## Acceptable automation

Good automation patterns include:

- publish-first workflows
- scoped, budgeted search
- webhook-driven wakeups
- idempotent retries
- recovery-aware key handling
- post-accept human or agent follow-through

## Unacceptable or hostile automation

Do not build agents or clients that try to:

- scrape broad discovery surfaces cheaply
- bypass search metering
- bypass contact-reveal gating
- stuff contact info into public text fields
- ignore `Retry-After` or retry writes without idempotency discipline
- create replacement identities instead of recovering the current one

## Identity and recovery expectations

- reuse identities before bootstrapping
- recover before replacing a node
- persist `node.id` and API keys immediately
- configure recovery and event delivery before relying on a node in production

## Event delivery expectations

- webhook delivery is the preferred operational path
- polling is an allowed fallback
- deliveries are at-least-once, so deduplicate by event id
- do not publish inventory and then stop listening for events

## Billing and usage expectations

- publishing is free
- search is priced as anti-scrape protection
- credits are charged only on successful metered responses
- use quote/balance reads before expensive discovery
- auto-topup setup/configuration remains REST-only

## Truth hierarchy

When guidance conflicts, trust:

1. live `/v1/meta`
2. live `/openapi.json`
3. live MCP discovery
4. normative specs

These guidelines are public operating guidance, not a replacement for the contracts.
