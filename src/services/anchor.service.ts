import {ulid} from 'ulid';
import type {Hex} from 'viem';
import {canonicalJson, commitmentHash, type CanonicalJsonValue} from './canonical';
import {explorerTxUrl} from '../config/chains';
import {signer} from './signer';
import {submitCommitmentTx} from './chain-tx';
import {anchorRepository} from '../repositories/anchor.repository';
import type {Anchor, AnchorResponse} from '../types/anchor';
import logger from './logger';

export class AnchorSubmissionError extends Error {
  public readonly anchorId: string;
  constructor(message: string, anchorId: string) {
    super(message);
    this.name = 'AnchorSubmissionError';
    this.anchorId = anchorId;
  }
}

export interface CreateAnchorInput {
  payload: CanonicalJsonValue;
  schemaVersion: number;
  externalRef: string | null;
  namespace: string;
  storePayload: boolean;
  apiKeyName: string;
}

function newAnchorId(): string {
  return `anc_${ulid()}`;
}

export function toAnchorResponse(anchor: Anchor): AnchorResponse {
  return {
    id: anchor.id,
    status: anchor.status,
    namespace: anchor.namespace,
    external_ref: anchor.externalRef,
    schema_version: anchor.schemaVersion,
    commitment_hash: anchor.commitmentHash,
    chain_id: anchor.chainId,
    tx_hash: anchor.txHash,
    block_number: anchor.blockNumber,
    block_time: anchor.blockTime,
    explorer_url: anchor.txHash ? explorerTxUrl(anchor.chainId, anchor.txHash as Hex) : null,
    created_at: anchor.createdAt.toISOString(),
    confirmed_at: anchor.confirmedAt ? anchor.confirmedAt.toISOString() : null,
    ...(anchor.error ? {error: anchor.error} : {}),
  };
}

/**
 * Sync-mode create: canonicalize, hash, submit, wait for receipt, persist.
 * Idempotent on `(namespace, externalRef)` when externalRef is provided.
 */
export async function createAnchorSync(input: CreateAnchorInput): Promise<Anchor> {
  const canonical = canonicalJson(input.payload);
  const hash = commitmentHash(input.payload);

  if (input.externalRef) {
    const existing = await anchorRepository.findByNamespaceAndExternalRef(
      input.namespace,
      input.externalRef
    );
    if (existing) {
      logger.info('Idempotent hit on (namespace, externalRef)', {
        namespace: input.namespace,
        externalRef: input.externalRef,
        id: existing.id,
        status: existing.status,
      });
      return existing;
    }
  }

  const id = newAnchorId();
  let pending: Anchor;
  try {
    pending = await anchorRepository.insertPending({
      id,
      namespace: input.namespace,
      externalRef: input.externalRef,
      schemaVersion: input.schemaVersion,
      commitmentHash: hash,
      canonicalPayload: input.storePayload ? canonical : null,
      payload: input.storePayload ? input.payload : null,
      storePayload: input.storePayload,
      chainId: signer.chainId,
      apiKeyName: input.apiKeyName,
    });
  } catch (err) {
    if (input.externalRef && isDuplicateKeyError(err)) {
      const existing = await anchorRepository.findByNamespaceAndExternalRef(
        input.namespace,
        input.externalRef
      );
      if (existing) return existing;
    }
    throw err;
  }

  try {
    const submitted = await submitCommitmentTx(hash);
    const confirmed = await anchorRepository.markConfirmed(pending.id, {
      txHash: submitted.txHash,
      blockNumber: submitted.blockNumber,
      blockTime: submitted.blockTime,
    });
    if (!confirmed) throw new Error(`anchor ${pending.id} missing after confirm`);
    return confirmed;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('Sync anchor failed', {
      id: pending.id,
      error: err instanceof Error ? err.stack || err.message : message,
    });
    await anchorRepository.markFailed(pending.id, message);
    throw new AnchorSubmissionError(message, pending.id);
  }
}

function isDuplicateKeyError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /E11000|duplicate key/i.test(err.message);
}
