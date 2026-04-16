import winston from 'winston';
import {env} from '../config/env';

const isDevelopment = env.NODE_ENV === 'development';

/**
 * Cloud Run / Cloud Logging reads `severity` from structured logs. Mapping
 * winston's npm levels to GCP's severity keeps log filtering sane in prod.
 */
const severityMap: Record<string, string> = {
  error: 'ERROR',
  warn: 'WARNING',
  info: 'INFO',
  http: 'DEBUG',
  verbose: 'DEBUG',
  debug: 'DEBUG',
  silly: 'DEBUG',
};

const logger = winston.createLogger({
  levels: winston.config.npm.levels,
  level: env.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({stack: true}),
    isDevelopment
      ? winston.format.combine(
          winston.format.colorize(),
          winston.format.printf((info) => {
            const {timestamp, level, message, ...rest} = info;
            const meta = Object.keys(rest).length > 0 ? rest : {};
            const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
            return `${timestamp} [${level}]: ${message}${metaStr}`;
          })
        )
      : winston.format.printf((info) => {
          const {timestamp, level, message, ...rest} = info;
          const meta = Object.keys(rest).length > 0 ? rest : {};
          return JSON.stringify({
            severity: severityMap[level] || 'DEFAULT',
            timestamp,
            message,
            ...meta,
          });
        })
  ),
  transports: [new winston.transports.Console()],
});

export default logger;
