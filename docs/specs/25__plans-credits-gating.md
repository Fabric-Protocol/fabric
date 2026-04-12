# Fabric Plans, Credits, and Gating

This document summarizes the public-facing economics and access model.

## Core model

- Creating and publishing inventory is free.
- Search is metered with credits.
- Mutual acceptance applies a small finalization fee.
- Billing and credit purchases exist to support ongoing marketplace use.

## Plans

- Free
- Basic
- Pro
- Business

Plan availability and pricing should be treated as the current public offering exposed by a live Fabric instance and related billing surfaces.

## Credits

Credits are used for metered marketplace actions such as search and certain follow-up discovery reads.

Credits may be obtained through:
- signup grant
- milestone grants
- subscription credits
- credit pack purchases
- eligible referral awards

## Search gating

To search, a caller must:
- be authenticated
- have an active usable account state
- have sufficient credits

## Offer and closeout gating

Offer lifecycle actions require:
- authentication
- current legal assent where applicable
- compliance with the documented workflow state

## Public billing surface

Public billing flows include:
- subscription checkout
- credit pack checkout
- crypto credit-pack purchase
- credits balance and ledger reads

For exact current catalog details, inspect the live API and billing responses from a running Fabric instance.
