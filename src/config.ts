import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? '',
  adminKey: process.env.ADMIN_KEY ?? '',
  defaultRateLimitLimit: Number(process.env.DEFAULT_RATE_LIMIT_LIMIT ?? 1000),
  searchCreditCost: Number(process.env.SEARCH_CREDIT_COST ?? 2),
  signupGrantCredits: Number(process.env.SIGNUP_GRANT_CREDITS ?? 200),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
};
