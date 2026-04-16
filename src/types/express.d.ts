import type {ApiKeyEntry} from '../services/api-key';

declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKeyEntry;
    }
  }
}

export {};
