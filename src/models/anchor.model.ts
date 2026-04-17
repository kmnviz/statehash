import mongoose, {Schema, Model} from 'mongoose';
import type {AnchorStatus} from '../types/anchor';
import type {CanonicalJsonValue} from '../services/canonical';

/**
 * Plain interface (not `extends mongoose.Document`). With the `Mixed` payload
 * field and a custom `_id: string`, extending `Document` pushes mongoose's
 * conditional types past the TS depth limit. This shape is all we need for
 * `.lean()`/`.findByIdAndUpdate()` calls with proper typing.
 */
export interface AnchorDocument {
  _id: string;
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

  agentId: string | null;
  signerAddress: string;

  createdAt: Date;
  updatedAt: Date;
  confirmedAt: Date | null;
}

const anchorSchema = new Schema(
  {
    _id: {type: String, required: true},
    namespace: {type: String, required: true},
    externalRef: {type: String, default: null},
    schemaVersion: {type: Number, required: true},
    commitmentHash: {type: String, required: true},
    canonicalPayload: {type: String, default: null},
    payload: {type: Schema.Types.Mixed, default: null},
    storePayload: {type: Boolean, required: true, default: true},

    chainId: {type: Number, required: true},
    txHash: {type: String, default: null},
    blockNumber: {type: Number, default: null},
    blockTime: {type: Number, default: null},

    status: {
      type: String,
      required: true,
      enum: ['pending', 'confirmed', 'failed'],
    },
    error: {type: String, default: null},

    apiKeyName: {type: String, required: true},

    agentId: {type: String, default: null},
    signerAddress: {type: String, required: true},

    confirmedAt: {type: Date, default: null},
  },
  {
    collection: 'anchors',
    timestamps: true,
    _id: false,
  }
);

/**
 * (namespace, externalRef) is the caller-provided idempotency key. We allow
 * multiple rows without an externalRef inside the same namespace, so the
 * uniqueness constraint only applies when externalRef is a string.
 */
anchorSchema.index(
  {namespace: 1, externalRef: 1},
  {unique: true, partialFilterExpression: {externalRef: {$type: 'string'}}}
);
anchorSchema.index({commitmentHash: 1});
anchorSchema.index({txHash: 1}, {sparse: true});
anchorSchema.index({status: 1, updatedAt: 1});
/**
 * Enumerate anchors for an agent in reverse-chronological order — powers the
 * public agent page and third-party verification scripts.
 */
anchorSchema.index(
  {agentId: 1, createdAt: -1},
  {partialFilterExpression: {agentId: {$type: 'string'}}}
);
anchorSchema.index({signerAddress: 1, createdAt: -1});

const AnchorModel: Model<AnchorDocument> =
  (mongoose.models.Anchor as Model<AnchorDocument>) ||
  mongoose.model<AnchorDocument>('Anchor', anchorSchema);

export default AnchorModel;
