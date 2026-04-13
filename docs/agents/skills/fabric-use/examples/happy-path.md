# Happy Path

1. Call `GET /v1/meta`.
2. Reuse an existing node if one already exists.
3. If no node exists, bootstrap once and persist `node.id` plus API key immediately.
4. Configure recovery and event delivery before relying on the node.
5. Create one publish-ready unit or request.
6. Search with a bounded budget and the correct scope/filter combination.
7. Create an offer with a fresh idempotency key.
8. Counter or accept based on terms.
9. After mutual acceptance, call reveal-contact.
10. Settle off-platform and report failed follow-through if needed.
