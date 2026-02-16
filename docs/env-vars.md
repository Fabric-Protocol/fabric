# Environment Variables

## Required runtime env vars

### `DATABASE_URL`
- Supabase Postgres DIRECT connection string.
- Placeholder format:
  - `postgresql://postgres:[PASSWORD]@db.[PROJECT_REF].supabase.co:5432/postgres`
- Get this from Supabase Dashboard -> Project -> Connect -> Direct connection string.
- Use provider defaults / SSL required.

### `ADMIN_KEY`
- Admin authentication secret for `/v1/admin/*` endpoints.

### `STRIPE_SECRET_KEY`
- Stripe API secret key for server-side Stripe operations.

### `STRIPE_WEBHOOK_SECRET`
- Stripe signing secret used to verify `POST /v1/webhooks/stripe`.

## Other env vars used by the app

Scanned from `process.env.*` usage in `src/config.ts`:
- `PORT`
- `HOST`
- `DEFAULT_RATE_LIMIT_LIMIT`
- `SEARCH_CREDIT_COST`
- `SIGNUP_GRANT_CREDITS`

Note: `DEFAULT_RATE_LIMIT_LIMIT`, `SEARCH_CREDIT_COST`, and `SIGNUP_GRANT_CREDITS` are numeric.
