import ApiKeyRequestModel, {
  type ApiKeyRequestDocument,
} from '../models/api-key-request.model';
import type {
  ApiKeyRequestRecord,
  ApiKeyRequestStatus,
} from '../types/api-key-request';

function toRecord(doc: ApiKeyRequestDocument): ApiKeyRequestRecord {
  return {
    id: doc._id,
    email: doc.email,
    name: doc.name,
    company: doc.company,
    website: doc.website,
    useCase: doc.useCase,
    source: doc.source,
    ipAddress: doc.ipAddress,
    userAgent: doc.userAgent,
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export interface InsertApiKeyRequestInput {
  id: string;
  email: string;
  name: string;
  company: string | null;
  website: string | null;
  useCase: string | null;
  source: string;
  ipAddress: string;
  userAgent: string | null;
  status: ApiKeyRequestStatus;
}

class ApiKeyRequestRepository {
  async insert(input: InsertApiKeyRequestInput): Promise<ApiKeyRequestRecord> {
    const doc = await ApiKeyRequestModel.create({
      _id: input.id,
      email: input.email,
      name: input.name,
      company: input.company,
      website: input.website,
      useCase: input.useCase,
      source: input.source,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      status: input.status,
    });
    return toRecord(doc);
  }

  /** Count of requests from a given IP within the last `windowMs` milliseconds. */
  async countByIpSince(ipAddress: string, since: Date): Promise<number> {
    return ApiKeyRequestModel.countDocuments({
      ipAddress,
      createdAt: {$gte: since},
    }).exec();
  }
}

export const apiKeyRequestRepository = new ApiKeyRequestRepository();
