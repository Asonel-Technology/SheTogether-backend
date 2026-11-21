import pino from 'pino';
import { env, isProd } from './env.js';

// Never log request bodies, tokens or chatbot questions. Redact sensitive headers defensively.
export const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-ussd-secret"]', '*.password', '*.refreshToken', '*.code'],
    censor: '[redacted]',
  },
  ...(isProd ? {} : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } } }),
});
