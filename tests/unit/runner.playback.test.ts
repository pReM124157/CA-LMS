import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  page: { goto: vi.fn(), url: () => 'https://lms.example.test/hls-test', locator: vi.fn() },
  state: vi.fn(),
  start: vi.fn(),
  pause: vi.fn(),
  question: vi.fn(),
  log: vi.fn(),
}));
vi.mock('../../src/browser/browserManager.js', () => ({
  BrowserManager: class {
    page = async () => mocks.page;
    connected = () => true;
    connectionStatus = () => 'local';
    sessionAgeSeconds = () => 0;
    close = async () => {};
    invalidate = async () => {};
  },
}));
vi.mock('../../src/video/HLSTestAdapter.js', () => ({
  HLSTestAdapter: class {
    state = mocks.state;
    start = mocks.start;
    pause = mocks.pause;
  },
}));
vi.mock('../../src/lms/GenericLMSAdapter.js', () => ({
  GenericLMSAdapter: class {
    question = mocks.question;
  },
}));
vi.mock('../../src/util/logger.js', () => ({ logger: { info: mocks.log, error: mocks.log } }));
vi.mock('../../src/config/env.js', () => ({
  env: {
    TARGET_MODE: 'hls_test',
    HLS_TEST_URL: 'https://media.example.test/canary.m3u8?token=private-signature',
    HLS_TEST_MAX_SECONDS: 2,
    LMS_BASE_URL: 'https://lms.example.test',
    QUESTION_POLL_INTERVAL_MS: 500,
    AUTO_SUBMIT: false,
    AUTOSUBMIT_ALLOWED_HOSTS: 'localhost',
  },
}));
import { env } from '../../src/config/env.js';
import { Runner } from '../../src/orchestration/runner.js';
const state = (currentTime: number, extras = {}) => ({
  detected: true,
  paused: false,
  currentTime,
  duration: 15,
  ended: false,
  readyState: 4,
  networkState: 2,
  ...extras,
});
const transitions = () => mocks.log.mock.calls.map(([event]) => `${event.from}->${event.to}`);
describe('terminal polling and controlled HLS runner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    env.TARGET_MODE = 'hls_test';
    mocks.state.mockResolvedValue(state(0));
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  it('completes native media once, clears polling, preserves state, and remains terminal', async () => {
    const runner = new Runner();
    await runner.start();
    mocks.state.mockResolvedValue(state(1));
    await vi.advanceTimersByTimeAsync(500);
    mocks.state.mockResolvedValue(state(15, { ended: true, paused: true }));
    await vi.advanceTimersByTimeAsync(500);
    const final = runner.status().hls;
    const calls = mocks.state.mock.calls.length;
    expect(runner.status()).toMatchObject({ state: 'COMPLETED', active: false });
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000);
    await runner.resume();
    await runner.pause();
    expect(mocks.state).toHaveBeenCalledTimes(calls);
    expect(runner.status().hls).toEqual(final);
    expect(transitions().filter((value) => value.endsWith('->COMPLETED'))).toHaveLength(1);
    expect(transitions().some((value) => value.startsWith('COMPLETED->'))).toBe(false);
  });
  it('reports actual sampled progression and pauses at max elapsed duration', async () => {
    const runner = new Runner();
    await runner.start();
    mocks.state.mockResolvedValue(state(0.8));
    await vi.advanceTimersByTimeAsync(500);
    expect(runner.status().hls?.advancing).toBe(true);
    mocks.state
      .mockResolvedValueOnce(state(1.2))
      .mockResolvedValueOnce(state(1.6))
      .mockResolvedValue(state(2));
    mocks.pause.mockImplementation(async () => {
      mocks.state.mockResolvedValue(state(2, { paused: true }));
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(runner.status()).toMatchObject({
      state: 'PAUSED',
      active: false,
      hls: { result: 'PLAYBACK_VERIFIED', paused: true, currentTime: 2 },
    });
    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('cannot verify stationary playback and fails after the bounded stall window', async () => {
    const runner = new Runner();
    await runner.start();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(runner.status()).toMatchObject({
      state: 'ERROR',
      active: false,
      hls: { error: 'HLS_PLAYBACK_NOT_ADVANCING' },
    });
    expect(runner.status().hls?.result).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([
    'HLS_MANIFEST_LOAD_FAILED',
    'HLS_MEDIA_ERROR',
    'HLS_UNSUPPORTED',
    'MEDIA_DECODE_FAILED',
  ])('halts on fatal %s without repeated ERROR transitions', async (error) => {
    const runner = new Runner();
    await runner.start();
    mocks.state.mockResolvedValue(state(0, { error }));
    await vi.advanceTimersByTimeAsync(500);
    const calls = mocks.state.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(runner.status()).toMatchObject({ state: 'ERROR', active: false, hls: { error } });
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.state).toHaveBeenCalledTimes(calls);
    expect(transitions().filter((value) => value.endsWith('->ERROR'))).toHaveLength(1);
  });
  it('exposes only the source hostname, never the source path or signed query', async () => {
    const runner = new Runner();
    await runner.start();
    expect(runner.status().hls?.sourceUrlHost).toBe('media.example.test');
    expect(JSON.stringify(runner.status())).not.toMatch(/private-signature|token=|canary.m3u8/);
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('private-signature');
    expect(mocks.page.goto).toHaveBeenCalledWith(
      'https://lms.example.test/hls-test',
      expect.anything(),
    );
    await expect(runner.confirm('b')).rejects.toMatchObject({ code: 'QUESTION_FLOW_DISABLED' });
  });
  it('does not overlap slow polls or overwrite completion after polling stops', async () => {
    const runner = new Runner();
    await runner.start();
    let resolve!: (value: ReturnType<typeof state>) => void;
    mocks.state.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1500);
    expect(mocks.state).toHaveBeenCalledTimes(2);
    await runner.stop();
    resolve(state(15, { ended: true }));
    await vi.advanceTimersByTimeAsync(0);
    expect(runner.status()).toMatchObject({
      state: 'COMPLETED',
      active: false,
      hls: { currentTime: 0 },
    });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('also stops polling for generic native HTML5 completion', async () => {
    env.TARGET_MODE = 'explicit';
    env.TARGET_LESSON_URL = 'https://lms.example.test/lesson/1';
    const evaluate = vi.fn().mockResolvedValue(state(15, { ended: true }));
    mocks.page.locator.mockReturnValue({ count: async () => 1, evaluate });
    const runner = new Runner();
    await runner.start();
    await vi.advanceTimersByTimeAsync(500);
    expect(runner.status()).toMatchObject({
      state: 'COMPLETED',
      active: false,
      video: { ended: true },
    });
    const calls = evaluate.mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect(evaluate).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
    expect(transitions().filter((value) => value.endsWith('->COMPLETED'))).toHaveLength(1);
  });
});
