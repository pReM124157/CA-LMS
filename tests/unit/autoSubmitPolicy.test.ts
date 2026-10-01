import { describe, expect, it } from 'vitest';
import { AutoSubmitPolicy } from '../../src/security/autoSubmitPolicy.js';
describe('AutoSubmitPolicy', () => {
  it('permits an exact localhost hostname when enabled', () => expect(new AutoSubmitPolicy(true, ['localhost']).permits('http://localhost:4000/lesson/1')).toBe(true));
  it('rejects a non-allowlisted production hostname', () => expect(new AutoSubmitPolicy(true, ['localhost']).permits('https://example.com')).toBe(false));
  it('rejects a localhost-lookalike subdomain', () => expect(new AutoSubmitPolicy(true, ['localhost']).permits('https://localhost.example.com')).toBe(false));
  it('rejects an IP-address lookalike subdomain', () => expect(new AutoSubmitPolicy(true, ['127.0.0.1']).permits('https://127.0.0.1.example.com')).toBe(false));
  it('rejects an allowed host while the feature switch is disabled', () => expect(new AutoSubmitPolicy(false, ['localhost']).permits('http://localhost')).toBe(false));
});
