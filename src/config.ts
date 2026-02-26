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

function parseEmailProvider(value: string | undefined) {
  const normalized = (value ?? 'stub').trim().toLowerCase();
  if (normalized === 'smtp' || normalized === 'sendgrid' || normalized === 'resend' || normalized === 'stub') return normalized;
  return 'stub';
}

function parseBoolean(value: string | undefined, defaultValue: boolean) {
  if (value === undefined) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') return false;
  return defaultValue;
}

export const config = {
  apiVersion: 'v1',
  requiredLegalVersion: '2026-02-17',
  port: Number(process.env.PORT ?? 8080),
  host: process.env.HOST ?? '0.0.0.0',
  databaseUrl: process.env.DATABASE_URL ?? '',
  databaseSslCa: process.env.DATABASE_SSL_CA ?? '',
  // TODO: Move ADMIN_KEY to GCP Secret Manager instead of env var for production.
  adminKey: process.env.ADMIN_KEY ?? '',
  defaultRateLimitLimit: Number(process.env.DEFAULT_RATE_LIMIT_LIMIT ?? 1000),
  searchCreditCost: Number(process.env.SEARCH_CREDIT_COST ?? 5),
  searchTargetCreditCost: Number(process.env.SEARCH_TARGET_CREDIT_COST ?? 1),
  nodeCategoryDrilldownCost: Number(process.env.NODE_CATEGORY_DRILLDOWN_COST ?? 1),
  nodeCategoryDrilldownHighCost: Number(process.env.NODE_CATEGORY_DRILLDOWN_HIGH_COST ?? 5),
  drilldownHighCostPageFrom: Number(process.env.DRILLDOWN_HIGH_COST_PAGE_FROM ?? 11),
  rateLimitCategoriesSummaryPerMinute: Number(process.env.RATE_LIMIT_CATEGORIES_SUMMARY_PER_MINUTE ?? 30),
  rateLimitDrilldownPerNodePerMinute: Number(process.env.RATE_LIMIT_DRILLDOWN_PER_NODE_PER_MINUTE ?? 5),
  drilldownDailyCapFree: Number(process.env.DRILLDOWN_DAILY_CAP_FREE ?? 20),
  drilldownDailyCapBasic: Number(process.env.DRILLDOWN_DAILY_CAP_BASIC ?? 200),
  searchPageProhibitiveFrom: Number(process.env.SEARCH_PAGE_PROHIBITIVE_FROM ?? 6),
  searchPageProhibitiveCost: Number(process.env.SEARCH_PAGE_PROHIBITIVE_COST ?? 100),
  signupGrantCredits: Number(process.env.SIGNUP_GRANT_CREDITS ?? 100),
  requestMilestoneThreshold: Number(process.env.REQUEST_MILESTONE_THRESHOLD ?? 20),
  requestMilestoneCreditGrant: Number(process.env.REQUEST_MILESTONE_CREDIT_GRANT ?? 200),
  referralMaxGrantsPerReferrer: Number(process.env.REFERRAL_MAX_GRANTS_PER_REFERRER ?? 50),
  dealAcceptanceFeeCredits: Number(process.env.DEAL_ACCEPTANCE_FEE_CREDITS ?? 1),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  stripeEnforceLivemode: parseBoolean(process.env.STRIPE_ENFORCE_LIVEMODE, process.env.NODE_ENV === 'production'),
  stripePriceIdsBasic: parsePriceIds(process.env.STRIPE_PRICE_IDS_BASIC, process.env.STRIPE_PRICE_BASIC),
  stripePriceIdsPro: parsePriceIds(process.env.STRIPE_PRICE_IDS_PRO, process.env.STRIPE_PRICE_PRO),
  stripePriceIdsBusiness: parsePriceIds(process.env.STRIPE_PRICE_IDS_BUSINESS, process.env.STRIPE_PRICE_BUSINESS),
  stripeCreditPackPrice500: process.env.STRIPE_CREDIT_PACK_PRICE_500 ?? '',
  stripeCreditPackPrice1500: process.env.STRIPE_CREDIT_PACK_PRICE_1500 ?? '',
  stripeCreditPackPrice4500: process.env.STRIPE_CREDIT_PACK_PRICE_4500 ?? '',
  emailProvider: parseEmailProvider(process.env.EMAIL_PROVIDER),
  emailFrom: process.env.EMAIL_FROM ?? 'noreply@fabric.local',
  sendgridApiKey: process.env.SENDGRID_API_KEY ?? '',
  resendApiKey: process.env.RESEND_API_KEY ?? '',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  smtpSecure: process.env.SMTP_SECURE === 'true',
  recoveryChallengeTtlMinutes: Number(process.env.RECOVERY_CHALLENGE_TTL_MINUTES ?? 10),
  recoveryChallengeMaxAttempts: Number(process.env.RECOVERY_CHALLENGE_MAX_ATTEMPTS ?? 5),
  creditPack500Credits: Number(process.env.CREDIT_PACK_500_CREDITS ?? 500),
  creditPack1500Credits: Number(process.env.CREDIT_PACK_1500_CREDITS ?? 1500),
  creditPack4500Credits: Number(process.env.CREDIT_PACK_4500_CREDITS ?? 4500),
  creditPack500PriceCents: Number(process.env.CREDIT_PACK_500_PRICE_CENTS ?? 999),
  creditPack1500PriceCents: Number(process.env.CREDIT_PACK_1500_PRICE_CENTS ?? 1999),
  creditPack4500PriceCents: Number(process.env.CREDIT_PACK_4500_PRICE_CENTS ?? 4999),
  creditPackMaxGrantsPerDay: Number(process.env.CREDIT_PACK_MAX_GRANTS_PER_DAY ?? 3),
  rateLimitBootstrapPerHour: Number(process.env.RATE_LIMIT_BOOTSTRAP_PER_HOUR ?? 3),
  rateLimitSearchPerMinute: Number(process.env.RATE_LIMIT_SEARCH_PER_MINUTE ?? 20),
  rateLimitSearchScrapePerMinute: Number(process.env.RATE_LIMIT_SEARCH_SCRAPE_PER_MINUTE ?? 1),
  searchBroadQueryWindowSeconds: Number(process.env.SEARCH_BROAD_QUERY_WINDOW_SECONDS ?? 60),
  searchBroadQueryThreshold: Number(process.env.SEARCH_BROAD_QUERY_THRESHOLD ?? 3),
  searchBroadeningHighThreshold: Number(process.env.SEARCH_BROADENING_HIGH_THRESHOLD ?? 2),
  rateLimitCreditsQuotePerMinute: Number(process.env.RATE_LIMIT_CREDITS_QUOTE_PER_MINUTE ?? 60),
  rateLimitCreditPackCheckoutPerDay: Number(process.env.RATE_LIMIT_CREDIT_PACK_CHECKOUT_PER_DAY ?? 10),
  rateLimitInventoryPerMinute: Number(process.env.RATE_LIMIT_INVENTORY_PER_MINUTE ?? 6),
  rateLimitNodeCategoryDrilldownPerMinute: Number(process.env.RATE_LIMIT_NODE_CATEGORY_DRILLDOWN_PER_MINUTE ?? 10),
  rateLimitOfferWritePerMinute: Number(process.env.RATE_LIMIT_OFFER_WRITE_PER_MINUTE ?? 30),
  rateLimitOfferDecisionPerMinute: Number(process.env.RATE_LIMIT_OFFER_DECISION_PER_MINUTE ?? 60),
  rateLimitRevealContactPerHour: Number(process.env.RATE_LIMIT_REVEAL_CONTACT_PER_HOUR ?? 10),
  rateLimitMePatchPerMinute: Number(process.env.RATE_LIMIT_ME_PATCH_PER_MINUTE ?? 20),
  eventWebhookRetryWindowMinutes: Number(process.env.EVENT_WEBHOOK_RETRY_WINDOW_MINUTES ?? 30),
  eventWebhookRetryBaseMs: Number(process.env.EVENT_WEBHOOK_RETRY_BASE_MS ?? 1000),
  eventWebhookRetryMaxMs: Number(process.env.EVENT_WEBHOOK_RETRY_MAX_MS ?? 300000),
  rateLimitApiKeyIssuePerDay: Number(process.env.RATE_LIMIT_API_KEY_ISSUE_PER_DAY ?? 10),
  rateLimitRecoveryStartPerHour: Number(process.env.RATE_LIMIT_RECOVERY_START_PER_HOUR ?? 20),
  rateLimitRecoveryStartPerNodePerHour: Number(process.env.RATE_LIMIT_RECOVERY_START_PER_NODE_PER_HOUR ?? 5),
  rateLimitEmailVerifyStartPerHour: Number(process.env.RATE_LIMIT_EMAIL_VERIFY_START_PER_HOUR ?? 10),
  mcpUrl: process.env.MCP_URL ?? '',
  rateLimitMcpPerMinute: Number(process.env.RATE_LIMIT_MCP_PER_MINUTE ?? 60),
  checkoutRedirectAllowlist: parseCsv(process.env.CHECKOUT_REDIRECT_ALLOWLIST),
  apiKeyPepper: process.env.API_KEY_PEPPER ?? '',
  slackOpsWebhookUrl: process.env.SLACK_OPS_WEBHOOK_URL ?? '',
  nowpaymentsApiKey: process.env.NOWPAYMENTS_API_KEY ?? '',
  nowpaymentsIpnSecret: process.env.NOWPAYMENTS_IPN_SECRET ?? '',
  nowpaymentsApiBase: process.env.NOWPAYMENTS_API_BASE ?? 'https://api.nowpayments.io/v1',
  cryptoCreditPackEnabled: parseBoolean(process.env.CRYPTO_CREDIT_PACK_ENABLED, true),
  rateLimitCryptoCreditPackPerDay: Number(process.env.RATE_LIMIT_CRYPTO_CREDIT_PACK_PER_DAY ?? 10),
};
