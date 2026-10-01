import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.js';
describe('environment validation', () => {
  it('allows an unset remote browser URL', () => expect(parseEnv({} as NodeJS.ProcessEnv).REMOTE_BROWSER_WS_URL).toBeUndefined());
  it('normalizes an empty remote browser URL to undefined', () => expect(parseEnv({ REMOTE_BROWSER_WS_URL: '' }).REMOTE_BROWSER_WS_URL).toBeUndefined());
  it('rejects non-websocket remote browser URLs', () => expect(() => parseEnv({ REMOTE_BROWSER_WS_URL: 'https://browser.example.test' })).toThrow());
  it('accepts an authenticated wss remote browser URL', () => expect(parseEnv({ REMOTE_BROWSER_WS_URL: 'wss://token@browser.example.test/cdp' }).REMOTE_BROWSER_WS_URL).toContain('wss://'));
  it('accepts a cloud fake-LMS URL', () => expect(parseEnv({ LMS_BASE_URL: 'https://fake-lms.onrender.com', LMS_LOGIN_URL: 'https://fake-lms.onrender.com/login' }).LMS_BASE_URL).toBe('https://fake-lms.onrender.com'));
});
