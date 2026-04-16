import {Request, Response, NextFunction} from 'express';
import {findApiKey} from '../services/api-key';

/**
 * Requires `X-Api-Key` header (or `Authorization: Bearer <key>`) matching one
 * of the configured entries in `STATEHASH_API_KEYS`. On success, attaches the
 * matched entry to `req.apiKey` for downstream handlers.
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  const raw = extractKey(req);
  if (!raw) {
    res.status(401).json({error: 'missing X-Api-Key header'});
    return;
  }
  const entry = findApiKey(raw);
  if (!entry) {
    res.status(401).json({error: 'invalid api key'});
    return;
  }
  req.apiKey = entry;
  next();
}

function extractKey(req: Request): string | null {
  const header = req.header('x-api-key');
  if (header && header.trim()) return header.trim();

  const auth = req.header('authorization');
  if (auth && auth.startsWith('Bearer ')) {
    const t = auth.slice('Bearer '.length).trim();
    if (t) return t;
  }
  return null;
}
