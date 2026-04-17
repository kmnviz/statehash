import {ulid} from 'ulid';
import type {Hex} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {encryptSecret, generateSigningKey} from './key-crypto';
import {systemSigner} from './signer-pool';
import {explorerAddressUrl} from '../config/chains';
import {agentRepository} from '../repositories/agent.repository';
import {signingKeyRepository} from '../repositories/signing-key.repository';
import {anchorRepository} from '../repositories/anchor.repository';
import type {Agent, AgentResponse} from '../types/agent';
import logger from './logger';

export class AgentCreateError extends Error {
  public readonly code: 'display_name_taken' | 'internal';
  constructor(message: string, code: 'display_name_taken' | 'internal') {
    super(message);
    this.name = 'AgentCreateError';
    this.code = code;
  }
}

export interface CreateAgentInput {
  namespace: string;
  displayName: string | null;
  apiKeyName: string;
}

function newAgentId(): string {
  return `agt_${ulid()}`;
}

function newSigningKeyId(): string {
  return `sk_${ulid()}`;
}

/**
 * Provision a new agent: generate a fresh keypair, envelope-encrypt the
 * private key, persist both rows, and return the Agent (address + id).
 *
 * Failure handling: if the SigningKey insert succeeds but the Agent insert
 * fails (or vice-versa), we roll back the other half so we never leave an
 * orphan. This is best-effort — without Mongo transactions a partial failure
 * can still leak a row, but the unique index on address means subsequent
 * retries surface the problem loud.
 */
export async function createAgent(input: CreateAgentInput): Promise<Agent> {
  if (input.displayName) {
    const conflict = await agentRepository.findByNamespaceAndDisplayName(
      input.namespace,
      input.displayName
    );
    if (conflict) {
      throw new AgentCreateError(
        `agent display_name "${input.displayName}" already exists in namespace "${input.namespace}"`,
        'display_name_taken'
      );
    }
  }

  const agentId = newAgentId();
  const signingKeyId = newSigningKeyId();

  const {privateKey, bytes} = generateSigningKey();
  let address: `0x${string}`;
  try {
    address = privateKeyToAccount(privateKey as Hex).address;
  } finally {
    bytes.fill(0);
  }
  const blob = encryptSecret(Buffer.from(privateKey.slice(2), 'hex'));

  try {
    await signingKeyRepository.insert({
      id: signingKeyId,
      agentId,
      address,
      blob,
    });
  } catch (err) {
    logger.error('agent create: signing_keys insert failed', {
      agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    throw new AgentCreateError('failed to persist signing key', 'internal');
  }

  try {
    return await agentRepository.insert({
      id: agentId,
      namespace: input.namespace,
      displayName: input.displayName,
      address,
      chainId: systemSigner.chainId,
      apiKeyName: input.apiKeyName,
    });
  } catch (err) {
    logger.error('agent create: agents insert failed, rolling back signing_keys row', {
      agentId,
      error: err instanceof Error ? err.message : String(err),
    });
    try {
      await signingKeyRepository.delete(signingKeyId);
    } catch (rollbackErr) {
      logger.error('agent create: rollback of signing_keys row also failed', {
        agentId,
        signingKeyId,
        error: rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
      });
    }
    throw new AgentCreateError('failed to persist agent', 'internal');
  }
}

export async function toAgentResponse(agent: Agent): Promise<AgentResponse> {
  const [anchorCount, range] = await Promise.all([
    anchorRepository.countByAgentId(agent.id),
    anchorRepository.agentAnchorTimeRange(agent.id),
  ]);

  return {
    id: agent.id,
    namespace: agent.namespace,
    display_name: agent.displayName,
    address: agent.address,
    chain_id: agent.chainId,
    explorer_url: explorerAddressUrl(agent.chainId, agent.address),
    anchor_count: anchorCount,
    first_anchor_at: range.firstAt ? range.firstAt.toISOString() : null,
    last_anchor_at: range.lastAt ? range.lastAt.toISOString() : null,
    created_at: agent.createdAt.toISOString(),
    updated_at: agent.updatedAt.toISOString(),
  };
}
