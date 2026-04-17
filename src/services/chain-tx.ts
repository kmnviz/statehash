import type {Hex} from 'viem';
import type {SignerBundle} from './signer-pool';
import logger from './logger';

export interface SubmittedTx {
  txHash: Hex;
  blockNumber: number;
  blockTime: number;
}

/**
 * Per-wallet promise-chain mutex. Viem's sendTransaction auto-fetches the
 * nonce from the RPC, but under Cloud Run concurrency two parallel calls on
 * the same wallet can still read the same nonce before either has broadcast.
 * We serialize per-address so agent A's tx does not block agent B's tx.
 */
const submitChains: Map<string, Promise<unknown>> = new Map();

function withSubmitLock<T>(address: string, fn: () => Promise<T>): Promise<T> {
  const key = address.toLowerCase();
  const prev = submitChains.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn);
  submitChains.set(
    key,
    next.catch(() => undefined)
  );
  return next;
}

/**
 * Submit a self-tx that encodes `data` as calldata from `signer`'s wallet.
 * The on-chain artifact is the calldata byte string plus the `from` address —
 * the latter is what makes agent anchors independently enumerable on-chain.
 */
export function submitCommitmentTx(signer: SignerBundle, data: Hex): Promise<SubmittedTx> {
  return withSubmitLock(signer.account.address, async () => {
    const txHash = await signer.walletClient.sendTransaction({
      account: signer.account,
      to: signer.account.address,
      data,
      value: 0n,
      chain: signer.chain,
    });

    const receipt = await signer.publicClient.waitForTransactionReceipt({hash: txHash});
    if (receipt.blockNumber == null) {
      throw new Error(`tx was not mined (missing blockNumber): ${txHash}`);
    }
    const blockTime = await resolveBlockTimeSeconds(signer, receipt.blockNumber, txHash);
    return {
      txHash,
      blockNumber: Number(receipt.blockNumber),
      blockTime,
    };
  });
}

async function resolveBlockTimeSeconds(
  signer: SignerBundle,
  blockNumber: bigint,
  txHash: Hex
): Promise<number> {
  const delaysMs = [250, 750, 1500];
  let lastErr: unknown;

  for (let attempt = 0; attempt <= delaysMs.length; attempt++) {
    try {
      const block = await signer.publicClient.getBlock({blockNumber});
      return Number(block.timestamp);
    } catch (err) {
      lastErr = err;
      if (attempt < delaysMs.length) {
        await new Promise((r) => setTimeout(r, delaysMs[attempt]));
      }
    }
  }

  logger.warn('RPC could not fetch block by number; using wall-clock timestamp', {
    txHash,
    blockNumber: blockNumber.toString(),
    error: lastErr instanceof Error ? lastErr.message : String(lastErr),
  });
  return Math.floor(Date.now() / 1000);
}
