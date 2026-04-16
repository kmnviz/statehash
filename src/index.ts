import {env} from './config/env';
import {connectDatabase, disconnectDatabase} from './config/database';
import logger from './services/logger';
import {signer} from './services/signer';
import {apiKeyCount} from './services/api-key';
import app from './app';

const PORT = env.PORT;
let server: ReturnType<typeof app.listen> | null = null;

async function startServer(): Promise<void> {
  try {
    await connectDatabase();

    server = app.listen(PORT, () => {
      logger.info('statehash.io is ready and listening', {
        port: PORT,
        chainId: signer.chainId,
        signerAddress: signer.account.address,
        apiKeyCount: apiKeyCount(),
      });
    });
  } catch (error) {
    logger.error('Failed to start server', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    process.exit(1);
  }
}

async function shutdown(): Promise<void> {
  logger.info('Shutting down server...');
  if (server) {
    await new Promise<void>((resolve) =>
      server!.close(() => {
        logger.info('HTTP server closed');
        resolve();
      })
    );
  }
  await disconnectDatabase();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

startServer();
