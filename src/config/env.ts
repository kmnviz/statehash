import {z} from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  PORT: z
    .string()
    .min(1, 'PORT is required')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive())
    .default('8080'),
  NODE_ENV: z.enum(['development', 'production', 'test'], {
    errorMap: () => ({message: 'NODE_ENV must be one of: development, production, test'}),
  }).default('development'),
  LOG_LEVEL: z
    .enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'], {
      errorMap: () => ({message: 'LOG_LEVEL must be a valid winston log level'}),
    })
    .default('info'),
  MONGODB_URI: z.string().url('MONGODB_URI must be a valid URL'),
  MONGODB_DB_NAME: z.string().min(1).default('statehash'),
  STATEHASH_CHAIN_ID: z
    .string()
    .min(1, 'STATEHASH_CHAIN_ID is required')
    .transform((val) => parseInt(val, 10))
    .pipe(z.number().int().positive())
    .default('8453'),
  STATEHASH_BASE_RPC_URL: z.string().url('STATEHASH_BASE_RPC_URL must be a valid URL'),
  STATEHASH_SIGNER_PRIVATE_KEY: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'STATEHASH_SIGNER_PRIVATE_KEY must be 0x-prefixed 32-byte hex'),
  /**
   * 32-byte master key, base64-encoded. Used to envelope-encrypt per-agent
   * signing keys at rest (AES-256-GCM). Never logged, never stored in Mongo.
   * In Cloud Run this is sourced from Secret Manager.
   */
  STATEHASH_MASTER_KEY: z
    .string()
    .min(1, 'STATEHASH_MASTER_KEY is required')
    .refine(
      (val) => {
        try {
          return Buffer.from(val, 'base64').length === 32;
        } catch {
          return false;
        }
      },
      {message: 'STATEHASH_MASTER_KEY must be 32 bytes base64-encoded'}
    ),
  /**
   * Comma-separated `name:key:namespace` triples.
   * Example: `smartbettors:shk_abc:smartbettors,acme:shk_xyz:acme-prod`
   */
  STATEHASH_API_KEYS: z.string().min(1, 'STATEHASH_API_KEYS is required'),
});

export const env = envSchema.parse(process.env);
