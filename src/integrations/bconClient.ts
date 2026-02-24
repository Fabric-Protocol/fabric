import { config } from '../config.js';

const BCON_TIMEOUT_MS = 10_000;

export class BconConfigError extends Error {
  missing: string[];

  constructor(missing: string[]) {
    super(`Missing Bcon config: ${missing.join(', ')}`);
    this.name = 'BconConfigError';
    this.missing = missing;
  }
}

export class BconHttpError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = 'BconHttpError';
    this.status = status;
    this.body = body;
  }
}

type AddressInvoicePayload = {
  payment_currency: string;
  chain: string;
  external_id: string;
  origin_amount?: number;
  origin_currency?: string;
  payment_amount?: number;
};

function nonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function configBaseUrl() {
  const raw = nonEmptyString(config.bconApiBase) ?? 'https://external-api.bcon.global';
  return raw.replace(/\/+$/, '');
}

function bconHeaders() {
  const apiKey = nonEmptyString(config.bconStoreApiKey);
  if (!apiKey) throw new BconConfigError(['BCON_STORE_API_KEY']);
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

async function parseResponseBody(res: Response) {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function unwrapCandidate(payload: any) {
  if (!payload || typeof payload !== 'object') return payload;
  if (payload.data && typeof payload.data === 'object') return payload.data;
  if (payload.result && typeof payload.result === 'object') return payload.result;
  return payload;
}

async function bconRequest(path: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BCON_TIMEOUT_MS);
  try {
    const res = await fetch(`${configBaseUrl()}${path}`, { ...init, signal: controller.signal });
    const body = await parseResponseBody(res);
    if (!res.ok) {
      throw new BconHttpError(res.status, `Bcon request failed: ${res.status}`, body);
    }
    return body;
  } catch (err: any) {
    if (err?.name === 'AbortError') {
      throw new BconHttpError(504, 'Bcon request timed out', null);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function listCurrencies() {
  const headers = bconHeaders();
  const body = await bconRequest('/api/v1/currencies', {
    method: 'GET',
    headers,
  });
  return body;
}

export async function createAddressInvoice(params: AddressInvoicePayload) {
  const headers = bconHeaders();
  const body = await bconRequest('/api/v2/address', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });

  const candidate = unwrapCandidate(body);
  const address = nonEmptyString(candidate?.address ?? candidate?.addr ?? null);
  const paymentAmount = asFiniteNumber(candidate?.payment_amount ?? candidate?.amount ?? null);
  const paymentCurrency = nonEmptyString(candidate?.payment_currency ?? params.payment_currency);
  const chain = nonEmptyString(candidate?.chain ?? params.chain);

  return {
    address,
    payment_amount: paymentAmount,
    payment_currency: paymentCurrency,
    chain,
    raw: body,
  };
}
