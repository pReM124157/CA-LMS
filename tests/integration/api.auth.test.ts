import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Runner } from '../../src/orchestration/runner.js';
import { createApp } from '../../src/server/app.js';

let server: Server; let baseUrl = '';
const credentials = `Basic ${Buffer.from('admin:change-me').toString('base64')}`;
const request = (path: string, authorization?: string): Promise<Response> => fetch(`${baseUrl}${path}`, { headers: authorization ? { authorization } : {} });
describe('management API authentication and health', () => {
  beforeAll(async () => { server = createApp(new Runner()).listen(0); await new Promise<void>((resolve) => server.on('listening', resolve)); const address = server.address(); if (!address || typeof address === 'string') throw new Error('No TCP test port'); baseUrl = `http://127.0.0.1:${address.port}`; });
  afterAll(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); });
  it('exposes a secret-free degraded health response without dashboard credentials', async () => { const response = await request('/health'); expect(response.status).toBe(200); await expect(response.json()).resolves.toMatchObject({ status: 'degraded', database: false, runnerState: 'BOOTING' }); });
  it('rejects anonymous management access', async () => expect((await request('/api/status')).status).toBe(401));
  it('rejects incorrect dashboard credentials', async () => expect((await request('/api/status', 'Basic invalid')).status).toBe(401));
  it('allows authenticated status access', async () => { const response = await request('/api/status', credentials); expect(response.status).toBe(200); await expect(response.json()).resolves.toMatchObject({ state: 'BOOTING', browser: false }); });
  it('allows authenticated current and pending-question reads', async () => { expect((await request('/api/current', credentials)).status).toBe(200); await expect((await request('/api/questions/pending', credentials)).json()).resolves.toEqual([]); });
});
