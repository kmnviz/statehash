import {Router, Request, Response} from 'express';
import {z} from 'zod';
import {requireApiKey} from '../../middleware/api-key-auth';
import {
  AnchorSubmissionError,
  AnchorValidationError,
  createAnchorSync,
  toAnchorResponse,
} from '../../services/anchor.service';
import {anchorRepository} from '../../repositories/anchor.repository';
import type {CanonicalJsonValue} from '../../services/canonical';
import logger from '../../services/logger';

const router = Router();

router.use(requireApiKey);

/**
 * Arbitrary JSON payload. statehash.io is schema-agnostic: we accept any JSON
 * value and canonicalize it as the preimage. The only structural constraints
 * are the ones canonicalJson itself enforces (no functions / bigints / etc).
 */
const CreateAnchorSchema = z.object({
  schema_version: z.number().int().min(0),
  payload: z.unknown().refine((v) => v !== undefined, {message: 'payload is required'}),
  external_ref: z.string().trim().min(1).max(256).optional(),
  namespace: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/, {
      message: 'namespace must start with alphanum and contain only alphanum, _, -',
    })
    .optional(),
  /**
   * Optional agent id (`agt_<ulid>`). When present, the anchor is signed from
   * that agent's dedicated wallet instead of the shared system signer.
   */
  agent_id: z
    .string()
    .trim()
    .regex(/^agt_[0-9A-HJKMNP-TV-Z]{26}$/, {message: 'agent_id must look like agt_<ulid>'})
    .optional(),
  store_payload: z.boolean().optional(),
  // Phase 4 fields: accepted for forward-compatibility but not handled yet.
  callback_url: z.string().url().optional(),
  callback_secret: z.string().min(1).optional(),
});

router.post('/', async (req: Request, res: Response) => {
  const parsed = CreateAnchorSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error: 'invalid request body', details: parsed.error.issues});
    return;
  }
  const body = parsed.data;

  if (body.callback_url || body.callback_secret) {
    res.status(501).json({error: 'async/webhook mode is not yet implemented (Phase 4)'});
    return;
  }

  if (!isHashablePayload(body.payload)) {
    res.status(400).json({error: 'payload must be a JSON object, array, or primitive'});
    return;
  }

  const apiKey = req.apiKey!;
  const namespace = body.namespace ?? apiKey.namespace;
  if (body.namespace && body.namespace !== apiKey.namespace) {
    res.status(403).json({error: 'api key does not own the requested namespace'});
    return;
  }

  try {
    const anchor = await createAnchorSync({
      payload: body.payload,
      schemaVersion: body.schema_version,
      externalRef: body.external_ref ?? null,
      namespace,
      storePayload: body.store_payload ?? true,
      apiKeyName: apiKey.name,
      agentId: body.agent_id ?? null,
    });
    res.status(201).json(toAnchorResponse(anchor));
  } catch (err) {
    if (err instanceof AnchorValidationError) {
      res.status(err.status).json({error: err.message, code: err.code});
      return;
    }
    if (err instanceof AnchorSubmissionError) {
      res.status(502).json({
        error: 'anchor submission failed',
        id: err.anchorId,
        details: err.message,
      });
      return;
    }
    logger.error('POST /v1/anchors failed', {
      error: err instanceof Error ? err.stack || err.message : String(err),
    });
    res.status(500).json({error: err instanceof Error ? err.message : String(err)});
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  const id = req.params.id?.trim();
  if (!id) {
    res.status(400).json({error: 'id is required'});
    return;
  }
  const anchor = await anchorRepository.findById(id);
  if (!anchor) {
    res.status(404).json({error: 'anchor not found'});
    return;
  }
  const apiKey = req.apiKey!;
  if (anchor.namespace !== apiKey.namespace) {
    res.status(403).json({error: 'api key does not own this anchor'});
    return;
  }
  res.status(200).json(toAnchorResponse(anchor));
});

router.get('/by-ref/:externalRef', async (req: Request, res: Response) => {
  const externalRef = req.params.externalRef?.trim();
  if (!externalRef) {
    res.status(400).json({error: 'externalRef is required'});
    return;
  }
  const apiKey = req.apiKey!;
  const namespaceParam =
    typeof req.query.namespace === 'string' ? req.query.namespace.trim() : '';
  const namespace = namespaceParam || apiKey.namespace;
  if (namespace !== apiKey.namespace) {
    res.status(403).json({error: 'api key does not own the requested namespace'});
    return;
  }
  const anchor = await anchorRepository.findByNamespaceAndExternalRef(namespace, externalRef);
  if (!anchor) {
    res.status(404).json({error: 'anchor not found'});
    return;
  }
  res.status(200).json(toAnchorResponse(anchor));
});

function isHashablePayload(v: unknown): v is CanonicalJsonValue {
  if (v === null) return true;
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return true;
  if (Array.isArray(v)) return true;
  if (t === 'object') return true;
  return false;
}

export default router;
