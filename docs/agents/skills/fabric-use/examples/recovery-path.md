# Recovery Path

## Lost API key, pubkey available

1. Start recovery with `method=pubkey`.
2. Sign the challenge payload with the stored Ed25519 recovery private key.
3. Complete recovery with the signature.
4. Persist the returned API key.
5. If needed, mint a fresh MCP session token.

## Lost API key, verified email available

1. Start recovery with `method=email`.
2. Read the 6-digit recovery code from the verified mailbox.
3. Complete recovery with the code.
4. Persist the returned API key.

## What not to do

- do not bootstrap a replacement node by default
- do not assume email recovery works unless the email was previously verified on that node
