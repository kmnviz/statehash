import mongoose from 'mongoose';
import {env} from './env';
import logger from '../services/logger';

mongoose.connection.on('connected', () => {
  logger.info('MongoDB connection established');
});

mongoose.connection.on('error', (error) => {
  logger.error('MongoDB connection error', {
    error: error instanceof Error ? error : new Error(String(error)),
  });
});

mongoose.connection.on('disconnected', () => {
  logger.warn('MongoDB disconnected');
});

export async function connectDatabase(): Promise<void> {
  try {
    await mongoose.connect(env.MONGODB_URI, {
      dbName: env.MONGODB_DB_NAME,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    logger.info('Connected to MongoDB', {db: env.MONGODB_DB_NAME});
  } catch (error) {
    logger.error('Failed to connect to MongoDB', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
  } catch (error) {
    logger.error('Error disconnecting from MongoDB', {
      error: error instanceof Error ? error : new Error(String(error)),
    });
  }
}
