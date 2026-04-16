import type {CanonicalJsonValue} from '../services/canonical';

export type AnchorStatus = 'pending' | 'confirmed' | 'failed';

/**
 * Domain shape returned by the repository. Stored under `_id = anc_<ulid>`
 * so the public id is also the Mongo primary key.
 */
export interface Anchor {
  id: string;
  namespace: string;
  externalRef: string | null;
  schemaVersion: number;
  commitmentHash: string;
  canonicalPayload: string | null;
  payload: CanonicalJsonValue | null;
  storePayload: boolean;

  chainId: number;
  txHash: string | null;
  blockNumber: number | null;
  blockTime: number | null;

  status: AnchorStatus;
  error: string | null;

  apiKeyName: string;

  createdAt: Date;
  updatedAt: Date;
  confirmedAt: Date | null;
}

/** Public API response shape for an anchor record. */
export interface AnchorResponse {
  id: string;
  status: AnchorStatus;
  namespace: string;
  external_ref: string | null;
  schema_version: number;
  commitment_hash: string;
  chain_id: number;
  tx_hash: string | null;
  block_number: number | null;
  block_time: number | null;
  explorer_url: string | null;
  created_at: string;
  confirmed_at: string | null;
  error?: string | null;
}
