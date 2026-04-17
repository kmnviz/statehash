/**
 * Back-compat shim. The signer primitive moved into `signer-pool.ts` when we
 * introduced per-agent wallets; keep this module so that older call sites
 * (health check, startup log) continue to work while we migrate them.
 */
export {systemSigner as signer, type SignerBundle} from './signer-pool';
