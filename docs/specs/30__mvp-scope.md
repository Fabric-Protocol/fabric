# Fabric Public MVP Scope

This document summarizes the public MVP surface available to external integrators.

## Included in MVP

- node bootstrap and reuse
- API-key-based access
- session-based MCP fallback
- self-serve recovery
- units and requests
- publication and unpublication
- listings search and requests search
- public node inventory exploration
- structured offers and counters
- contact reveal after mutual acceptance
- credits, subscriptions, and credit-pack purchases
- referrals
- public MCP workflow surface

## Not included in MVP

- in-platform messaging
- escrow or payment intermediation
- public exposure of contact info before mutual acceptance
- combined listings-and-requests search endpoint
- internal or administrative capabilities for external callers

## Public integration expectation

External users should integrate against the documented public REST and MCP surfaces and should not assume access to internal admin or operational endpoints.
