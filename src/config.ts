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
  apiVersion: 'v1',
  requiredLegalVersion: '2026-02-17',
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
  rateLimitBootstrapPerHour: Number(process.env.RATE_LIMIT_BOOTSTRAP_PER_HOUR ?? 3),
  rateLimitSearchPerMinute: Number(process.env.RATE_LIMIT_SEARCH_PER_MINUTE ?? 20),
  rateLimitInventoryPerMinute: Number(process.env.RATE_LIMIT_INVENTORY_PER_MINUTE ?? 6),
  rateLimitOfferWritePerMinute: Number(process.env.RATE_LIMIT_OFFER_WRITE_PER_MINUTE ?? 30),
  rateLimitOfferDecisionPerMinute: Number(process.env.RATE_LIMIT_OFFER_DECISION_PER_MINUTE ?? 60),
  rateLimitRevealContactPerHour: Number(process.env.RATE_LIMIT_REVEAL_CONTACT_PER_HOUR ?? 10),
  rateLimitApiKeyIssuePerDay: Number(process.env.RATE_LIMIT_API_KEY_ISSUE_PER_DAY ?? 10),
};
