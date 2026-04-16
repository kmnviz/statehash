import {Request, Response} from 'express';
import mongoose from 'mongoose';
import {signer} from '../services/signer';

export function healthCheck(_req: Request, res: Response): void {
  const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';
  res.json({
    status: 'ok',
    database: dbStatus,
    chainId: signer.chainId,
    signer: signer.account.address,
    timestamp: new Date().toISOString(),
  });
}
