import { describe, expect, it } from 'vitest';
import { redact } from '../../src/util/logger.js';
describe('redaction', () => {
  it('redacts nested sensitive values', () => expect(redact({ token: 'hidden', nested: { password: 'hidden', safe: 'visible' } })).toEqual({ token: '[REDACTED]', nested: { password: '[REDACTED]', safe: 'visible' } }));
  it('redacts authorization and cookies', () => expect(redact({ Authorization: 'Bearer xyz', cookie: 'session123' })).toEqual({ Authorization: '[REDACTED]', cookie: '[REDACTED]' }));
  it('redacts provider and notification keys', () => expect(redact({ GEMINI_API_KEY: 'key', TELEGRAM_BOT_TOKEN: 'bot' })).toEqual({ GEMINI_API_KEY: '[REDACTED]', TELEGRAM_BOT_TOKEN: '[REDACTED]' }));
  it('preserves non-sensitive diagnostics', () => expect(redact({ event: 'question_detected', attempt: 2 })).toEqual({ event: 'question_detected', attempt: 2 }));
});
