#!/usr/bin/env node
/**
 * Minimal MCP smoke test for the current published Fabric MCP surface.
 *
 * Purpose:
 * 1) Confirm MCP endpoint is reachable.
 * 2) Bootstrap a node using the current legal payload shape.
 * 3) Login via session token flow.
 * 4) Fetch basic current-state views through the published wrapper tools.
 *
 * Usage:
 *   node examples/mcp-smoke.mjs
 *
 * Required env:
 *   MCP_URL=https://your-fabric-instance.example/mcp
 */

import crypto from 'node:crypto';

const MCP_URL = process.env.MCP_URL?.trim();
let rpcId = 1;

async function rpc(method, params = {}) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: rpcId++,
      method,
      params,
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(body)}`);
  }
  if (body.error) {
    throw new Error(`RPC error: ${JSON.stringify(body.error)}`);
  }
  return body.result;
}

async function callTool(name, args = {}) {
  const result = await rpc('tools/call', { name, arguments: args });
  if (!result || result.isError) {
    const text = result?.content?.[0]?.text || 'unknown MCP tool error';
    throw new Error(`${name} failed: ${text}`);
  }
  const text = result.content?.[0]?.text || '{}';
  return JSON.parse(text);
}

function countItems(payload) {
  if (Array.isArray(payload?.items)) return payload.items.length;
  if (Array.isArray(payload?.offers)) return payload.offers.length;
  return 0;
}

async function main() {
  if (!MCP_URL) {
    throw new Error('MCP_URL is required. Point this example at an explicit Fabric MCP endpoint.');
  }
  console.log(`MCP URL: ${MCP_URL}`);

  const toolList = await rpc('tools/list', {});
  const toolCount = Array.isArray(toolList?.tools) ? toolList.tools.length : 0;
  if (toolCount === 0) throw new Error('No tools returned by MCP');
  console.log(`tools/list: ${toolCount} tools`);

  const meta = await callTool('fabric_get_meta');
  const legalVersion = meta.required_legal_version;
  if (!legalVersion) throw new Error('fabric_get_meta did not return required_legal_version');

  const boot = await callTool('fabric_bootstrap', {
    display_name: `Smoke-${crypto.randomUUID().slice(0, 8)}`,
    email: null,
    referral_code: null,
    legal: { accepted: true, version: legalVersion },
  });
  const nodeId = boot?.node?.id;
  const apiKey = boot?.api_key?.api_key;
  if (!nodeId || !apiKey) throw new Error('fabric_bootstrap missing node.id or api_key.api_key');
  console.log(`bootstrap: node_id=${nodeId}`);

  const login = await callTool('fabric_login_session', { api_key: apiKey });
  const sessionToken = login.session_token;
  if (!sessionToken) throw new Error('fabric_login_session did not return session_token');
  console.log(`session login: expires_at=${login.expires_at}`);

  const profile = await callTool('fabric_profile', { action: 'get', session_token: sessionToken });
  const units = await callTool('fabric_list_inventory', { kind: 'unit', session_token: sessionToken, limit: 20 });
  const requests = await callTool('fabric_list_inventory', { kind: 'request', session_token: sessionToken, limit: 20 });
  const offersMade = await callTool('fabric_get_offers', {
    view: 'list',
    role: 'made',
    session_token: sessionToken,
    limit: 20,
  });
  const offersReceived = await callTool('fabric_get_offers', {
    view: 'list',
    role: 'received',
    session_token: sessionToken,
    limit: 20,
  });

  console.log(JSON.stringify({
    ok: true,
    node_id: nodeId,
    profile_node_id: profile?.node?.id || null,
    counts: {
      units: countItems(units),
      requests: countItems(requests),
      offers_made: countItems(offersMade),
      offers_received: countItems(offersReceived),
    },
  }, null, 2));

  await callTool('fabric_logout_session', { session_token: sessionToken });
  console.log('session logout: ok');
}

main().catch((err) => {
  console.error(`SMOKE FAILED: ${err?.message || String(err)}`);
  process.exitCode = 1;
});
