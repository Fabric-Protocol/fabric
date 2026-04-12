import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { FabricClient, verifyWebhookSignature, type FabricEvent } from './index.js';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeEvent(id: string): FabricEvent {
  return {
    id,
    type: 'offer_created',
    offer_id: '11111111-1111-4111-8111-111111111111',
    actor_node_id: '22222222-2222-4222-8222-222222222222',
    recipient_node_id: '33333333-3333-4333-8333-333333333333',
    payload: {},
    created_at: '2026-03-23T12:00:00.000Z',
  };
}

test('FabricClient.getEvents requests /v1/events with since cursor and limit', async () => {
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
      return jsonResponse({ events: [makeEvent('44444444-4444-4444-8444-444444444444')], next_cursor: 'cursor-1' });
    },
  });

  const response = await client.getEvents({ since: 'cursor with spaces', limit: 25 });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://fabric.example/v1/events?since=cursor+with+spaces&limit=25');
  assert.equal(requests[0].method, 'GET');
  assert.equal(requests[0].headers.get('authorization'), 'ApiKey test-key');
  assert.equal(requests[0].headers.has('idempotency-key'), false);
  assert.equal(response.next_cursor, 'cursor-1');
  assert.equal(response.events.length, 1);
});

test('FabricClient.watchEvents loads and saves cursors while deduplicating event ids', async () => {
  const calls: string[] = [];
  const savedCursors: string[] = [];
  const handledEvents: string[] = [];
  const controller = new AbortController();
  const responses = [
    jsonResponse({
      events: [
        makeEvent('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
        makeEvent('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
      ],
      next_cursor: 'cursor-1',
    }),
    jsonResponse({
      events: [
        makeEvent('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
        makeEvent('cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
      ],
      next_cursor: 'cursor-2',
    }),
  ];

  const client = new FabricClient({
    baseUrl: 'https://fabric.example',
    apiKey: 'test-key',
    fetchImpl: async (input) => {
      calls.push(String(input));
      const response = responses.shift();
      if (response) return response;
      return jsonResponse({ events: [], next_cursor: null });
    },
  });

  await client.watchEvents({
    signal: controller.signal,
    minPollMs: 0,
    maxPollMs: 0,
    cursorStore: {
      load: () => 'cursor-0',
      save: async (cursor) => {
        savedCursors.push(cursor);
      },
    },
    onEvent: async (event) => {
      handledEvents.push(event.id);
      if (event.id === 'cccccccc-cccc-4ccc-8ccc-cccccccccccc') {
        controller.abort();
      }
    },
  });

  assert.deepEqual(calls, [
    'https://fabric.example/v1/events?since=cursor-0&limit=50',
    'https://fabric.example/v1/events?since=cursor-1&limit=50',
  ]);
  assert.deepEqual(handledEvents, [
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  ]);
  assert.deepEqual(savedCursors, ['cursor-1', 'cursor-2']);
});

test('FabricClient.watchEvents retries an event page when the handler fails before marking it seen', async () => {
  const errors: unknown[] = [];
  const attempts: string[] = [];
  const controller = new AbortController();
  const event = makeEvent('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee');

  const client = new FabricClient({
    baseUrl: 'https://fabric.example',
    apiKey: 'test-key',
    fetchImpl: async () => jsonResponse({
      events: [event],
      next_cursor: 'cursor-1',
    }),
  });

  await client.watchEvents({
    signal: controller.signal,
    minPollMs: 0,
    maxPollMs: 0,
    onError: async (error) => {
      errors.push(error);
    },
    onEvent: async (receivedEvent) => {
      attempts.push(receivedEvent.id);
      if (attempts.length === 1) {
        throw new Error('temporary handler failure');
      }
      controller.abort();
    },
  });

  assert.deepEqual(attempts, [
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  ]);
  assert.equal(errors.length, 1);
});

test('verifyWebhookSignature validates signed webhook payloads and rejects invalid ones', () => {
  const body = JSON.stringify(makeEvent('dddddddd-dddd-4ddd-8ddd-dddddddddddd'));
  const secret = 'event-secret';
  const timestamp = '1710000000';
  const signature = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');

  assert.deepEqual(
    verifyWebhookSignature(body, {
      'X-Fabric-Timestamp': timestamp,
      'X-Fabric-Signature': `t=${timestamp},v1=${signature}`,
    }, secret, { now: Number(timestamp) }),
    { ok: true, timestamp: Number(timestamp) },
  );

  assert.deepEqual(
    verifyWebhookSignature(body, {
      'x-fabric-timestamp': timestamp,
      'x-fabric-signature': `t=${timestamp},v1=deadbeef`,
    }, secret, { now: Number(timestamp) }),
    { ok: false, reason: 'invalid_signature' },
  );

  assert.deepEqual(
    verifyWebhookSignature(body, {
      'x-fabric-timestamp': timestamp,
      'x-fabric-signature': `t=${Number(timestamp) + 1},v1=${signature}`,
    }, secret, { now: Number(timestamp) }),
    { ok: false, reason: 'timestamp_mismatch' },
  );

  assert.deepEqual(
    verifyWebhookSignature(body, {
      'x-fabric-timestamp': timestamp,
      'x-fabric-signature': `t=${timestamp},v1=${signature}`,
    }, secret, { now: Number(timestamp) + 301 }),
    { ok: false, reason: 'timestamp_out_of_range' },
  );
});
