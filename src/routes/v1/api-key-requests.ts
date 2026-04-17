import {Router, Request, Response} from 'express';
import {z} from 'zod';
import {
  ApiKeyRequestError,
  submitApiKeyRequest,
} from '../../services/api-key-request.service';
import logger from '../../services/logger';

const router = Router();

const SubmitRequestSchema = z.object({
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  company: z.string().trim().max(200).optional().nullable(),
  website: z.string().trim().max(500).optional().nullable(),
  use_case: z.string().trim().max(2000).optional().nullable(),
  source: z.string().trim().max(64).optional().nullable(),
  /** Honeypot field — hidden input in the form. Must be empty. */
  website_url: z.string().max(500).optional().nullable(),
});

function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}

/**
 * Public intake endpoint. No auth required — this is how prospective users
 * reach us while we don't yet expose a real email address. Records land in the
 * `api_key_requests` collection and are reviewed manually.
 */
router.post('/', async (req: Request, res: Response) => {
  const parsed = SubmitRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({
      error: 'invalid request body',
      details: parsed.error.issues,
    });
    return;
  }

  const userAgentRaw = req.headers['user-agent'];
  const userAgent =
    typeof userAgentRaw === 'string' ? userAgentRaw.slice(0, 500) : null;

  try {
    const response = await submitApiKeyRequest({
      name: parsed.data.name,
      email: parsed.data.email,
      company: parsed.data.company ?? null,
      website: parsed.data.website ?? null,
      useCase: parsed.data.use_case ?? null,
      source: parsed.data.source ?? 'landing',
      honeypot: parsed.data.website_url ?? null,
      ipAddress: clientIp(req),
      userAgent,
    });
    res.status(201).json(response);
  } catch (err) {
    if (err instanceof ApiKeyRequestError) {
      const status =
        err.code === 'rate_limited'
          ? 429
          : err.code === 'invalid_input'
            ? 400
            : 500;
      res.status(status).json({error: err.message, code: err.code});
      return;
    }
    logger.error('POST /v1/api-key-requests failed', {
      error: err instanceof Error ? err.stack || err.message : String(err),
    });
    res.status(500).json({error: 'internal error submitting request'});
  }
});

export default router;
