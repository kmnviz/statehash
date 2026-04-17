import {Router, Request, Response} from 'express';
import {z} from 'zod';
import {requireApiKey} from '../../middleware/api-key-auth';
import {
  AgentCreateError,
  createAgent,
  toAgentResponse,
} from '../../services/agent.service';
import {agentRepository} from '../../repositories/agent.repository';
import logger from '../../services/logger';

const router = Router();

const CreateAgentSchema = z.object({
  namespace: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/, {
      message: 'namespace must start with alphanum and contain only alphanum, _, -',
    })
    .optional(),
  display_name: z
    .string()
    .trim()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9_\-]*$/, {
      message: 'display_name must start with alphanum and contain only alphanum, _, -',
    })
    .optional(),
});

/**
 * Provision a new agent under the caller's namespace. Returns the agent's
 * on-chain wallet address; the private key is envelope-encrypted and never
 * leaves the server.
 */
router.post('/', requireApiKey, async (req: Request, res: Response) => {
  const parsed = CreateAgentSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({error: 'invalid request body', details: parsed.error.issues});
    return;
  }

  const apiKey = req.apiKey!;
  const namespace = parsed.data.namespace ?? apiKey.namespace;
  if (namespace !== apiKey.namespace) {
    res.status(403).json({error: 'api key does not own the requested namespace'});
    return;
  }

  try {
    const agent = await createAgent({
      namespace,
      displayName: parsed.data.display_name ?? null,
      apiKeyName: apiKey.name,
    });
    const response = await toAgentResponse(agent);
    res.status(201).json(response);
  } catch (err) {
    if (err instanceof AgentCreateError) {
      const status = err.code === 'display_name_taken' ? 409 : 500;
      res.status(status).json({error: err.message, code: err.code});
      return;
    }
    logger.error('POST /v1/agents failed', {
      error: err instanceof Error ? err.stack || err.message : String(err),
    });
    res.status(500).json({error: 'internal error creating agent'});
  }
});

/**
 * Public agent lookup — no auth. The whole point of per-agent wallets is that
 * anyone can audit an agent's track record without talking to us first; this
 * endpoint returns the same data a third-party could reconstruct from the
 * chain, in a convenient JSON shape.
 */
router.get('/:id', async (req: Request, res: Response) => {
  const id = req.params.id?.trim();
  if (!id) {
    res.status(400).json({error: 'id is required'});
    return;
  }
  const agent = await agentRepository.findById(id);
  if (!agent) {
    res.status(404).json({error: 'agent not found'});
    return;
  }
  const response = await toAgentResponse(agent);
  res.status(200).json(response);
});

/**
 * Public agent lookup by wallet address. Useful for verifiers who have a tx
 * hash in hand and want to resolve the agent id without API access.
 */
router.get('/by-address/:address', async (req: Request, res: Response) => {
  const raw = req.params.address?.trim();
  if (!raw || !/^0x[0-9a-fA-F]{40}$/.test(raw)) {
    res.status(400).json({error: 'address must be 0x-prefixed 20-byte hex'});
    return;
  }
  const agent = await agentRepository.findByAddress(raw.toLowerCase());
  if (!agent) {
    res.status(404).json({error: 'agent not found'});
    return;
  }
  const response = await toAgentResponse(agent);
  res.status(200).json(response);
});

export default router;
