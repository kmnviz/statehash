import AnchorModel, {type AnchorDocument} from '../models/anchor.model';
import type {Anchor, AnchorStatus} from '../types/anchor';
import type {CanonicalJsonValue} from '../services/canonical';

function toAnchor(doc: AnchorDocument): Anchor {
  return {
    id: doc._id,
    namespace: doc.namespace,
    externalRef: doc.externalRef,
    schemaVersion: doc.schemaVersion,
    commitmentHash: doc.commitmentHash,
    canonicalPayload: doc.canonicalPayload,
    payload: doc.payload,
    storePayload: doc.storePayload,
    chainId: doc.chainId,
    txHash: doc.txHash,
    blockNumber: doc.blockNumber,
    blockTime: doc.blockTime,
    status: doc.status,
    error: doc.error,
    apiKeyName: doc.apiKeyName,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    confirmedAt: doc.confirmedAt,
  };
}

export interface InsertPendingInput {
  id: string;
  namespace: string;
  externalRef: string | null;
  schemaVersion: number;
  commitmentHash: string;
  canonicalPayload: string | null;
  payload: CanonicalJsonValue | null;
  storePayload: boolean;
  chainId: number;
  apiKeyName: string;
}

export interface MarkConfirmedInput {
  txHash: string;
  blockNumber: number;
  blockTime: number;
}

class AnchorRepository {
  async findById(id: string): Promise<Anchor | null> {
    const doc = await AnchorModel.findById(id).exec();
    return doc ? toAnchor(doc) : null;
  }

  async findByNamespaceAndExternalRef(
    namespace: string,
    externalRef: string
  ): Promise<Anchor | null> {
    const doc = await AnchorModel.findOne({namespace, externalRef}).exec();
    return doc ? toAnchor(doc) : null;
  }

  async insertPending(input: InsertPendingInput): Promise<Anchor> {
    const doc = await AnchorModel.create({
      _id: input.id,
      namespace: input.namespace,
      externalRef: input.externalRef,
      schemaVersion: input.schemaVersion,
      commitmentHash: input.commitmentHash,
      canonicalPayload: input.canonicalPayload,
      payload: input.payload,
      storePayload: input.storePayload,
      chainId: input.chainId,
      txHash: null,
      blockNumber: null,
      blockTime: null,
      status: 'pending' as AnchorStatus,
      error: null,
      apiKeyName: input.apiKeyName,
      confirmedAt: null,
    });
    return toAnchor(doc);
  }

  async markConfirmed(id: string, input: MarkConfirmedInput): Promise<Anchor | null> {
    const doc = await AnchorModel.findByIdAndUpdate(
      id,
      {
        $set: {
          status: 'confirmed' as AnchorStatus,
          txHash: input.txHash,
          blockNumber: input.blockNumber,
          blockTime: input.blockTime,
          confirmedAt: new Date(),
          error: null,
        },
      },
      {new: true}
    ).exec();
    return doc ? toAnchor(doc) : null;
  }

  async markFailed(id: string, errorMessage: string): Promise<Anchor | null> {
    const doc = await AnchorModel.findByIdAndUpdate(
      id,
      {
        $set: {
          status: 'failed' as AnchorStatus,
          error: errorMessage,
        },
      },
      {new: true}
    ).exec();
    return doc ? toAnchor(doc) : null;
  }
}

export const anchorRepository = new AnchorRepository();
