import SigningKeyModel, {type SigningKeyDocument} from '../models/signing-key.model';
import type {EncryptedBlob} from '../services/key-crypto';

export interface InsertSigningKeyInput {
  id: string;
  agentId: string;
  address: string;
  blob: EncryptedBlob;
}

export interface StoredSigningKey {
  id: string;
  agentId: string;
  address: string;
  blob: EncryptedBlob;
}

function toStored(doc: SigningKeyDocument): StoredSigningKey {
  return {
    id: doc._id,
    agentId: doc.agentId,
    address: doc.address,
    blob: {
      ciphertext: doc.ciphertext,
      iv: doc.iv,
      authTag: doc.authTag,
      keyVersion: doc.keyVersion,
    },
  };
}

class SigningKeyRepository {
  async insert(input: InsertSigningKeyInput): Promise<void> {
    await SigningKeyModel.create({
      _id: input.id,
      agentId: input.agentId,
      address: input.address.toLowerCase(),
      ciphertext: input.blob.ciphertext,
      iv: input.blob.iv,
      authTag: input.blob.authTag,
      keyVersion: input.blob.keyVersion,
    });
  }

  async findByAgentId(agentId: string): Promise<StoredSigningKey | null> {
    const doc = await SigningKeyModel.findOne({agentId}).exec();
    return doc ? toStored(doc) : null;
  }

  async delete(id: string): Promise<void> {
    await SigningKeyModel.deleteOne({_id: id}).exec();
  }
}

export const signingKeyRepository = new SigningKeyRepository();
