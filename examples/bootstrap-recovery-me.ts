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

loadEnv({ path: 'examples/.env' });
loadEnv();

async function main() {
  const baseUrl = process.env.BASE_URL?.trim() || 'http://127.0.0.1:3000';

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

  console.log(JSON.stringify({
    required_legal_version: meta.required_legal_version,
    bootstrap_node_id: boot.node.id,
    recovery_challenge_id: challenge.challenge_id,
    recovered_key_id: recovered.key_id,
    me_node_id: me.node.id,
    me_plan: me.node.plan,
    credits_balance: me.credits_balance,
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
