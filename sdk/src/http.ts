import { FabricError, FabricHttpError, parseErrorEnvelope } from './errors.js';
import { generateIdempotencyKey } from './idempotency.js';

export type FabricHttpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT';

export type FabricRequestOptions = {
  idempotencyKey?: string;
  signal?: AbortSignal;
  headers?: HeadersInit;
};

export type FabricRequestConfig<TBody = unknown> = FabricRequestOptions & {
  baseUrl: string;
  apiKey?: string;
  method: FabricHttpMethod;
  path: string;
  body?: TBody;
  fetchImpl?: typeof fetch;
};

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function ensureJsonParsed(rawText: string) {
  if (rawText.length === 0) return null;
  try {
    return JSON.parse(rawText) as unknown;
  } catch {
    return rawText;
  }
}

export async function requestJson<TResponse, TBody = unknown>(config: FabricRequestConfig<TBody>): Promise<TResponse> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const url = new URL(config.path.replace(/^\//, ''), normalizeBaseUrl(config.baseUrl));
  const headers = new Headers(config.headers ?? {});

  if (config.apiKey) {
    headers.set('Authorization', `ApiKey ${config.apiKey}`);
  }

  const method = config.method.toUpperCase() as FabricHttpMethod;
  const isGet = method === 'GET';

  if (!isGet && !headers.has('Idempotency-Key')) {
    headers.set('Idempotency-Key', config.idempotencyKey ?? generateIdempotencyKey());
  }

  if (config.body !== undefined && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetchImpl(url, {
    method,
    headers,
    body: config.body === undefined ? undefined : JSON.stringify(config.body),
    signal: config.signal,
  });

  const rawText = await response.text();
  const parsed = ensureJsonParsed(rawText);

  if (!response.ok) {
    const envelope = parseErrorEnvelope(parsed);
    if (envelope) {
      throw new FabricError(response.status, envelope.error.code, envelope.error.message, envelope.error.details);
    }
    throw new FabricHttpError(response.status, `HTTP ${response.status}`, rawText, parsed);
  }

  if (rawText.length === 0) {
    return undefined as TResponse;
  }
  if (typeof parsed === 'string') {
    throw new FabricHttpError(response.status, 'Expected JSON response body', rawText, parsed);
  }
  return parsed as TResponse;
}
