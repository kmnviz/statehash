import mongoose, {Schema, Model} from 'mongoose';

/**
 * Agent = a named actor that anchors claims. One Mongo row per agent; the
 * wallet private key lives in a separate `SigningKey` collection (encrypted).
 */
export interface AgentDocument {
  _id: string;
  namespace: string;
  displayName: string | null;
  address: string;
  chainId: number;
  apiKeyName: string;
  createdAt: Date;
  updatedAt: Date;
}

const agentSchema = new Schema(
  {
    _id: {type: String, required: true},
    namespace: {type: String, required: true},
    displayName: {type: String, default: null},
    address: {type: String, required: true},
    chainId: {type: Number, required: true},
    apiKeyName: {type: String, required: true},
  },
  {
    collection: 'agents',
    timestamps: true,
    _id: false,
  }
);

/**
 * One wallet per agent, system-wide. The address is our external handle —
 * anyone can enumerate anchors by address on basescan without our API.
 */
agentSchema.index({address: 1}, {unique: true});
/**
 * Optional display name, unique within a namespace when present. Lets a
 * customer address agents by stable label as well as by ULID.
 */
agentSchema.index(
  {namespace: 1, displayName: 1},
  {unique: true, partialFilterExpression: {displayName: {$type: 'string'}}}
);
agentSchema.index({namespace: 1, createdAt: -1});

const AgentModel: Model<AgentDocument> =
  (mongoose.models.Agent as Model<AgentDocument>) ||
  mongoose.model<AgentDocument>('Agent', agentSchema);

export default AgentModel;
