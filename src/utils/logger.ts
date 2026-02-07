import pino from 'pino';

/**
 * Application logger using Pino
 * Configured for both development and production environments
 */
export const logger = pino({
  level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss.l',
      ignore: 'pid,hostname',
      messageFormat: '[RENDERER] {msg}',
    },
  },
});
