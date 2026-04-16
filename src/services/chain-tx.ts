import type {Hex} from 'viem';
import {signer} from './signer';
import logger from './logger';

export interface SubmittedTx {
  txHash: Hex;
  blockNumber: number;
  blockTime: number;
}

/**
 * Simple promise-chain mutex that serializes tx submissions on the single
 * signer wallet. Without this, parallel requests race on nonce under Cloud
 * Run concurrency. Good enough for v1; swap for a per-signer queue if we
 * ever need higher throughput.
 */
let submitChain: Promise<unknown> = Promise.resolve();
function withSubmitLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = submitChain.then(fn, fn);
  submitChain = next.catch(() => undefined);
  return next;
}

/**
 * Submit a self-tx that encodes `data` as calldata. The on-chain artifact is
 * the calldata byte string; the signer is irrelevant to verification.
 */
export function submitCommitmentTx(data: Hex): Promise<SubmittedTx> {
  return withSubmitLock(async () => {
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
    const blockTime = await resolveBlockTimeSeconds(receipt.blockNumber, txHash);
    return {
      txHash,
      blockNumber: Number(receipt.blockNumber),
      blockTime,
    };
  });
}

/**
 * Fetch block timestamp with short retries. Public RPCs are sometimes
 * eventually-consistent right after mining; fall back to wall clock if all
 * attempts fail so the anchor can still finalize with tx_hash + block_number.
 */
async function resolveBlockTimeSeconds(blockNumber: bigint, txHash: Hex): Promise<number> {
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
