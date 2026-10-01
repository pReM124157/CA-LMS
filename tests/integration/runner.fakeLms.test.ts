import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { Runner } from '../../src/orchestration/runner.js';

let fakeLms: ChildProcess;
const waitFor = async (predicate: () => boolean, timeout = 8_000): Promise<void> => {
  const deadline = Date.now() + timeout;
  while (!predicate()) { if (Date.now() > deadline) throw new Error('Timed out waiting for runner state'); await new Promise((resolve) => setTimeout(resolve, 100)); }
};
describe('runner against the controlled fake LMS', () => {
  beforeAll(async () => { fakeLms = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'fake-lms/server.ts'], { stdio: 'ignore' }); await new Promise((resolve) => setTimeout(resolve, 500)); });
  afterAll(async () => { fakeLms.kill(); });
  it('reaches human confirmation and safely submits a selected option', async () => {
    const runner = new Runner(); await runner.start(); await waitFor(() => runner.status().state === 'WAITING_FOR_CONFIRMATION');
    const pending = runner.status().pending; expect(pending?.text).toContain('encrypted web traffic'); expect(pending?.options).toHaveLength(3);
    expect(runner.status().video?.currentTime).toBeGreaterThanOrEqual(3); expect(runner.status().video?.duration).toBeGreaterThan(10); expect(runner.status().video?.paused).toBe(true);
    await runner.confirm('b'); expect(runner.status().state).toBe('PLAYING'); expect(runner.status().questionPending).toBe(false);
    await waitFor(() => runner.status().state === 'COMPLETED', 15_000); expect(runner.status().video?.ended).toBe(true); await runner.stop();
    await expect(runner.confirm('b')).rejects.toMatchObject({ code: 'NO_PENDING_QUESTION' });
  }, 22_000);
});
