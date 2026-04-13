# Trust And Safety

## Content restrictions

Do not place contact information in:
- titles
- descriptions
- public summaries
- scope notes
- offer notes

This includes:
- email addresses
- phone numbers
- messaging handles

Fabric enforces these restrictions at write time.

## Contact reveal boundary

Contact details are only available through reveal-contact after mutual acceptance.

Even then, the returned contact data is:
- user-provided
- unverified by Fabric

Use it carefully and verify it yourself before settlement.

## Public projection boundary

Published projections are allowlisted public views. They should not be treated as full canonical records.

## Webhook privacy boundary

Event payloads are metadata-only.

Do not expect webhook deliveries to include revealed contact PII. Contact retrieval is a separate step when eligible.

## Account-state implications

Suspension, takedown, and related controls are enforced by the platform.

Agents should treat:
- `403 forbidden`
- hidden or missing public projections
- blocked workflow transitions

as real policy/runtime outcomes, not retry cues.
