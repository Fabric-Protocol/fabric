import crypto from 'node:crypto';
import { config } from '../config.js';

export type CryptoPaymentResult = {
  payment_id: number;
  payment_status: string;
  pay_address: string;
  pay_amount: number;
  pay_currency: string;
  price_amount: number;
  price_currency: string;
  order_id: string;
  expiration_estimate_date?: string;
  purchase_id?: string;
};

export type NowPaymentsError = {
  ok: false;
  status: number;
  code: string;
  message: string;
};

export type CreatePaymentParams = {
  priceAmount: number;
  priceCurrency: string;
  payCurrency: string;
  orderId: string;
  ipnCallbackUrl: string;
  orderDescription?: string;
};

function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(obj as Record<string, unknown>).sort()) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

export function verifyIpnSignature(body: Record<string, unknown>, signatureHeader: string): boolean {
  if (!config.nowpaymentsIpnSecret) return false;
  const sorted = sortObjectKeys(body);
  const hmac = crypto.createHmac('sha512', config.nowpaymentsIpnSecret);
  hmac.update(JSON.stringify(sorted));
  const expected = hmac.digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signatureHeader, 'hex'));
  } catch {
    return false;
  }
}

export async function createPayment(params: CreatePaymentParams): Promise<CryptoPaymentResult | NowPaymentsError> {
  if (!config.nowpaymentsApiKey) {
    return { ok: false, status: 422, code: 'crypto_not_configured', message: 'NOWPayments API key not configured' };
  }

  const body = {
    price_amount: params.priceAmount,
    price_currency: params.priceCurrency,
    pay_currency: params.payCurrency,
    order_id: params.orderId,
    ipn_callback_url: params.ipnCallbackUrl,
    order_description: params.orderDescription ?? undefined,
  };

  try {
    const res = await fetch(`${config.nowpaymentsApiBase}/payment`, {
      method: 'POST',
      headers: {
        'x-api-key': config.nowpaymentsApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        status: res.status,
        code: 'nowpayments_api_error',
        message: `NOWPayments returned ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    const data = await res.json() as CryptoPaymentResult;
    return data;
  } catch (err: any) {
    return {
      ok: false,
      status: 502,
      code: 'nowpayments_unreachable',
      message: err?.message ?? 'Failed to reach NOWPayments API',
    };
  }
}

export async function getAvailableCurrencies(): Promise<string[] | NowPaymentsError> {
  if (!config.nowpaymentsApiKey) {
    return { ok: false, status: 422, code: 'crypto_not_configured', message: 'NOWPayments API key not configured' };
  }

  try {
    const res = await fetch(`${config.nowpaymentsApiBase}/currencies`, {
      headers: { 'x-api-key': config.nowpaymentsApiKey },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return { ok: false, status: res.status, code: 'nowpayments_api_error', message: `NOWPayments returned ${res.status}` };
    }

    const data = await res.json() as { currencies: string[] };
    return data.currencies ?? [];
  } catch (err: any) {
    return { ok: false, status: 502, code: 'nowpayments_unreachable', message: err?.message ?? 'Failed to reach NOWPayments API' };
  }
}

export async function getMinimumPaymentAmount(fromCurrency: string, toCurrency: string): Promise<{ min_amount: number } | NowPaymentsError> {
  if (!config.nowpaymentsApiKey) {
    return { ok: false, status: 422, code: 'crypto_not_configured', message: 'NOWPayments API key not configured' };
  }

  try {
    const res = await fetch(
      `${config.nowpaymentsApiBase}/min-amount?currency_from=${encodeURIComponent(fromCurrency)}&currency_to=${encodeURIComponent(toCurrency)}`,
      {
        headers: { 'x-api-key': config.nowpaymentsApiKey },
        signal: AbortSignal.timeout(10_000),
      },
    );

    if (!res.ok) {
      return { ok: false, status: res.status, code: 'nowpayments_api_error', message: `NOWPayments returned ${res.status}` };
    }

    return await res.json() as { min_amount: number };
  } catch (err: any) {
    return { ok: false, status: 502, code: 'nowpayments_unreachable', message: err?.message ?? 'Failed to reach NOWPayments API' };
  }
}
