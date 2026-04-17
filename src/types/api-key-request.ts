export type ApiKeyRequestStatus =
  | 'new'
  | 'contacted'
  | 'approved'
  | 'rejected';

/** Domain shape stored in Mongo + returned from the repository layer. */
export interface ApiKeyRequestRecord {
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
  createdAt: Date;
  updatedAt: Date;
}

/** Minimal public response — we deliberately echo back very little. */
export interface ApiKeyRequestResponse {
  id: string;
  status: ApiKeyRequestStatus;
  created_at: string;
}
