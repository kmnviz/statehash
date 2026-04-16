import {Router} from 'express';
import anchorsRouter from './anchors';

const router = Router();

router.use('/anchors', anchorsRouter);

export default router;
