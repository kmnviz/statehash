import {ulid} from 'ulid';
import type {Hex} from 'viem';
import {canonicalJson, commitmentHash, type CanonicalJsonValue} from './canonical';
import {explorerTxUrl} from '../config/chains';
import {resolveSigner, AgentResolveError} from './signer-pool';
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

export class AnchorValidationError extends Error {
  public readonly code: 'agent_not_found' | 'agent_namespace_mismatch';
  public readonly status: number;
  constructor(
    message: string,
    code: 'agent_not_found' | 'agent_namespace_mismatch',
    status: number
  ) {
    super(message);
    this.name = 'AnchorValidationError';
    this.code = code;
    this.status = status;
  }
}

export interface CreateAnchorInput {
  payload: CanonicalJsonValue;
  schemaVersion: number;
  externalRef: string | null;
  namespace: string;
  storePayload: boolean;
  apiKeyName: string;
  /** Optional — when present, the anchor is signed from the agent's wallet. */
  agentId: string | null;
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
    agent_id: anchor.agentId,
    signer_address: anchor.signerAddress,
    created_at: anchor.createdAt.toISOString(),
    confirmed_at: anchor.confirmedAt ? anchor.confirmedAt.toISOString() : null,
    ...(anchor.error ? {error: anchor.error} : {}),
  };
}

/**
 * Sync-mode create: resolve signer (system or per-agent), canonicalize, hash,
 * submit, wait for receipt, persist. Idempotent on (namespace, externalRef)
 * when externalRef is provided.
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

  let signer;
  try {
    signer = await resolveSigner(input.agentId, input.namespace);
  } catch (err) {
    if (err instanceof AgentResolveError) {
      if (err.code === 'agent_not_found') {
        throw new AnchorValidationError(err.message, 'agent_not_found', 404);
      }
      throw new AnchorValidationError(err.message, 'agent_namespace_mismatch', 403);
    }
    throw err;
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
      agentId: input.agentId,
      signerAddress: signer.account.address.toLowerCase(),
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
    const submitted = await submitCommitmentTx(signer, hash);
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
      agentId: input.agentId,
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
