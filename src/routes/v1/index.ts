import {Router} from 'express';
import anchorsRouter from './anchors';
import agentsRouter from './agents';
import apiKeyRequestsRouter from './api-key-requests';

const router = Router();

router.use('/anchors', anchorsRouter);
router.use('/agents', agentsRouter);
router.use('/api-key-requests', apiKeyRequestsRouter);

export default router;
