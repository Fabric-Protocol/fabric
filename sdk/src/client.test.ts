import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import {
  FabricClient,
  FabricError,
  buildRecoveryMessage,
  signRecoveryMessage,
} from './index.js';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('FabricClient.me sends GET /v1/me with ApiKey auth and no idempotency key', async () => {
  const requests: Array<{ url: string; headers: Headers; method?: string }> = [];
  const client = new FabricClient({
    baseUrl: 'https://fabric.example',
    apiKey: 'test-key',
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
        method: init?.method,
      });
      return jsonResponse({
        node: { id: '11111111-1111-4111-8111-111111111111', display_name: 'SDK Node' },
        credits_balance: 500,
      });
    },
  });

  const response = await client.me();

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://fabric.example/v1/me');
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].headers.get('authorization'), 'ApiKey test-key');
  assert.equal(requests[0].headers.has('idempotency-key'), false);
  assert.equal(response.node.id, '11111111-1111-4111-8111-111111111111');
  assert.equal(response.credits_balance, 500);
});

test('FabricClient.searchListings sends POST JSON with automatic idempotency key', async () => {
  const requests: Array<{ url: string; headers: Headers; method?: string; body?: string }> = [];
  const client = new FabricClient({
    baseUrl: 'https://fabric.example',
    apiKey: 'test-key',
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
        method: init?.method,
        body: String(init?.body ?? ''),
      });
      return jsonResponse({
        items: [],
        next_cursor: null,
        budget: { credits_charged: 5, credits_remaining: 495, was_capped: false, requested: 5 },
      });
    },
  });

  const body = {
    q: null,
    scope: 'OTHER' as const,
    filters: { scope_notes: 'sdk-search' },
    budget: { credits_requested: 5 },
    limit: 20,
    cursor: null,
  };
  const response = await client.searchListings(body);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://fabric.example/v1/search/listings');
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].headers.get('authorization'), 'ApiKey test-key');
  assert.equal(requests[0].headers.get('content-type'), 'application/json');
  assert.match(String(requests[0].headers.get('idempotency-key')), /^[0-9a-f-]{36}$/i);
  assert.deepEqual(JSON.parse(requests[0].body ?? '{}'), body);
  assert.equal(response.budget.credits_charged, 5);
});

test('FabricClient.createOffer uses caller-supplied idempotency key', async () => {
  const requests: Array<{ headers: Headers; body?: string }> = [];
  const client = new FabricClient({
    baseUrl: 'https://fabric.example',
    apiKey: 'test-key',
    fetchImpl: async (_input, init) => {
      requests.push({
        headers: new Headers(init?.headers),
        body: String(init?.body ?? ''),
      });
      return jsonResponse({
        offer: {
          id: '22222222-2222-4222-8222-222222222222',
          status: 'pending',
          unit_ids: ['33333333-3333-4333-8333-333333333333'],
        },
      });
    },
  });

  const response = await client.createOffer(
    {
      unit_ids: ['33333333-3333-4333-8333-333333333333'],
      thread_id: null,
      note: 'sdk offer',
    },
    { idempotencyKey: 'fixed-sdk-idem' },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.get('idempotency-key'), 'fixed-sdk-idem');
  assert.equal(JSON.parse(requests[0].body ?? '{}').note, 'sdk offer');
  assert.equal(response.offer.id, '22222222-2222-4222-8222-222222222222');
});

test('FabricClient recovery methods hit the correct endpoints', async () => {
  const requests: Array<{ url: string; headers: Headers; method?: string; body?: string }> = [];
  const responses = [
    jsonResponse({ challenge_id: 'challenge-1', method: 'pubkey', nonce: 'nonce-1', expires_at: '2026-04-01T00:10:00.000Z' }),
    jsonResponse({ api_key: { api_key: 'fk_new_sdk_key' }, node: { id: '11111111-1111-4111-8111-111111111111' } }),
  ];
  const client = new FabricClient({
    baseUrl: 'https://fabric.example',
    apiKey: 'test-key',
    fetchImpl: async (input, init) => {
      requests.push({
        url: String(input),
        headers: new Headers(init?.headers),
        method: init?.method,
        body: String(init?.body ?? ''),
      });
      return responses.shift() ?? jsonResponse({});
    },
  });

  const start = await client.recoveryStart({ node_id: '11111111-1111-4111-8111-111111111111', method: 'pubkey' });
  const complete = await client.recoveryComplete({ challenge_id: 'challenge-1', signature: 'signature-1' });

  assert.equal(requests[0].url, 'https://fabric.example/v1/recovery/start');
  assert.equal(requests[0].method, 'POST');
  assert.match(String(requests[0].headers.get('idempotency-key')), /^[0-9a-f-]{36}$/i);
  assert.equal(requests[1].url, 'https://fabric.example/v1/recovery/complete');
  assert.equal(requests[1].method, 'POST');
  assert.equal(start.challenge_id, 'challenge-1');
  assert.equal(complete.api_key, 'fk_new_sdk_key');
});

test('FabricClient surfaces Fabric error envelopes as FabricError', async () => {
  const client = new FabricClient({
    baseUrl: 'https://fabric.example',
    apiKey: 'test-key',
    fetchImpl: async () => jsonResponse({
      error: {
        code: 'unauthorized',
        message: 'Bad auth',
        details: { reason: 'revoked_key' },
      },
    }, 401),
  });

  await assert.rejects(
    () => client.me(),
    (error: unknown) => {
      assert.ok(error instanceof FabricError);
      assert.equal(error.status, 401);
      assert.equal(error.code, 'unauthorized');
      assert.deepEqual(error.details, { reason: 'revoked_key' });
      return true;
    },
  );
});

test('buildRecoveryMessage and signRecoveryMessage produce a verifiable signature', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const message = buildRecoveryMessage('challenge-123', 'nonce-456');
  const signature = signRecoveryMessage(message, privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(), 'base64');

  assert.equal(message, 'fabric-recovery:challenge-123:nonce-456');
  assert.equal(
    crypto.verify(
      null,
      Buffer.from(message, 'utf8'),
      publicKey,
      Buffer.from(signature, 'base64'),
    ),
    true,
  );
});
