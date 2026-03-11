import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import dotenv from 'dotenv';
import { Pool } from 'pg';

dotenv.config();

const BASE_URL = (process.env.BASE_URL?.trim() || 'https://fabric-api-393345198409.us-west1.run.app').replace(/\/+$/, '');
const EXAMPLE_ENV_VAR = 'FABRIC_EXAMPLE_ENV_PATH';
const resetRateLimits = /^(1|true|yes)$/i.test(process.env.SMOKE_RESET_RATE_LIMITS ?? '');

type ApiResponse = {
  status: number;
  text: string;
  json: any;
};

type ExampleRunResult = {
  bootstrap: any;
  search: any;
};

type SmokeState = {
  legalVersion: string;
  unitId: string;
  scopeNotes: string;
  sellerNodeId: string;
  buyerNodeId: string;
  buyerCredits: number;
  categoriesEnFirst: string | null;
  categoriesZhFirst: string | null;
  offerId: string;
  exampleOfferId: string;
  exampleNodeId: string;
};

function idemKey() {
  return `smoke-${crypto.randomUUID()}`;
}

function fail(message: string): never {
  throw new Error(message);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) fail(message);
}

function logStep(label: string) {
  process.stdout.write(`\n[smoke] ${label}\n`);
}

async function api(method: string, urlPath: string, options: { headers?: Record<string, string>; body?: unknown } = {}): Promise<ApiResponse> {
  const headers = { ...(options.headers ?? {}) };
  let body: string | undefined;
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
    headers['idempotency-key'] ??= idemKey();
    body = JSON.stringify(options.body);
  }
  const res = await fetch(`${BASE_URL}${urlPath}`, {
    method,
    headers,
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, text, json };
}

async function clearRateLimitCounters() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    fail('SMOKE_RESET_RATE_LIMITS=true requires DATABASE_URL');
  }
  const pool = new Pool({ connectionString });
  try {
    await pool.query('delete from rate_limit_counters');
  } finally {
    await pool.end();
  }
}

async function bootstrap(displayName: string, legalVersion: string): Promise<ApiResponse> {
  return api('POST', '/v1/bootstrap', {
    headers: {
      'user-agent': `prod-smoke/${displayName}`,
    },
    body: {
      display_name: displayName,
      email: null,
      referral_code: null,
      recovery_public_key: null,
      messaging_handles: [],
      legal: { accepted: true, version: legalVersion },
      language_tag: 'zh-CN',
    },
  });
}

async function bootstrapWithRetry(displayName: string, legalVersion: string): Promise<ApiResponse> {
  let response = await bootstrap(displayName, legalVersion);
  if (response.status !== 429) return response;
  if (!resetRateLimits) return response;
  await clearRateLimitCounters();
  response = await bootstrap(displayName, legalVersion);
  if (response.status === 429) {
    fail(`bootstrap still rate-limited after clearing rate_limit_counters; DATABASE_URL may not point at the database behind ${BASE_URL}`);
  }
  return response;
}

function runCommand(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
  });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) {
    const stderr = (result.stderr || '').trim();
    const stdout = (result.stdout || '').trim();
    fail(`${command} ${args.join(' ')} failed with status ${result.status ?? 1}\nstdout:\n${stdout}\nstderr:\n${stderr}`);
  }
  return (result.stdout || '').trim();
}

async function runPublicExamples(scopeNotes: string, expectedUnitId: string): Promise<ExampleRunResult> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fabric-smoke-'));
  const envPath = path.join(tempDir, 'examples.env');
  const env = {
    ...process.env,
    [EXAMPLE_ENV_VAR]: envPath,
  };

  try {
    await fs.writeFile(
      envPath,
      `BASE_URL=${BASE_URL}\nSEARCH_SCOPE_NOTES=${scopeNotes}\nOFFER_NOTE=prod smoke example offer\n`,
      'utf8',
    );

    const bootstrapStdout = runCommand(
      process.execPath,
      [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('examples/bootstrap-recovery-me.ts')],
      env,
      process.cwd(),
    );
    const bootstrapJson = JSON.parse(bootstrapStdout);
    assert(typeof bootstrapJson.api_key === 'string', 'example bootstrap did not return api_key');
    assert(bootstrapJson.credits_balance === 500, `example bootstrap credits_balance expected 500, got ${bootstrapJson.credits_balance}`);

    await fs.appendFile(envPath, `API_KEY=${bootstrapJson.api_key}\n`, 'utf8');

    const searchStdout = runCommand(
      process.execPath,
      [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('examples/search-offer.ts')],
      env,
      process.cwd(),
    );
    if (searchStdout.includes('No listings returned.')) {
      fail(`public example search returned no listings for scope_notes=${scopeNotes}`);
    }
    const searchJson = JSON.parse(searchStdout);
    assert(searchJson.selected_unit_id === expectedUnitId, `example selected_unit_id expected ${expectedUnitId}, got ${searchJson.selected_unit_id}`);
    assert(typeof searchJson.offer_id === 'string' && searchJson.offer_id.length > 0, 'example search did not create offer_id');
    return { bootstrap: bootstrapJson, search: searchJson };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function runDirectApiFlow(legalVersion: string): Promise<Omit<SmokeState, 'exampleOfferId' | 'exampleNodeId'>> {
  const token = Math.random().toString(36).slice(2, 10);
  const keyword = `\u5e03\u6599${token}`;
  const scopeNotes = `\u4e2d\u6587${keyword}\u4ea4\u6613`;
  const offerNote = `\u6211\u60f3\u8ba8\u8bba${keyword}`;

  const categoriesEn = await api('GET', '/v1/categories');
  assert(categoriesEn.status === 200, `GET /v1/categories failed: ${categoriesEn.status}`);
  const categoriesZh = await api('GET', '/v1/categories', {
    headers: { 'accept-language': 'zh-CN' },
  });
  assert(categoriesZh.status === 200, `GET /v1/categories zh-CN failed: ${categoriesZh.status}`);
  const categoriesEnFirst = categoriesEn.json?.categories?.[0]?.name ?? null;
  const categoriesZhFirst = categoriesZh.json?.categories?.[0]?.name ?? null;
  assert(categoriesEnFirst && categoriesZhFirst && categoriesEnFirst !== categoriesZhFirst, 'Accept-Language did not localize category names');

  const sellerBoot = await bootstrapWithRetry(`seller-${token}`, legalVersion);
  assert(sellerBoot.status === 200, `seller bootstrap failed: ${sellerBoot.status} ${sellerBoot.text}`);
  const buyerBoot = await bootstrapWithRetry(`buyer-${token}`, legalVersion);
  assert(buyerBoot.status === 200, `buyer bootstrap failed: ${buyerBoot.status} ${buyerBoot.text}`);

  const sellerApiKey = sellerBoot.json.api_key.api_key;
  const buyerApiKey = buyerBoot.json.api_key.api_key;
  const buyerMe = await api('GET', '/v1/me', {
    headers: { authorization: `ApiKey ${buyerApiKey}` },
  });
  assert(buyerMe.status === 200, `GET /v1/me for buyer failed: ${buyerMe.status} ${buyerMe.text}`);
  assert(buyerMe.json?.credits_balance === 500, `signup credits expected 500, got ${buyerMe.json?.credits_balance}`);

  const createUnit = await api('POST', '/v1/units', {
    headers: { authorization: `ApiKey ${sellerApiKey}` },
    body: {
      title: `\u4e2d\u6587${keyword}`,
      description: `\u9ad8\u8d28\u91cf${keyword}`,
      type: 'service',
      condition: null,
      quantity: 1,
      measure: 'EA',
      custom_measure: null,
      scope_primary: 'OTHER',
      scope_secondary: [],
      scope_notes: scopeNotes,
      location_text_public: null,
      origin_region: null,
      dest_region: null,
      service_region: null,
      delivery_format: null,
      max_ship_days: null,
      tags: [keyword, '\u68c9\u5e03'],
      category_ids: [],
      public_summary: `\u67d4\u8f6f${keyword}`,
      language_tag: 'zh-CN',
    },
  });
  assert(createUnit.status === 200, `create unit failed: ${createUnit.status} ${createUnit.text}`);
  const unitId = createUnit.json?.unit?.id;
  assert(typeof unitId === 'string', 'create unit response missing unit.id');

  const publishUnit = await api('POST', `/v1/units/${unitId}/publish`, {
    headers: { authorization: `ApiKey ${sellerApiKey}` },
    body: {},
  });
  assert(publishUnit.status === 200, `publish unit failed: ${publishUnit.status} ${publishUnit.text}`);

  const searchNull = await api('POST', '/v1/search/listings', {
    headers: { authorization: `ApiKey ${buyerApiKey}` },
    body: {
      q: null,
      scope: 'OTHER',
      filters: { scope_notes: scopeNotes },
      broadening: { level: 0, allow: false },
      budget: { credits_requested: 5 },
      limit: 20,
      cursor: null,
    },
  });
  assert(searchNull.status === 200, `q=null search failed: ${searchNull.status} ${searchNull.text}`);
  const nullHit = searchNull.json?.items?.find((entry: any) => entry?.item?.id === unitId);
  assert(nullHit, 'q=null search did not return created unit');

  const searchKeyword = await api('POST', '/v1/search/listings', {
    headers: { authorization: `ApiKey ${buyerApiKey}` },
    body: {
      q: keyword,
      scope: 'OTHER',
      filters: { scope_notes: scopeNotes },
      broadening: { level: 0, allow: false },
      budget: { credits_requested: 5 },
      limit: 20,
      cursor: null,
    },
  });
  assert(searchKeyword.status === 200, `keyword search failed: ${searchKeyword.status} ${searchKeyword.text}`);
  const keywordHit = searchKeyword.json?.items?.find((entry: any) => entry?.item?.id === unitId);
  assert(keywordHit, 'keyword search did not return created unit');
  assert(keywordHit.item.language_tag === 'zh-CN', `listing language_tag expected zh-CN, got ${keywordHit.item.language_tag}`);
  assert(keywordHit.item.scope_notes === scopeNotes, `listing scope_notes expected ${scopeNotes}, got ${keywordHit.item.scope_notes}`);

  const createOffer = await api('POST', '/v1/offers', {
    headers: { authorization: `ApiKey ${buyerApiKey}` },
    body: {
      unit_ids: [unitId],
      thread_id: null,
      note: offerNote,
      language_tag: 'zh-CN',
    },
  });
  assert(createOffer.status === 200, `create offer failed: ${createOffer.status} ${createOffer.text}`);
  const offerId = createOffer.json?.offer?.id;
  assert(typeof offerId === 'string', 'create offer response missing offer.id');

  const getOffer = await api('GET', `/v1/offers/${offerId}`, {
    headers: { authorization: `ApiKey ${buyerApiKey}` },
  });
  assert(getOffer.status === 200, `GET /v1/offers/${offerId} failed: ${getOffer.status} ${getOffer.text}`);
  assert(getOffer.json?.offer?.language_tag === 'zh-CN', `offer language_tag expected zh-CN, got ${getOffer.json?.offer?.language_tag}`);
  assert(getOffer.json?.offer?.note === offerNote, 'offer note did not round-trip');

  return {
    legalVersion,
    unitId,
    scopeNotes,
    sellerNodeId: sellerBoot.json.node.id,
    buyerNodeId: buyerBoot.json.node.id,
    buyerCredits: buyerMe.json.credits_balance,
    categoriesEnFirst,
    categoriesZhFirst,
    offerId,
  };
}

async function main() {
  logStep(`target ${BASE_URL}`);

  if (resetRateLimits) {
    logStep('clearing rate_limit_counters');
    await clearRateLimitCounters();
  }

  const meta = await api('GET', '/v1/meta');
  assert(meta.status === 200, `GET /v1/meta failed: ${meta.status} ${meta.text}`);
  const legalVersion = meta.json?.required_legal_version;
  assert(typeof legalVersion === 'string' && legalVersion.length > 0, 'required_legal_version missing from /v1/meta');

  logStep('direct API smoke');
  const direct = await runDirectApiFlow(legalVersion);

  logStep('public example smoke');
  const example = await runPublicExamples(direct.scopeNotes, direct.unitId);

  const summary: SmokeState = {
    ...direct,
    exampleOfferId: example.search.offer_id,
    exampleNodeId: example.bootstrap.bootstrap_node_id,
  };

  process.stdout.write(`\n${JSON.stringify(summary, null, 2)}\n`);
}

await main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
