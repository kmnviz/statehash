import mongoose, {Schema, Model} from 'mongoose';

/**
 * The encrypted signing key for an agent. Stored in a separate collection so
 * that access can be audited/ACLed more tightly than the Agent metadata — the
 * only code path that ever loads rows from here is the signer pool.
 *
 * `ciphertext`, `iv`, and `authTag` are base64 strings. `keyVersion` lets us
 * roll forward to KMS envelope encryption without breaking existing rows.
 */
export interface SigningKeyDocument {
  _id: string;
  agentId: string;
  address: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

const signingKeySchema = new Schema(
  {
    _id: {type: String, required: true},
    agentId: {type: String, required: true},
    address: {type: String, required: true},
    ciphertext: {type: String, required: true},
    iv: {type: String, required: true},
    authTag: {type: String, required: true},
    keyVersion: {type: Number, required: true},
  },
  {
    collection: 'signing_keys',
    timestamps: true,
    _id: false,
  }
);

signingKeySchema.index({agentId: 1}, {unique: true});
signingKeySchema.index({address: 1}, {unique: true});

const SigningKeyModel: Model<SigningKeyDocument> =
  (mongoose.models.SigningKey as Model<SigningKeyDocument>) ||
  mongoose.model<SigningKeyDocument>('SigningKey', signingKeySchema);

export default SigningKeyModel;
