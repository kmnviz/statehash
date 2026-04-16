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

export interface SignerBundle {
  chain: Chain;
  chainId: number;
  account: PrivateKeyAccount;
  publicClient: PublicClient;
  walletClient: WalletClient;
}

function resolveChain(chainId: number): Chain {
  if (chainId === BASE_MAINNET_CHAIN_ID) return base;
  if (chainId === BASE_SEPOLIA_CHAIN_ID) return baseSepolia;
  throw new Error(
    `unsupported STATEHASH_CHAIN_ID ${chainId}; use ${BASE_MAINNET_CHAIN_ID} (Base) or ${BASE_SEPOLIA_CHAIN_ID} (Base Sepolia)`
  );
}

/**
 * Single system signer per environment. Self-tx pattern (`to: signer, data:
 * commitmentHash`). The hash is what verifies; the signer is not a source of
 * trust, so a single wallet is fine.
 */
function createSigner(): SignerBundle {
  const chain = resolveChain(env.STATEHASH_CHAIN_ID);
  const transport = http(env.STATEHASH_BASE_RPC_URL);
  const account = privateKeyToAccount(env.STATEHASH_SIGNER_PRIVATE_KEY as Hex);
  const publicClient = createPublicClient({chain, transport});
  const walletClient = createWalletClient({account, chain, transport});
  return {
    chain,
    chainId: env.STATEHASH_CHAIN_ID,
    account,
    publicClient,
    walletClient,
  };
}

export const signer: SignerBundle = createSigner();
