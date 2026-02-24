import { sign } from 'node:crypto';

export type RecoverySignatureEncoding = 'base64' | 'hex';

export function buildRecoveryMessage(challengeId: string, nonce: string) {
  return `fabric-recovery:${challengeId}:${nonce}`;
}

export function signRecoveryMessage(
  message: string,
  privateKey: string | Buffer | { key: string | Buffer; passphrase?: string },
  encoding: RecoverySignatureEncoding = 'base64',
) {
  const payload = Buffer.from(message, 'utf8');
  const signature = sign(null, payload, privateKey);
  return signature.toString(encoding);
}
