import {Request, Response, NextFunction} from 'express';
import {env} from '../config/env';
import logger from '../services/logger';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _next: NextFunction
): void {
  const error = err instanceof Error ? err : new Error(String(err));

  logger.error('Unhandled error', {
    message: error.message,
    name: error.name,
    stack: error.stack,
    path: req.path,
    method: req.method,
  });

  res.status(500).json({
    error: 'Internal Server Error',
    message: env.NODE_ENV === 'development' ? error.message : 'An error occurred',
  });
}
