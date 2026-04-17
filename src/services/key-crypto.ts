import crypto from 'crypto';
import {env} from '../config/env';

/**
 * Envelope encryption for per-agent signing keys.
 *
 * Model: each private key is AES-256-GCM encrypted with a master key that
 * lives in `STATEHASH_MASTER_KEY` (sourced from Secret Manager on Cloud Run).
 * The master key is never written to Mongo. A DB dump alone is therefore
 * insufficient to recover any agent's signing key — the attacker also needs
 * runtime access to the Cloud Run environment / Secret Manager secret.
 *
 * Migration path: when we move to Cloud KMS envelope encryption, the on-disk
 * shape of `EncryptedBlob` stays the same and we bump `keyVersion`, swap out
 * `unwrapMasterKey()` for a KMS `decrypt` call, and re-encrypt rows in the
 * background. The rest of the system is unchanged.
 */

const ALGO = 'aes-256-gcm';
const MASTER_KEY_BYTES = 32;
const IV_BYTES = 12;
const CURRENT_KEY_VERSION = 1;

export interface EncryptedBlob {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

let cachedMasterKey: Buffer | null = null;

function masterKey(): Buffer {
  if (cachedMasterKey) return cachedMasterKey;
  const decoded = Buffer.from(env.STATEHASH_MASTER_KEY, 'base64');
  if (decoded.length !== MASTER_KEY_BYTES) {
    throw new Error('STATEHASH_MASTER_KEY must decode to exactly 32 bytes');
  }
  cachedMasterKey = decoded;
  return decoded;
}

export function encryptSecret(plaintext: Buffer): EncryptedBlob {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, masterKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    ciphertext: ct.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decryptSecret(blob: EncryptedBlob): Buffer {
  if (blob.keyVersion !== CURRENT_KEY_VERSION) {
    throw new Error(
      `unsupported key version ${blob.keyVersion}; expected ${CURRENT_KEY_VERSION}`
    );
  }
  const decipher = crypto.createDecipheriv(
    ALGO,
    masterKey(),
    Buffer.from(blob.iv, 'base64')
  );
  decipher.setAuthTag(Buffer.from(blob.authTag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(blob.ciphertext, 'base64')),
    decipher.final(),
  ]);
}

/**
 * Generate a fresh 32-byte secp256k1 private key as a 0x-prefixed hex string.
 * The caller is responsible for immediately encrypting the returned value and
 * wiping its reference; we do not hold onto it.
 */
export function generateSigningKey(): {privateKey: `0x${string}`; bytes: Buffer} {
  const bytes = crypto.randomBytes(32);
  const hex = `0x${bytes.toString('hex')}` as `0x${string}`;
  return {privateKey: hex, bytes};
}
