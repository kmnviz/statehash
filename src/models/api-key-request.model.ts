import mongoose, {Schema, Model} from 'mongoose';
import {ApiKeyRequestStatus} from '../types/api-key-request';

/**
 * ApiKeyRequest = an intake record captured from the public "Request API key"
 * form. No auth is required to insert; records sit here until an operator
 * reaches out and flips status to `contacted` / `approved` / `rejected`.
 */
export interface ApiKeyRequestDocument {
  _id: string;
  email: string;
  name: string;
  company: string | null;
  website: string | null;
  useCase: string | null;
  source: string;
  ipAddress: string;
  userAgent: string | null;
  status: ApiKeyRequestStatus;
  createdAt: Date;
  updatedAt: Date;
}

const apiKeyRequestSchema = new Schema(
  {
    _id: {type: String, required: true},
    email: {type: String, required: true},
    name: {type: String, required: true},
    company: {type: String, default: null},
    website: {type: String, default: null},
    useCase: {type: String, default: null},
    source: {type: String, required: true, default: 'landing'},
    ipAddress: {type: String, required: true},
    userAgent: {type: String, default: null},
    status: {
      type: String,
      required: true,
      enum: ['new', 'contacted', 'approved', 'rejected'],
      default: 'new',
    },
  },
  {
    collection: 'api_key_requests',
    timestamps: true,
    _id: false,
  }
);

apiKeyRequestSchema.index({email: 1, createdAt: -1});
apiKeyRequestSchema.index({status: 1, createdAt: -1});

const ApiKeyRequestModel: Model<ApiKeyRequestDocument> =
  (mongoose.models.ApiKeyRequest as Model<ApiKeyRequestDocument>) ||
  mongoose.model<ApiKeyRequestDocument>(
    'ApiKeyRequest',
    apiKeyRequestSchema
  );

export default ApiKeyRequestModel;
