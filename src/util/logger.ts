import pino from 'pino';
import { env } from '../config/env.js';
const sensitive = /password|passwd|token|cookie|authorization|secret|api[_-]?key|session/i;
export const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sensitive.test(key) ? '[REDACTED]' : redact(item)]));
  return value;
};
const redactLog = (object: Record<string, unknown>): Record<string, unknown> => redact(object) as Record<string, unknown>;
export const logger = pino({ level: env.LOG_LEVEL, formatters: { log: redactLog } });
