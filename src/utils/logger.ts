/**
 * Simple logger for renderer process
 * Uses console methods directly since pino-pretty doesn't work well in Electron
 */

type LogFunction = (dataOrMsg: unknown, msg?: string) => void;

const formatTimestamp = () => {
  const now = new Date();
  return now.toISOString().replace('T', ' ').substring(0, 23);
};

const createLogFunction = (level: 'log' | 'info' | 'warn' | 'error'): LogFunction => {
  return (dataOrMsg: unknown, msg?: string) => {
    const timestamp = formatTimestamp();
    const prefix = `${timestamp} [RENDERER]`;

    if (typeof dataOrMsg === 'string') {
      // If first arg is a string, it's the message
      console[level](prefix, dataOrMsg);
    } else if (dataOrMsg && typeof dataOrMsg === 'object' && msg) {
      // If first arg is an object and second arg exists, show both
      console[level](prefix, msg, JSON.stringify(dataOrMsg));
    } else {
      console[level](prefix, msg || '');
    }
  };
};

export const logger = {
  info: createLogFunction('info'),
  debug: createLogFunction('log'),
  warn: createLogFunction('warn'),
  error: createLogFunction('error'),
};
