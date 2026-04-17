import {
  createPublicClient,
  createWalletClient,
  http,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import {privateKeyToAccount, type PrivateKeyAccount} from 'viem/accounts';
import {base, baseSepolia, type Chain} from 'viem/chains';
import {env} from '../config/env';
import {BASE_MAINNET_CHAIN_ID, BASE_SEPOLIA_CHAIN_ID} from '../config/chains';
import {decryptSecret} from './key-crypto';
import {signingKeyRepository} from '../repositories/signing-key.repository';
import {agentRepository} from '../repositories/agent.repository';
import logger from './logger';

export interface SignerBundle {
  chain: Chain;
  chainId: number;
  account: PrivateKeyAccount;
  publicClient: PublicClient;
  walletClient: WalletClient;
  /** `null` = default system signer; otherwise the owning agent id. */
  agentId: string | null;
}

function resolveChain(chainId: number): Chain {
  if (chainId === BASE_MAINNET_CHAIN_ID) return base;
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return baseSepolia;
  throw new Error(
    `unsupported STATEHASH_CHAIN_ID ${chainId}; use ${BASE_MAINNET_CHAIN_ID} (Base) or ${BASE_SEPOLIA_CHAIN_ID} (Base Sepolia)`
  );
}

function buildBundle(privateKey: Hex, agentId: string | null): SignerBundle {
  const chain = resolveChain(env.STATEHASH_CHAIN_ID);
  const transport = http(env.STATEHASH_BASE_RPC_URL);
  const account = privateKeyToAccount(privateKey);
  const publicClient = createPublicClient({chain, transport});
  const walletClient = createWalletClient({account, chain, transport});
  return {
    chain,
    chainId: env.STATEHASH_CHAIN_ID,
    account,
    publicClient,
    walletClient,
    agentId,
  };
}

/**
 * System signer — used when no agent_id is supplied on anchor creation. Keeps
 * the old "shared wallet" behaviour for customers not yet using agents.
 */
export const systemSigner: SignerBundle = buildBundle(
  env.STATEHASH_SIGNER_PRIVATE_KEY as Hex,
  null
);

/**
 * In-memory cache of agent signer bundles. Decrypting a key is cheap but we
 * avoid repeating it on every anchor. The cache is per-process; Cloud Run
 * revisions get a cold cache on cold start, which is fine.
 */
const agentBundleCache = new Map<string, SignerBundle>();

export async function getAgentSigner(agentId: string): Promise<SignerBundle> {
  const cached = agentBundleCache.get(agentId);
  if (cached) return cached;

  const stored = await signingKeyRepository.findByAgentId(agentId);
  if (!stored) {
    throw new Error(`no signing key for agent ${agentId}`);
  }

  const keyBytes = decryptSecret(stored.blob);
  try {
    const hex = `0x${keyBytes.toString('hex')}` as Hex;
    const bundle = buildBundle(hex, agentId);
    agentBundleCache.set(agentId, bundle);
    return bundle;
  } finally {
    keyBytes.fill(0);
  }
}

/**
 * Resolve a signer for an optional agent id. When `agentId` is provided we
 * verify the agent belongs to `namespace` before returning. This is the only
 * path callers should use from request handlers.
 */
export async function resolveSigner(
  agentId: string | null,
  namespace: string
): Promise<SignerBundle> {
  if (!agentId) return systemSigner;

  const agent = await agentRepository.findById(agentId);
  if (!agent) {
    throw new AgentResolveError(`agent ${agentId} not found`, 'agent_not_found');
  }
  if (agent.namespace !== namespace) {
    logger.warn('namespace_mismatch on agent signer resolution', {
      agentId,
      expected: namespace,
      got: agent.namespace,
    });
    throw new AgentResolveError(
      `agent ${agentId} does not belong to namespace ${namespace}`,
      'namespace_mismatch'
    );
  }

  return getAgentSigner(agentId);
}

export class AgentResolveError extends Error {
  public readonly code: 'agent_not_found' | 'namespace_mismatch';
  constructor(message: string, code: 'agent_not_found' | 'namespace_mismatch') {
    super(message);
    this.name = 'AgentResolveError';
    this.code = code;
  }
}
