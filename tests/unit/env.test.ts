import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../src/config/env.js';
describe('environment validation', () => {
  it('accepts explicitly configured HTTPS HLS manifests with signed queries', () => expect(parseEnv({ TARGET_MODE: 'hls_test', HLS_TEST_URL: 'https://media.example.test/video.m3u8?token=secret' })).toMatchObject({ TARGET_MODE: 'hls_test', HLS_TEST_MAX_SECONDS: 20 }));
  it.each(['http://media.example.test/video.m3u8', 'https://media.example.test/video.mp4', 'https://user:secret@media.example.test/video.m3u8'])('rejects unsuitable HLS source %s', (HLS_TEST_URL) => expect(() => parseEnv({ HLS_TEST_URL })).toThrow());
  it('normalizes blank HLS sources and rejects a nonpositive limit', () => { expect(parseEnv({ HLS_TEST_URL: '' }).HLS_TEST_URL).toBeUndefined(); expect(() => parseEnv({ HLS_TEST_MAX_SECONDS: '0' })).toThrow(); });
  it('allows an unset remote browser URL', () => expect(parseEnv({} as NodeJS.ProcessEnv).REMOTE_BROWSER_WS_URL).toBeUndefined());
  it('normalizes an empty remote browser URL to undefined', () => expect(parseEnv({ REMOTE_BROWSER_WS_URL: '' }).REMOTE_BROWSER_WS_URL).toBeUndefined());
  it('rejects non-websocket remote browser URLs', () => expect(() => parseEnv({ REMOTE_BROWSER_WS_URL: 'https://browser.example.test' })).toThrow());
  it('accepts an authenticated wss remote browser URL', () => expect(parseEnv({ REMOTE_BROWSER_WS_URL: 'wss://token@browser.example.test/cdp' }).REMOTE_BROWSER_WS_URL).toContain('wss://'));
  it('accepts a cloud fake-LMS URL', () => expect(parseEnv({ LMS_BASE_URL: 'https://fake-lms.onrender.com', LMS_LOGIN_URL: 'https://fake-lms.onrender.com/login' }).LMS_BASE_URL).toBe('https://fake-lms.onrender.com'));
});
