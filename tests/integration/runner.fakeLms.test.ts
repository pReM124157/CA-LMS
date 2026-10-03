import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { chromium } from 'playwright';
import { HLSTestAdapter } from '../../src/video/HLSTestAdapter.js';
import { Runner } from '../../src/orchestration/runner.js';

let fakeLms: ChildProcess;
const waitFor = async (predicate: () => boolean, timeout = 8_000): Promise<void> => {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for runner state');
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
};
describe('runner against the controlled fake LMS', () => {
  beforeAll(async () => {
    fakeLms = spawn('node', ['node_modules/tsx/dist/cli.mjs', 'fake-lms/server.ts'], {
      stdio: 'ignore',
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
  });
  afterAll(async () => {
    fakeLms.kill();
  });
  it('reaches human confirmation and safely submits a selected option', async () => {
    const runner = new Runner();
    await runner.start();
    await waitFor(() => runner.status().state === 'WAITING_FOR_CONFIRMATION');
    const pending = runner.status().pending;
    expect(pending?.text).toContain('encrypted web traffic');
    expect(pending?.options).toHaveLength(3);
    expect(runner.status().video?.currentTime).toBeGreaterThanOrEqual(3);
    expect(runner.status().video?.duration).toBeGreaterThan(10);
    expect(runner.status().video?.paused).toBe(true);
    await runner.confirm('b');
    expect(runner.status().state).toBe('PLAYING');
    expect(runner.status().questionPending).toBe(false);
    await waitFor(() => runner.status().state === 'COMPLETED', 15_000);
    expect(runner.status().video?.ended).toBe(true);
    expect(runner.status().active).toBe(false);
    const heartbeat = runner.status().heartbeatAt;
    await new Promise((resolve) => setTimeout(resolve, 2000));
    expect(runner.status().state).toBe('COMPLETED');
    expect(runner.status().heartbeatAt).toBe(heartbeat);
    await runner.stop();
    await expect(runner.confirm('b')).rejects.toMatchObject({ code: 'NO_PENDING_QUESTION' });
  }, 25_000);
  it('serves the HLS page and bundled engine, samples native video, and maps real fatal manifest errors', async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      // Exercise the fallback on hosts that advertise native HLS support.
      await page.addInitScript(() => {
        const native = HTMLMediaElement.prototype.canPlayType;
        HTMLMediaElement.prototype.canPlayType = function (type) {
          return type.includes('mpegurl') ? '' : native.call(this, type);
        };
      });
      const adapter = new HLSTestAdapter();
      await page.route('https://media.example.test/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/vnd.apple.mpegurl',
          headers: { 'access-control-allow-origin': '*' },
          body: 'invalid manifest',
        }),
      );
      await page.goto('http://localhost:4000/hls-test');
      expect(await page.evaluate(() => typeof (window as unknown as { Hls: unknown }).Hls)).toBe(
        'function',
      );
      await adapter.start(page, 'https://media.example.test/broken.m3u8?token=test-secret');
      await page.waitForFunction(() =>
        Boolean((window as unknown as { __HLS_TEST_ERROR__: unknown }).__HLS_TEST_ERROR__),
      );
      expect(await adapter.state(page)).toMatchObject({
        detected: true,
        currentTime: 0,
        paused: true,
        error: 'HLS_MANIFEST_LOAD_FAILED',
      });
      // Verify adapter readings against real playback of the controlled local media fixture.
      await page.goto('http://localhost:4000/hls-test');
      await page.locator('video').evaluate((video: HTMLVideoElement) => {
        video.src = '/media/synthetic-test.webm';
        video.muted = true;
        return video.play();
      });
      await page.waitForFunction(() => document.querySelector('video')!.currentTime > 0.2);
      const first = await adapter.state(page);
      await page.waitForTimeout(300);
      const second = await adapter.state(page);
      expect(second.currentTime).toBeGreaterThan(first.currentTime);
      expect(second).toMatchObject({ paused: false, ended: false });
      expect(second.readyState).toBeGreaterThanOrEqual(2);
      expect(second.duration).toBeGreaterThan(10);
      await adapter.pause(page);
      expect((await adapter.state(page)).paused).toBe(true);
    } finally {
      await browser.close();
    }
  }, 20_000);
});
