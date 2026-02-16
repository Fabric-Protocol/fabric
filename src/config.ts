import dotenv from 'dotenv';
dotenv.config();

function parseCsv(value: string | undefined) {
  if (!value) return [] as string[];
  return value.split(',').map((item) => item.trim()).filter((item) => item.length > 0);
}

function parsePriceIds(listValue: string | undefined, singleValue: string | undefined) {
  const items = [...parseCsv(listValue)];
  const single = (singleValue ?? '').trim();
  if (single) items.push(single);
  return [...new Set(items)];
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? '',
  databaseSslCa: process.env.DATABASE_SSL_CA ?? '',
  adminKey: process.env.ADMIN_KEY ?? '',
  defaultRateLimitLimit: Number(process.env.DEFAULT_RATE_LIMIT_LIMIT ?? 1000),
  searchCreditCost: Number(process.env.SEARCH_CREDIT_COST ?? 2),
  signupGrantCredits: Number(process.env.SIGNUP_GRANT_CREDITS ?? 200),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  stripePriceIdsBasic: parsePriceIds(process.env.STRIPE_PRICE_IDS_BASIC, process.env.STRIPE_PRICE_BASIC),
  stripePriceIdsPlus: parsePriceIds(process.env.STRIPE_PRICE_IDS_PLUS, process.env.STRIPE_PRICE_PLUS),
  stripePriceIdsPro: parsePriceIds(process.env.STRIPE_PRICE_IDS_PRO, process.env.STRIPE_PRICE_PRO),
  stripePriceIdsBusiness: parsePriceIds(process.env.STRIPE_PRICE_IDS_BUSINESS, process.env.STRIPE_PRICE_BUSINESS),
};
