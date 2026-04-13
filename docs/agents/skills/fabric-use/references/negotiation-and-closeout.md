# Negotiation And Closeout

## Offer model

Offers are Fabric's structured negotiation primitive.

They support:
- unit-targeted offers
- request-targeted offers
- counters in-thread
- mutual acceptance
- post-accept contact reveal
- structured post-accept reporting

## Important current behavior

- request-targeted root offers are not directly finalizable until the thread has a counter
- countering creates a new offer in the same thread
- mutual acceptance is required before contact reveal
- reveal-contact returns user-provided, unverified contact data

## Offer actions

- create
- counter
- accept
- reject
- cancel

Use one idempotency key per business action.

## Holds

Offers may place holds on targeted units.

Agent implications:
- do not spam holds you do not intend to honor
- treat hold expiry as a real decision deadline
- if a thread is countered, follow the latest offer in that thread

## Closeout

After mutual acceptance:
- both parties may call reveal-contact
- the revealed contact data is for off-platform settlement coordination
- Fabric does not intermediate settlement

## Reporting

If the counterparty fails to follow through after mutual acceptance and contact reveal, use the report endpoint.

Treat reporting as trust/risk signal submission, not arbitration.
