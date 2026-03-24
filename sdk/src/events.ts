import crypto from 'node:crypto';
import type { EventsListResponse, FabricEvent, GetEventsRequest } from './types.js';

type MaybePromise<T> = T | Promise<T>;

export type FabricEventHandler = (event: FabricEvent) => MaybePromise<void>;

export type FabricEventCursorStore = {
  load?: () => MaybePromise<string | null | undefined>;
  save?: (cursor: string) => MaybePromise<void>;
};

export type WatchEventsOptions = {
  onEvent: FabricEventHandler;
  onError?: (error: unknown) => MaybePromise<void>;
  since?: string | null;
  limit?: number;
  signal?: AbortSignal;
  headers?: HeadersInit;
  cursorStore?: FabricEventCursorStore;
  minPollMs?: number;
  maxPollMs?: number;
  dedupeCacheSize?: number;
};

export type FabricEventsClient = {
  getEvents(params?: GetEventsRequest, options?: { signal?: AbortSignal; headers?: HeadersInit }): Promise<EventsListResponse>;
};

export type FabricWebhookHeaderValue = string | string[] | undefined | null;

export type FabricWebhookHeaders = Headers | Record<string, FabricWebhookHeaderValue>;

export type VerifyWebhookSignatureOptions = {
  toleranceSeconds?: number;
  now?: number | Date;
};

export type VerifyWebhookSignatureResult =
  | {
      ok: true;
      timestamp: number;
    }
  | {
      ok: false;
      reason:
        | 'missing_timestamp'
        | 'invalid_timestamp'
        | 'missing_signature'
        | 'timestamp_mismatch'
        | 'timestamp_out_of_range'
        | 'invalid_signature';
    };

const DEFAULT_EVENT_LIMIT = 50;
const DEFAULT_MIN_POLL_MS = 2_000;
const DEFAULT_MAX_POLL_MS = 5_000;
const DEFAULT_TOLERANCE_SECONDS = 300;

function asNonEmptyString(value: string | null | undefined) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function assertEventLimit(limit: number) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new RangeError('limit must be an integer between 1 and 100');
  }
}

function assertPollingOptions(minPollMs: number, maxPollMs: number, dedupeCacheSize: number) {
  if (!Number.isFinite(minPollMs) || minPollMs < 0) {
    throw new RangeError('minPollMs must be a non-negative number');
  }
  if (!Number.isFinite(maxPollMs) || maxPollMs < minPollMs) {
    throw new RangeError('maxPollMs must be greater than or equal to minPollMs');
  }
  if (!Number.isInteger(dedupeCacheSize) || dedupeCacheSize < 1) {
    throw new RangeError('dedupeCacheSize must be a positive integer');
  }
}

function normalizeCursor(value: string | null | undefined) {
  return asNonEmptyString(value) ?? null;
}

function rawBodyToBuffer(rawBody: string | Uint8Array) {
  return typeof rawBody === 'string' ? Buffer.from(rawBody, 'utf8') : Buffer.from(rawBody);
}

function computeWebhookSignature(secret: string, timestamp: string, rawBody: string | Uint8Array) {
  const payload = Buffer.concat([
    Buffer.from(`${timestamp}.`, 'utf8'),
    rawBodyToBuffer(rawBody),
  ]);
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function secureCompare(left: string, right: string) {
  const leftBuffer = Buffer.from(left, 'utf8');
  const rightBuffer = Buffer.from(right, 'utf8');
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function readHeader(headers: FabricWebhookHeaders, name: string) {
  if (headers instanceof Headers) {
    return asNonEmptyString(headers.get(name));
  }
  const needle = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== needle) continue;
    if (Array.isArray(value)) {
      for (const entry of value) {
        const normalized = asNonEmptyString(entry);
        if (normalized) return normalized;
      }
      return null;
    }
    return asNonEmptyString(value);
  }
  return null;
}

function parseFabricSignature(headerValue: string) {
  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const segment of headerValue.split(',')) {
    const [rawKey, ...rawValueParts] = segment.split('=');
    const key = rawKey?.trim().toLowerCase();
    const value = rawValueParts.join('=').trim();
    if (!key || !value) continue;
    if (key === 't') timestamp = value;
    if (key === 'v1') signatures.push(value);
  }
  return { timestamp, signatures };
}

function nowInSeconds(value: number | Date | undefined) {
  if (value instanceof Date) return Math.floor(value.getTime() / 1_000);
  if (typeof value === 'number' && Number.isFinite(value)) return Math.floor(value);
  return Math.floor(Date.now() / 1_000);
}

function abortError() {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw abortError();
}

function isAbortError(error: unknown) {
  return (error instanceof Error && error.name === 'AbortError')
    || (typeof error === 'object' && error !== null && (error as { name?: unknown }).name === 'AbortError');
}

function rememberSeenEvent(seenIds: Set<string>, seenOrder: string[], maxSize: number, eventId: string) {
  if (seenIds.has(eventId)) return;
  seenIds.add(eventId);
  seenOrder.push(eventId);
  while (seenOrder.length > maxSize) {
    const oldest = seenOrder.shift();
    if (oldest) seenIds.delete(oldest);
  }
}

async function delay(ms: number, signal: AbortSignal | undefined) {
  if (ms <= 0) return;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(abortError());
    }

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export function verifyWebhookSignature(
  rawBody: string | Uint8Array,
  headers: FabricWebhookHeaders,
  secret: string,
  options: VerifyWebhookSignatureOptions = {},
): VerifyWebhookSignatureResult {
  const timestampHeader = readHeader(headers, 'x-fabric-timestamp');
  if (!timestampHeader) return { ok: false, reason: 'missing_timestamp' };

  const timestamp = Number(timestampHeader);
  if (!Number.isInteger(timestamp) || timestamp < 0) {
    return { ok: false, reason: 'invalid_timestamp' };
  }

  const signatureHeader = readHeader(headers, 'x-fabric-signature');
  if (!signatureHeader) return { ok: false, reason: 'missing_signature' };

  const parsed = parseFabricSignature(signatureHeader);
  if (parsed.timestamp && parsed.timestamp !== timestampHeader) {
    return { ok: false, reason: 'timestamp_mismatch' };
  }
  if (parsed.signatures.length === 0) {
    return { ok: false, reason: 'missing_signature' };
  }

  const toleranceSeconds = options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS;
  const now = nowInSeconds(options.now);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    return { ok: false, reason: 'timestamp_out_of_range' };
  }

  const expected = computeWebhookSignature(secret, timestampHeader, rawBody);
  const matched = parsed.signatures.some((candidate) => secureCompare(candidate, expected));
  if (!matched) {
    return { ok: false, reason: 'invalid_signature' };
  }

  return { ok: true, timestamp };
}

export async function watchEvents(client: FabricEventsClient, options: WatchEventsOptions): Promise<void> {
  const limit = options.limit ?? DEFAULT_EVENT_LIMIT;
  assertEventLimit(limit);

  const minPollMs = options.minPollMs ?? DEFAULT_MIN_POLL_MS;
  const maxPollMs = options.maxPollMs ?? DEFAULT_MAX_POLL_MS;
  const dedupeCacheSize = options.dedupeCacheSize ?? Math.max(limit * 4, 256);
  assertPollingOptions(minPollMs, maxPollMs, dedupeCacheSize);

  let since = normalizeCursor(options.since);
  if (since === null && options.cursorStore?.load) {
    since = normalizeCursor(await options.cursorStore.load());
  }

  const seenIds = new Set<string>();
  const seenOrder: string[] = [];
  let idleDelayMs = minPollMs;

  while (true) {
    try {
      throwIfAborted(options.signal);

      const response = await client.getEvents(
        { since, limit },
        { signal: options.signal, headers: options.headers },
      );

      for (const event of response.events) {
        if (seenIds.has(event.id)) continue;
        await options.onEvent(event);
        rememberSeenEvent(seenIds, seenOrder, dedupeCacheSize, event.id);
      }

      const nextCursor = normalizeCursor(response.next_cursor);
      if (nextCursor) {
        since = nextCursor;
        if (options.cursorStore?.save) {
          await options.cursorStore.save(nextCursor);
        }
      }

      if (response.events.length === 0) {
        idleDelayMs = Math.min(maxPollMs, Math.max(minPollMs, idleDelayMs * 2 || minPollMs));
        await delay(idleDelayMs, options.signal);
        continue;
      }

      idleDelayMs = minPollMs;
      if (nextCursor && response.events.length === limit) continue;
      await delay(minPollMs, options.signal);
    } catch (error) {
      if (isAbortError(error)) return;
      if (options.onError) {
        await options.onError(error);
      }
      idleDelayMs = Math.min(maxPollMs, Math.max(minPollMs, idleDelayMs * 2 || minPollMs));
      await delay(idleDelayMs, options.signal);
    }
  }
}
