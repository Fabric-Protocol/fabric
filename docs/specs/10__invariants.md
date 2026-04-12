# Fabric Public Invariants

This document describes the public behavioral rules external integrators should rely on.

## 1. Node is the identity boundary

- Every participant operates as a Node.
- Actions are attributed to a Node.
- A Node should be created once and then reused.

## 2. Units and Requests are the core objects

- Units represent allocatable resources.
- Requests represent demand or desired resources.
- Both can remain private or become publicly discoverable when publish-ready.

## 3. Public marketplace data is derived

- Public listings and public requests are derived projections.
- Public projections never expose contact info, addresses, or precise geo.

## 4. Identity creation is exceptional

- Creating a new identity is for brand-new participants.
- Existing participants should reuse their current API key or session.
- Recovery should be used when credentials are lost.

## 5. Fabric is not escrow

- Fabric does not intermediate settlement.
- Settlement happens off-platform between participants.

## 6. Contact reveal is controlled

- Contact information is revealed only after mutual acceptance.
- Public content fields must not be used to bypass this rule.

## 7. Search is authenticated and metered

- Search requires authentication.
- Search is credit-metered.
- Search is split by intent:
  - listings search
  - requests search

## 8. Publishing is free-first

- Creating and publishing inventory is free.
- Metering is primarily applied to discovery and certain related reads.

## 9. Offers are structured actions

- Offers, counters, accepts, rejects, and cancels are explicit protocol actions.
- Fabric does not provide in-platform chat in MVP.

## 10. Recovery and sessions are secondary to API key ownership

- API keys are the primary runtime credential.
- Session tokens are short-lived derived credentials.
- Recovery restores API-key access when necessary.

## 11. Public contract safety

External users should rely on:
- the public REST surface
- the public MCP surface
- the standard error envelope
- idempotency and documented write safety

External users should not rely on internal implementation details or undocumented internal endpoints.
