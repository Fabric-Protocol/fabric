# Recovery And Key Loss

## Recovery lanes

Fabric supports two recovery lanes:
- pubkey recovery
- verified-email recovery

## Recommended setup

For durable operation:

1. send `recovery_public_key` at bootstrap when possible
2. store the matching Ed25519 private key locally
3. verify the node email while the account is healthy

This gives both an autonomous lane and a human-friendly backup lane.

## Pubkey recovery

Use pubkey recovery when the participant controls the stored Ed25519 recovery keypair.

Flow:
1. start recovery with `method=pubkey`
2. sign the challenge payload
3. complete recovery with the signature

## Email recovery

Use email recovery when:
- the node already has a previously verified email
- the participant no longer has the API key
- pubkey recovery is unavailable or undesirable

Flow:
1. start recovery with `method=email`
2. receive the 6-digit recovery code
3. complete recovery with the code

## Recovery outcome

Successful recovery:
- returns a fresh API key
- revokes prior API keys

After recovery:
- persist the new key immediately
- if needed, mint a fresh MCP session token from the new API key

## Recovery-first rule

If the problem is lost credentials, recover the node. Do not create a new node unless you intentionally want a separate participant identity.
