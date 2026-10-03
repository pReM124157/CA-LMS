import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  page: { isClosed: vi.fn(() => false) },
  requestOtp: vi.fn(),
  submitOtp: vi.fn(),
  log: vi.fn(),
  solve: vi.fn(),
  write: vi.fn(),
}));
vi.mock('../../src/config/env.js', () => ({
  env: {
    TARGET_MODE: 'icai_test',
    ICAI_LOGIN_URL: 'https://lms.icai.org/login',
    ICAI_SRN: 'SAMPLE-SRN-SECRET',
    AUTO_SUBMIT: true,
    REQUIRE_HUMAN_CONFIRMATION: false,
    AUTOSUBMIT_ALLOWED_HOSTS: 'lms.icai.org',
    QUESTION_POLL_INTERVAL_MS: 500,
  },
}));
vi.mock('../../src/browser/browserManager.js', () => ({
  BrowserManager: class {
    page = async () => mocks.page;
    connected = () => true;
    connectionStatus = () => 'remote_browser_connected';
    sessionAgeSeconds = () => 0;
    close = async () => {};
    invalidate = async () => {};
  },
}));
vi.mock('../../src/icai/ICAITestAdapter.js', async () => {
  const actual = await vi.importActual<typeof import('../../src/icai/ICAITestAdapter.js')>(
    '../../src/icai/ICAITestAdapter.js',
  );
  return {
    ...actual,
    ICAITestAdapter: class {
      requestOtp = mocks.requestOtp;
      submitOtp = mocks.submitOtp;
    },
  };
});
vi.mock('../../src/util/logger.js', () => ({ logger: { info: mocks.log, error: mocks.log } }));
vi.mock('../../src/persistence/prisma.js', () => ({
  prisma: { $executeRaw: mocks.write, $queryRaw: mocks.write },
}));
import { Runner } from '../../src/orchestration/runner.js';
import { ICAILoginError } from '../../src/icai/ICAITestAdapter.js';
const transitions = () => mocks.log.mock.calls.map(([event]) => `${event.from}->${event.to}`);
describe('ICAI login-only runner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
    mocks.page.isClosed.mockReturnValue(false);
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });
  it('stops at OTP_REQUIRED without a timer, SRN disclosure, or restart loop', async () => {
    const runner = new Runner();
    await runner.start();
    expect(runner.status()).toMatchObject({
      state: 'OTP_REQUIRED',
      active: false,
      targetMode: 'icai_test',
      icai: { stage: 'otp_required', srnConfigured: true, loginOrigin: 'https://lms.icai.org' },
    });
    expect(transitions()).toEqual([
      'BOOTING->RESTORING_SESSION',
      'RESTORING_SESSION->AUTH_REQUIRED',
      'AUTH_REQUIRED->OTP_REQUIRED',
    ]);
    expect(JSON.stringify(runner.status())).not.toContain('SAMPLE-SRN-SECRET');
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('SAMPLE-SRN-SECRET');
    await runner.resume();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mocks.requestOtp).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('submits OTP in the same session and stops at DASHBOARD/PAUSED without solving or persisting', async () => {
    const runner = new Runner({
      solveQuestion: mocks.solve,
      providerName: () => 'test',
      healthCheck: async () => true,
    });
    await runner.start();
    await runner.submitIcaiOtp('923456');
    expect(mocks.submitOtp).toHaveBeenCalledWith(mocks.page, '923456', 'SAMPLE-SRN-SECRET');
    expect(runner.status()).toMatchObject({
      state: 'PAUSED',
      active: false,
      icai: { stage: 'authenticated' },
    });
    expect(transitions().slice(-2)).toEqual(['OTP_REQUIRED->DASHBOARD', 'DASHBOARD->PAUSED']);
    expect(JSON.stringify(runner.status())).not.toMatch(/923456|SAMPLE-SRN-SECRET/);
    expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/923456|SAMPLE-SRN-SECRET/);
    expect(mocks.solve).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    await expect(runner.confirm('b')).rejects.toMatchObject({ code: 'QUESTION_FLOW_DISABLED' });
    await runner.resume();
    expect(mocks.requestOtp).toHaveBeenCalledOnce();
  });
  it.each(['', '123', '123456789', '1234x', 123456, ' 123456'])(
    'rejects malformed OTP %s before browser submission',
    async (otp) => {
      const runner = new Runner();
      await runner.start();
      await expect(runner.submitIcaiOtp(otp as string)).rejects.toMatchObject({
        code: 'ICAI_OTP_FORMAT_INVALID',
      });
      expect(mocks.submitOtp).not.toHaveBeenCalled();
      expect(runner.status().state).toBe('OTP_REQUIRED');
    },
  );
  it('rejects an OTP outside OTP_REQUIRED and concurrent submissions', async () => {
    const runner = new Runner();
    await expect(runner.submitIcaiOtp('123456')).rejects.toMatchObject({
      code: 'ICAI_OTP_STATE_REQUIRED',
    });
    await runner.start();
    let resolve!: () => void;
    mocks.submitOtp.mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    );
    const first = runner.submitIcaiOtp('123456');
    await vi.advanceTimersByTimeAsync(0);
    await expect(runner.submitIcaiOtp('123456')).rejects.toMatchObject({
      code: 'ICAI_OTP_SUBMISSION_IN_PROGRESS',
    });
    resolve();
    await first;
  });
  it.each(['1234', '12345678'])('accepts the conservative OTP boundary %s', async (otp) => {
    const runner = new Runner();
    await runner.start();
    await runner.submitIcaiOtp(otp);
    expect(runner.status().state).toBe('PAUSED');
    expect(mocks.submitOtp).toHaveBeenCalledOnce();
  });
  it('fails a closed session instead of submitting in a replacement session', async () => {
    const runner = new Runner();
    await runner.start();
    mocks.page.isClosed.mockReturnValue(true);
    await runner.submitIcaiOtp('123456');
    expect(runner.status()).toMatchObject({
      state: 'ERROR',
      errorCode: 'ICAI_LOGIN_NOT_CONFIRMED',
    });
    expect(mocks.submitOtp).not.toHaveBeenCalled();
  });
  it('rejected OTP enters one terminal ERROR without leaking raw exceptions', async () => {
    const runner = new Runner();
    await runner.start();
    mocks.submitOtp.mockRejectedValue(new ICAILoginError('ICAI_OTP_REJECTED'));
    await runner.submitIcaiOtp('923456');
    expect(runner.status()).toMatchObject({
      state: 'ERROR',
      active: false,
      errorCode: 'ICAI_OTP_REJECTED',
    });
    await runner.resume();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(transitions().filter((value) => value.endsWith('->ERROR'))).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('923456');
  });
  it('sanitizes unexpected login errors that include credentials', async () => {
    mocks.requestOtp.mockRejectedValue(
      new Error('SAMPLE-SRN-SECRET otp=923456 token=browser-secret'),
    );
    const runner = new Runner();
    await runner.start();
    expect(runner.status().errorCode).toBe('ICAI_LOGIN_PAGE_UNAVAILABLE');
    expect(JSON.stringify([runner.status(), mocks.log.mock.calls])).not.toMatch(
      /SAMPLE-SRN-SECRET|923456|browser-secret/,
    );
  });
});
