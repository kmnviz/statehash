import AgentModel, {type AgentDocument} from '../models/agent.model';
import type {Agent} from '../types/agent';

function toAgent(doc: AgentDocument): Agent {
  return {
    id: doc._id,
    namespace: doc.namespace,
    displayName: doc.displayName,
    address: doc.address as `0x${string}`,
    chainId: doc.chainId,
    apiKeyName: doc.apiKeyName,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export interface InsertAgentInput {
  id: string;
  namespace: string;
  displayName: string | null;
  address: string;
  chainId: number;
  apiKeyName: string;
}

class AgentRepository {
  async findById(id: string): Promise<Agent | null> {
    const doc = await AgentModel.findById(id).exec();
    return doc ? toAgent(doc) : null;
  }

  async findByAddress(address: string): Promise<Agent | null> {
    const doc = await AgentModel.findOne({address: address.toLowerCase()}).exec();
    return doc ? toAgent(doc) : null;
  }

  async findByNamespaceAndDisplayName(
    namespace: string,
    displayName: string
  ): Promise<Agent | null> {
    const doc = await AgentModel.findOne({namespace, displayName}).exec();
    return doc ? toAgent(doc) : null;
  }

  async insert(input: InsertAgentInput): Promise<Agent> {
    const doc = await AgentModel.create({
      _id: input.id,
      namespace: input.namespace,
      displayName: input.displayName,
      address: input.address.toLowerCase(),
      chainId: input.chainId,
      apiKeyName: input.apiKeyName,
    });
    return toAgent(doc);
  }

  async delete(id: string): Promise<void> {
    await AgentModel.deleteOne({_id: id}).exec();
  }
}

export const agentRepository = new AgentRepository();
