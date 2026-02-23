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
  if (normalized === 'smtp' || normalized === 'sendgrid' || normalized === 'stub') return normalized;
  return 'stub';
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
  searchCreditCost: Number(process.env.SEARCH_CREDIT_COST ?? 5),
  searchTargetCreditCost: Number(process.env.SEARCH_TARGET_CREDIT_COST ?? 1),
  nodeCategoryDrilldownCost: Number(process.env.NODE_CATEGORY_DRILLDOWN_COST ?? 1),
  searchPageProhibitiveFrom: Number(process.env.SEARCH_PAGE_PROHIBITIVE_FROM ?? 6),
  searchPageProhibitiveCost: Number(process.env.SEARCH_PAGE_PROHIBITIVE_COST ?? 100),
  signupGrantCredits: Number(process.env.SIGNUP_GRANT_CREDITS ?? 100),
  uploadTrialThreshold: Number(process.env.UPLOAD_TRIAL_THRESHOLD ?? 20),
  uploadTrialDurationDays: Number(process.env.UPLOAD_TRIAL_DURATION_DAYS ?? 7),
  uploadTrialCreditGrant: Number(process.env.UPLOAD_TRIAL_CREDIT_GRANT ?? 200),
  requestMilestoneThreshold: Number(process.env.REQUEST_MILESTONE_THRESHOLD ?? 20),
  requestMilestoneCreditGrant: Number(process.env.REQUEST_MILESTONE_CREDIT_GRANT ?? 200),
  referralMaxGrantsPerReferrer: Number(process.env.REFERRAL_MAX_GRANTS_PER_REFERRER ?? 50),
  dealAcceptanceFeeCredits: Number(process.env.DEAL_ACCEPTANCE_FEE_CREDITS ?? 1),
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  stripePriceIdsBasic: parsePriceIds(process.env.STRIPE_PRICE_IDS_BASIC, process.env.STRIPE_PRICE_BASIC),
  stripePriceIdsPro: parsePriceIds(process.env.STRIPE_PRICE_IDS_PRO, process.env.STRIPE_PRICE_PRO),
  stripePriceIdsBusiness: parsePriceIds(process.env.STRIPE_PRICE_IDS_BUSINESS, process.env.STRIPE_PRICE_BUSINESS),
  stripeTopupPrice100: process.env.STRIPE_TOPUP_PRICE_100 ?? '',
  stripeTopupPrice300: process.env.STRIPE_TOPUP_PRICE_300 ?? '',
  stripeTopupPrice1000: process.env.STRIPE_TOPUP_PRICE_1000 ?? '',
  emailProvider: parseEmailProvider(process.env.EMAIL_PROVIDER),
  emailFrom: process.env.EMAIL_FROM ?? 'noreply@fabric.local',
  sendgridApiKey: process.env.SENDGRID_API_KEY ?? '',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 587),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPass: process.env.SMTP_PASS ?? '',
  smtpSecure: process.env.SMTP_SECURE === 'true',
  recoveryChallengeTtlMinutes: Number(process.env.RECOVERY_CHALLENGE_TTL_MINUTES ?? 10),
  recoveryChallengeMaxAttempts: Number(process.env.RECOVERY_CHALLENGE_MAX_ATTEMPTS ?? 5),
  topupPack100Credits: Number(process.env.TOPUP_PACK_100_CREDITS ?? 100),
  topupPack300Credits: Number(process.env.TOPUP_PACK_300_CREDITS ?? 300),
  topupPack1000Credits: Number(process.env.TOPUP_PACK_1000_CREDITS ?? 1000),
  topupPack100PriceCents: Number(process.env.TOPUP_PACK_100_PRICE_CENTS ?? 399),
  topupPack300PriceCents: Number(process.env.TOPUP_PACK_300_PRICE_CENTS ?? 1199),
  topupPack1000PriceCents: Number(process.env.TOPUP_PACK_1000_PRICE_CENTS ?? 3999),
  topupMaxGrantsPerDay: Number(process.env.TOPUP_MAX_GRANTS_PER_DAY ?? 3),
  rateLimitBootstrapPerHour: Number(process.env.RATE_LIMIT_BOOTSTRAP_PER_HOUR ?? 3),
  rateLimitSearchPerMinute: Number(process.env.RATE_LIMIT_SEARCH_PER_MINUTE ?? 20),
  rateLimitSearchScrapePerMinute: Number(process.env.RATE_LIMIT_SEARCH_SCRAPE_PER_MINUTE ?? 1),
  searchBroadQueryWindowSeconds: Number(process.env.SEARCH_BROAD_QUERY_WINDOW_SECONDS ?? 60),
  searchBroadQueryThreshold: Number(process.env.SEARCH_BROAD_QUERY_THRESHOLD ?? 3),
  searchBroadeningHighThreshold: Number(process.env.SEARCH_BROADENING_HIGH_THRESHOLD ?? 2),
  rateLimitCreditsQuotePerMinute: Number(process.env.RATE_LIMIT_CREDITS_QUOTE_PER_MINUTE ?? 60),
  rateLimitTopupCheckoutPerDay: Number(process.env.RATE_LIMIT_TOPUP_CHECKOUT_PER_DAY ?? 10),
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
};
