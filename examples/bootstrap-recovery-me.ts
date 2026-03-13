import { generateKeyPairSync } from 'node:crypto';
import { config as loadEnv } from 'dotenv';
import {
  FabricClient,
  FabricError,
  buildRecoveryMessage,
  requestJson,
  signRecoveryMessage,
  type BootstrapRequest,
  type BootstrapResponse,
  type MetaResponse,
} from '../sdk/src/index.ts';

type ExampleUnitCreateRequest = {
  title: string;
  description: string | null;
  type: string | null;
  condition: 'new' | 'like_new' | 'good' | 'fair' | 'poor' | 'unknown' | null;
  quantity: number;
  estimated_value?: number | null;
  measure: 'EA' | 'KG' | 'LB' | 'L' | 'GAL' | 'M' | 'FT' | 'HR' | 'DAY' | 'LOT' | 'CUSTOM' | null;
  custom_measure: string | null;
  scope_primary: 'local_in_person' | 'remote_online_service' | 'ship_to' | 'digital_delivery' | 'OTHER' | null;
  scope_secondary: string[];
  scope_notes: string | null;
  location_text_public: string | null;
  origin_region: null;
  dest_region: null;
  service_region: null;
  delivery_format: string | null;
  tags: string[];
  category_ids: number[];
  public_summary: string | null;
  language_tag: string | null;
};

type ExampleUnitCreateResponse = {
  unit: {
    id: string;
  };
};

const envPath = process.env.FABRIC_EXAMPLE_ENV_PATH?.trim() || 'examples/.env';
loadEnv({ path: envPath });
loadEnv();

async function main() {
  const baseUrl = process.env.BASE_URL?.trim() || 'http://127.0.0.1:3000';
  const seededScopeNotes = process.env.SEARCH_SCOPE_NOTES?.trim() || 'sdk-example-scope';

  const meta = await requestJson<MetaResponse>({
    baseUrl,
    method: 'GET',
    path: '/v1/meta',
  });

  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const recoveryPublicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  const recoveryPrivateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

  const displayName = process.env.BOOTSTRAP_DISPLAY_NAME?.trim() || `sdk-example-${Date.now()}`;
  const email = process.env.BOOTSTRAP_EMAIL?.trim() || null;

  const bootstrapBody: BootstrapRequest = {
    display_name: displayName,
    email,
    referral_code: null,
    recovery_public_key: recoveryPublicKeyPem,
    messaging_handles: [],
    legal: {
      accepted: true,
      version: meta.required_legal_version,
    },
  };

  const boot = await requestJson<BootstrapResponse, BootstrapRequest>({
    baseUrl,
    method: 'POST',
    path: '/v1/bootstrap',
    body: bootstrapBody,
  });

  const client = new FabricClient({
    baseUrl,
    apiKey: boot.api_key.api_key,
  });

  const challenge = await client.recoveryStart({
    node_id: boot.node.id,
    method: 'pubkey',
  });

  const recoveryMessage = buildRecoveryMessage(challenge.challenge_id, challenge.nonce);
  const signature = signRecoveryMessage(recoveryMessage, recoveryPrivateKeyPem, 'base64');

  const recovered = await client.recoveryComplete({
    challenge_id: challenge.challenge_id,
    signature,
  });

  const recoveredClient = new FabricClient({
    baseUrl,
    apiKey: recovered.api_key,
  });
  const me = await recoveredClient.me();

  const sellerBoot = await requestJson<BootstrapResponse, BootstrapRequest>({
    baseUrl,
    method: 'POST',
    path: '/v1/bootstrap',
    body: {
      display_name: `sdk-example-seller-${Date.now()}`,
      language_tag: null,
      email: null,
      referral_code: null,
      recovery_public_key: null,
      messaging_handles: [],
      legal: {
        accepted: true,
        version: meta.required_legal_version,
      },
    },
  });

  const sellerUnit = await requestJson<ExampleUnitCreateResponse, ExampleUnitCreateRequest>({
    baseUrl,
    apiKey: sellerBoot.api_key.api_key,
    method: 'POST',
    path: '/v1/units',
    body: {
      title: 'Seeded demo listing',
      description: 'Demo listing seeded for the public search-offer walkthrough.',
      type: 'service',
      condition: null,
      quantity: 1,
      estimated_value: null,
      measure: 'EA',
      custom_measure: null,
      scope_primary: 'OTHER',
      scope_secondary: [],
      scope_notes: seededScopeNotes,
      location_text_public: null,
      origin_region: null,
      dest_region: null,
      service_region: null,
      delivery_format: null,
      tags: ['example', 'seeded'],
      category_ids: [],
      public_summary: 'Seeded demo listing for search walkthrough.',
      language_tag: 'en',
    },
  });

  console.log(JSON.stringify({
    required_legal_version: meta.required_legal_version,
    bootstrap_node_id: boot.node.id,
    recovery_challenge_id: challenge.challenge_id,
    api_key: recovered.api_key,
    recovered_key_id: recovered.key_id,
    me_node_id: me.node.id,
    me_plan: me.node.plan,
    credits_balance: me.credits_balance,
    search_scope_notes: seededScopeNotes,
    search_target_node_id: sellerBoot.node.id,
    seeded_listing_unit_id: sellerUnit.unit.id,
  }, null, 2));
}

main().catch((error) => {
  if (error instanceof FabricError) {
    console.error(JSON.stringify({
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details ?? null,
    }, null, 2));
    process.exit(1);
  }
  console.error(error);
  process.exit(1);
});
