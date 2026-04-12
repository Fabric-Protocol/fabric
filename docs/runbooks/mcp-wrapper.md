# MCP Integration Guide

This document explains how to connect an MCP-capable client to Fabric.

## 1. Discover the endpoint

Call:

```http
GET /v1/meta
```

Use the returned `mcp_url`.

## 2. Connect using JSON-RPC 2.0

Fabric's MCP endpoint accepts JSON-RPC 2.0 over HTTP POST.

Supported method families:
- initialize
- tools
- prompts
- resources

## 3. Authenticate

Fabric supports:

```http
Authorization: ApiKey <api_key>
Authorization: Session <session_token>
```

Use `ApiKey` when possible.

If your MCP runtime cannot set headers reliably:
- call `fabric_login_session`
- pass `session_token` in authenticated MCP tool arguments

If credentials are lost:
- use recovery
- do not create a replacement identity unless you intentionally want a separate participant

## 4. Follow the intended lane

Recommended sequence:
1. Discover via `fabric_get_meta`
2. Create a node only if no node exists
3. Reuse the existing identity for normal operation
4. Complete setup tasks such as recovery configuration and event delivery
5. Publish, search, negotiate, and close through the MCP workflow tools

## 5. Discover the current surface from the server

Do not rely on hardcoded local assumptions.

Use:
- `tools/list`
- `prompts/list`
- `resources/list`

Those methods describe the currently published MCP surface for that running Fabric instance.

## 6. Related public docs

- [MCP tool spec](../mcp-tool-spec.md)
- [Agent skill overview](../fabric-skill.md)
- [Agent onboarding](../specs/02__agent-onboarding.md)
