import type { Page } from 'playwright';
import { BrowserManager } from '../browser/browserManager.js';
import { env } from '../config/env.js';
import { GenericLMSAdapter } from '../lms/GenericLMSAdapter.js';
import { DeterministicProvider, type AIProvider } from '../ai/AIProvider.js';
import { AutoSubmitPolicy } from '../security/autoSubmitPolicy.js';
import { logger } from '../util/logger.js';
import { RunnerStateMachine, type RunnerState } from './runnerStateMachine.js';
import type { Question, Recommendation } from '../questions/types.js';
import { YouTubeTestAdapter, type YouTubeTestState } from '../video/YouTubeTestAdapter.js';
import { HLSTestAdapter, type HLSState, type HLSErrorCode } from '../video/HLSTestAdapter.js';
import {
  ICAITestAdapter,
  ICAILoginError,
  ICAI_ORIGIN,
  validOtp,
  type LoginDiagnostics,
} from '../icai/ICAITestAdapter.js';
import { isTerminalYouTubeError } from '../video/youtubeErrors.js';

export class RunnerOperationError extends Error {
  constructor(
    public readonly code:
      | 'NO_PENDING_QUESTION'
      | 'QUESTION_NO_LONGER_PRESENT'
      | 'BROWSER_SESSION_EXPIRED'
      | 'QUESTION_FLOW_DISABLED'
      | 'ICAI_MODE_REQUIRED'
      | 'ICAI_OTP_STATE_REQUIRED'
      | 'ICAI_OTP_FORMAT_INVALID'
      | 'ICAI_OTP_SUBMISSION_IN_PROGRESS',
    public readonly recoverable: boolean,
  ) {
    super(code);
  }
}
type VideoStatus = {
  detected: boolean;
  paused: boolean;
  currentTime: number;
  duration: number;
  ended: boolean;
};
type Pending = { question: Question; recommendation: Recommendation };
type YouTubeStatus = YouTubeTestState & {
  videoId: string;
  advancing: boolean;
  result?: 'PLAYBACK_VERIFIED';
};

export class Runner {
  private readonly browser = new BrowserManager();
  private readonly adapter = new GenericLMSAdapter();
  private readonly youtubeAdapter = new YouTubeTestAdapter();
  private readonly hlsAdapter = new HLSTestAdapter();
  private readonly icaiAdapter = new ICAITestAdapter();
  private icai?: {
    stage: 'login' | 'otp_required' | 'authenticated' | 'error';
    srnConfigured: boolean;
    loginOrigin: string;
    diagnostic?: LoginDiagnostics;
  };
  private otpSubmitting = false;
  private icaiPage?: Page;
  private readonly machine = new RunnerStateMachine();
  private readonly solver: AIProvider;
  private readonly policy = new AutoSubmitPolicy(
    env.TARGET_MODE === 'icai_test' ? false : env.AUTO_SUBMIT,
    env.AUTOSUBMIT_ALLOWED_HOSTS.split(','),
  );
  private active = false;
  private pending?: Pending;
  private timer?: NodeJS.Timeout;
  private heartbeatAt?: number;
  private courseUrl?: string;
  private lessonUrl?: string;
  private currentUrl?: string;
  private video?: VideoStatus;
  private youtube?: YouTubeStatus;
  private youtubeSample?: { time: number; observedAt: number };
  private ticking = false;
  private hls?: HLSState & {
    sourceUrlHost: string;
    advancing: boolean;
    result?: 'PLAYBACK_VERIFIED';
  };
  private hlsSample?: { time: number; observedAt: number };
  private errorCode?: string;
  private hlsStartedAt = 0;
  private hlsAdvanced = false;
  constructor(solver: AIProvider = new DeterministicProvider()) {
    this.solver = solver;
  }
  status(): {
    state: RunnerState;
    active: boolean;
    browser: boolean;
    browserStatus: string;
    browserSessionAgeSeconds: number | undefined;
    targetMode: string;
    currentUrl: string | undefined;
    courseUrl: string | undefined;
    lessonUrl: string | undefined;
    questionPending: boolean;
    pending: Question | undefined;
    video: VideoStatus | undefined;
    youtube: YouTubeStatus | undefined;
    hls: Runner['hls'];
    icai: Runner['icai'];
    errorCode: string | undefined;
    heartbeatAt: number | undefined;
  } {
    return {
      state: this.machine.state,
      active: this.active,
      browser: this.browser.connected(),
      browserStatus: this.browser.connectionStatus(),
      browserSessionAgeSeconds: this.browser.sessionAgeSeconds(),
      targetMode: env.TARGET_MODE,
      currentUrl: this.currentUrl,
      courseUrl: this.courseUrl,
      lessonUrl: this.lessonUrl,
      questionPending: Boolean(this.pending),
      pending: this.pending?.question,
      video: this.video,
      youtube: this.youtube,
      hls: this.hls,
      icai: this.icai,
      errorCode: this.errorCode,
      heartbeatAt: this.heartbeatAt,
    };
  }
  private move(next: RunnerState, reason: string): void {
    if (
      this.machine.state === 'COMPLETED' ||
      this.machine.state === 'ERROR' ||
      this.machine.state === next
    )
      return;
    const event = this.machine.transition(next);
    logger.info({ module: 'runner', event: 'state_transition', ...event, reason });
  }
  private halt(): void {
    this.active = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
  private complete(reason: string): void {
    if (this.machine.state === 'COMPLETED' || this.machine.state === 'ERROR') return;
    this.halt();
    this.move('VERIFYING_COMPLETION', reason);
    this.move('COMPLETED', reason);
  }
  private hlsFailure(code: HLSErrorCode): void {
    if (this.machine.state === 'COMPLETED' || this.machine.state === 'ERROR') return;
    this.errorCode = code;
    this.halt();
    if (this.hls) this.hls.error = code;
    this.move('ERROR', code);
  }
  async start(): Promise<void> {
    if (
      this.active ||
      this.machine.state === 'COMPLETED' ||
      this.machine.state === 'ERROR' ||
      (env.TARGET_MODE === 'icai_test' && this.icai)
    )
      return;
    this.pending = undefined;
    this.active = true;
    this.heartbeatAt = Date.now();
    this.move('RESTORING_SESSION', 'runner started');
    try {
      this.validateTarget();
      const page = await this.browser.page();
      if (env.TARGET_MODE === 'icai_test') {
        this.icai = {
          stage: 'login',
          srnConfigured: Boolean(env.ICAI_SRN),
          loginOrigin: ICAI_ORIGIN,
        };
        this.icaiPage = page;
        this.move('AUTH_REQUIRED', 'ICAI login requires human OTP');
        await this.icaiAdapter.requestOtp(page, env.ICAI_LOGIN_URL, env.ICAI_SRN!);
        if (!this.active) return;
        this.currentUrl = ICAI_ORIGIN;
        this.icai.stage = 'otp_required';
        this.halt();
        this.move('OTP_REQUIRED', 'normal OTP input detected; waiting for operator');
        return;
      }
      if (env.TARGET_MODE === 'hls_test') {
        await page.goto(`${env.LMS_BASE_URL}/hls-test`, { waitUntil: 'domcontentloaded' });
        this.currentUrl = new URL('/hls-test', env.LMS_BASE_URL).origin + '/hls-test';
        this.move('DETECTING_PLAYER', 'controlled HLS test page opened');
        await this.hlsAdapter.start(page, env.HLS_TEST_URL!);
        const state = await this.hlsAdapter.state(page);
        this.hls = {
          ...state,
          sourceUrlHost: new URL(env.HLS_TEST_URL!).hostname,
          advancing: false,
        };
        this.hlsStartedAt = Date.now();
        this.hlsAdvanced = false;
        this.hlsSample = { time: state.currentTime, observedAt: this.hlsStartedAt };
        if (state.error) {
          this.hlsFailure(state.error);
          return;
        }
        this.move('PLAYING', 'HLS player started');
      } else if (env.TARGET_MODE === 'youtube_test') {
        await page.goto(
          `${env.LMS_BASE_URL}/youtube-test?videoId=${encodeURIComponent(env.YOUTUBE_TEST_VIDEO_ID ?? '')}`,
          { waitUntil: 'domcontentloaded' },
        );
        this.currentUrl = page.url();
        this.move('DETECTING_PLAYER', 'controlled YouTube test page opened');
        const state = await this.youtubeAdapter.waitReady(page);
        await this.youtubeAdapter.start(page);
        this.youtube = { ...state, videoId: env.YOUTUBE_TEST_VIDEO_ID ?? '', advancing: false };
        this.youtubeSample = { time: state.currentTime, observedAt: Date.now() };
        this.move('PLAYING', 'YouTube player started');
      } else {
        await page.goto(
          env.TARGET_MODE === 'explicit' && env.TARGET_LESSON_URL
            ? env.TARGET_LESSON_URL
            : env.LMS_BASE_URL,
          { waitUntil: 'domcontentloaded' },
        );
        this.currentUrl = page.url();
        await this.advance(page);
      }
      if (this.active)
        this.timer = setInterval(() => void this.tick(), env.QUESTION_POLL_INTERVAL_MS);
    } catch (error) {
      if (env.TARGET_MODE === 'icai_test') {
        this.icaiFailure(error);
        return;
      }
      this.halt();
      if (env.TARGET_MODE === 'hls_test')
        this.errorCode = env.HLS_TEST_URL ? 'HLS_MEDIA_ERROR' : 'HLS_TEST_URL_REQUIRED';
      this.move(
        'ERROR',
        env.TARGET_MODE === 'hls_test'
          ? env.HLS_TEST_URL
            ? 'HLS_MEDIA_ERROR'
            : 'HLS_TEST_URL_REQUIRED'
          : 'RUNNER_START_FAILED',
      );
      if (env.TARGET_MODE !== 'hls_test') throw error;
    }
  }
  private icaiFailure(error: unknown): void {
    if (this.machine.state === 'ERROR' || this.machine.state === 'COMPLETED') return;
    const failure =
      error instanceof ICAILoginError ? error : new ICAILoginError('ICAI_LOGIN_PAGE_UNAVAILABLE');
    this.halt();
    this.errorCode = failure.code;
    if (this.icai) {
      this.icai.stage = 'error';
      this.icai.diagnostic = failure.diagnostic;
    }
    this.move('ERROR', failure.code);
  }
  async submitIcaiOtp(otp: string): Promise<void> {
    if (env.TARGET_MODE !== 'icai_test')
      throw new RunnerOperationError('ICAI_MODE_REQUIRED', false);
    if (!validOtp(otp)) throw new RunnerOperationError('ICAI_OTP_FORMAT_INVALID', false);
    if (this.machine.state !== 'OTP_REQUIRED')
      throw new RunnerOperationError('ICAI_OTP_STATE_REQUIRED', false);
    if (this.otpSubmitting)
      throw new RunnerOperationError('ICAI_OTP_SUBMISSION_IN_PROGRESS', false);
    this.otpSubmitting = true;
    try {
      const page = this.icaiPage;
      if (!this.browser.connected() || !page || page.isClosed())
        throw new ICAILoginError('ICAI_LOGIN_NOT_CONFIRMED');
      await this.icaiAdapter.submitOtp(page, otp, env.ICAI_SRN!);
      if (this.machine.state !== 'OTP_REQUIRED') return;
      this.currentUrl = ICAI_ORIGIN;
      this.icai!.stage = 'authenticated';
      this.move('DASHBOARD', 'ICAI authenticated dashboard confirmed');
      this.halt();
      this.move('PAUSED', 'ICAI login canary finished; manual dashboard inspection');
    } catch (error) {
      this.icaiFailure(
        error instanceof ICAILoginError ? error : new ICAILoginError('ICAI_LOGIN_NOT_CONFIRMED'),
      );
    } finally {
      this.otpSubmitting = false;
    }
  }
  async pause(): Promise<void> {
    if (this.machine.state === 'COMPLETED' || this.machine.state === 'ERROR') return;
    this.halt();
    if (env.TARGET_MODE === 'icai_test') return;
    if (env.TARGET_MODE === 'hls_test' && this.browser.connected()) {
      await this.hlsAdapter.pause(await this.browser.page());
      if (this.hls)
        this.hls = { ...this.hls, ...(await this.hlsAdapter.state(await this.browser.page())) };
    }
    this.move('PAUSED', 'operator paused runner');
  }
  async resume(): Promise<void> {
    if (!this.active) await this.start();
  }
  async stop(): Promise<void> {
    this.halt();
    this.pending = undefined;
    await this.browser.close();
    this.move('COMPLETED', 'operator stopped runner');
  }
  async failClosed(reason: string): Promise<void> {
    this.halt();
    this.pending = undefined;
    await this.browser.invalidate();
    this.move('ERROR', reason);
  }
  private validateTarget(): void {
    if (env.TARGET_MODE === 'icai_test') {
      if (!env.ICAI_SRN || new URL(env.ICAI_LOGIN_URL).origin !== ICAI_ORIGIN)
        throw new ICAILoginError('ICAI_LOGIN_PAGE_UNAVAILABLE');
      return;
    }
    if (env.TARGET_MODE === 'hls_test') {
      if (!env.HLS_TEST_URL) throw new Error('HLS_TEST_URL_REQUIRED');
      return;
    }
    if (env.TARGET_MODE === 'youtube_test') {
      if (!env.YOUTUBE_TEST_VIDEO_ID) throw new Error('YOUTUBE_TEST_VIDEO_ID_REQUIRED');
      return;
    }
    if (env.TARGET_MODE !== 'explicit') return;
    if (!env.TARGET_LESSON_URL && !env.TARGET_COURSE_URL)
      throw new Error('EXPLICIT_TARGET_REQUIRED');
    for (const candidate of [env.TARGET_LESSON_URL, env.TARGET_COURSE_URL])
      if (candidate && new URL(candidate).origin !== new URL(env.LMS_BASE_URL).origin)
        throw new Error('TARGET_OUTSIDE_LMS_ORIGIN');
  }
  private async tick(): Promise<void> {
    if (env.TARGET_MODE === 'icai_test' || !this.active || this.pending || this.ticking) return;
    this.ticking = true;
    this.heartbeatAt = Date.now();
    try {
      if (
        env.REMOTE_BROWSER_SESSION_MAX_SECONDS &&
        (this.browser.sessionAgeSeconds() ?? 0) >= env.REMOTE_BROWSER_SESSION_MAX_SECONDS
      ) {
        this.move('RECOVERING', 'remote browser session age limit reached');
        await this.browser.close();
        return;
      }
      const page = await this.browser.page();
      if (!this.active) return;
      if (env.TARGET_MODE !== 'hls_test') this.currentUrl = page.url();
      if (env.TARGET_MODE === 'hls_test') {
        const state = await this.hlsAdapter.state(page);
        if (!this.active) return;
        const now = Date.now();
        const previous = this.hlsSample!;
        const advancing = state.currentTime > previous.time + 0.05;
        this.hls = { ...state, sourceUrlHost: new URL(env.HLS_TEST_URL!).hostname, advancing };
        if (state.error) {
          this.hlsFailure(state.error);
          return;
        }
        if (advancing) {
          this.hlsAdvanced = true;
          this.hlsSample = { time: state.currentTime, observedAt: now };
        }
        if (state.ended && this.hlsAdvanced) {
          this.complete('HLS native media ended');
          return;
        }
        if (now - previous.observedAt >= 10_000 && !advancing) {
          this.hlsFailure('HLS_PLAYBACK_NOT_ADVANCING');
          return;
        }
        if (
          now - this.hlsStartedAt >= env.HLS_TEST_MAX_SECONDS * 1000 &&
          this.hlsAdvanced &&
          advancing
        ) {
          await this.hlsAdapter.pause(page);
          if (!this.active) return;
          this.hls = {
            ...this.hls,
            ...(await this.hlsAdapter.state(page)),
            result: 'PLAYBACK_VERIFIED',
          };
          this.halt();
          this.move('PAUSED', 'HLS playback verified for configured canary duration');
        }
        return;
      }
      if (env.TARGET_MODE === 'youtube_test') {
        const state = await this.youtubeAdapter.state(page);
        const previous = this.youtubeSample;
        const now = Date.now();
        const advancing = previous ? state.currentTime >= previous.time + 1.5 : false;
        this.youtube = { ...state, videoId: env.YOUTUBE_TEST_VIDEO_ID ?? '', advancing };
        if (state.error && isTerminalYouTubeError(state.errorCode)) {
          this.halt();
          this.move('ERROR', state.error);
          return;
        }
        if (state.error) throw new Error(state.error);
        if (this.youtubeAdapter.ended(state)) {
          this.complete('YouTube video completed');
          return;
        }
        if (previous && now - previous.observedAt >= 5000 && !advancing)
          throw new Error('YOUTUBE_PLAYBACK_NOT_ADVANCING');
        if (state.currentTime >= env.YOUTUBE_TEST_MAX_SECONDS) {
          this.youtube.result = 'PLAYBACK_VERIFIED';
          this.halt();
          this.move('PAUSED', 'YouTube playback verified for configured canary duration');
          return;
        }
        if (!previous || now - previous.observedAt >= 3000)
          this.youtubeSample = { time: state.currentTime, observedAt: now };
        return;
      }
      await this.captureVideoState(page);
      if (!this.active) return;
      if (this.video?.ended) {
        this.complete('controlled lesson media completed');
        return;
      }
      const question = await this.adapter.question(page);
      if (!question) return;
      this.move('QUESTION_DETECTED', 'question dialog appeared');
      await page
        .locator('video')
        .evaluate((video: HTMLVideoElement) => video.pause())
        .catch(() => undefined);
      await this.captureVideoState(page);
      this.move('SOLVING_QUESTION', 'extracting recommendation');
      const recommendation = await this.solver.solveQuestion(question);
      this.pending = { question, recommendation };
      if (this.policy.permits(question.url)) await this.confirm(recommendation.answerOptionId);
      else this.move('WAITING_FOR_CONFIRMATION', 'host requires operator confirmation');
    } catch (error) {
      logger.error(
        {
          error:
            env.TARGET_MODE === 'hls_test'
              ? 'HLS_MEDIA_ERROR'
              : error instanceof Error
                ? error.message
                : 'unknown',
        },
        'runner tick failed',
      );
      this.pending = undefined;
      this.halt();
      if (env.TARGET_MODE === 'hls_test') this.hlsFailure('HLS_MEDIA_ERROR');
      else this.move('ERROR', 'safe polling recovery');
    } finally {
      this.ticking = false;
    }
  }
  private async retryFor(page: Page, selector: string, label: string): Promise<boolean> {
    for (const delay of [0, 1000, 2000, 4000, 8000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (await page.locator(selector).count()) return true;
      if (delay)
        await page.goto(page.url(), { waitUntil: 'domcontentloaded' }).catch(() => undefined);
    }
    this.move('RECOVERING', `${label} unavailable after bounded retry`);
    return false;
  }
  private async advance(page: Page): Promise<void> {
    if (page.url().includes('/login')) {
      this.move('AUTH_REQUIRED', 'login required');
      return;
    }
    if (env.TARGET_MODE === 'explicit' && env.TARGET_LESSON_URL) {
      this.lessonUrl = env.TARGET_LESSON_URL;
      await this.openPlayer(page);
      return;
    }
    if (new URL(page.url()).pathname === '/') {
      this.move('DASHBOARD', 'dashboard loaded');
      this.move('SCANNING_COURSES', 'selecting course');
      if (env.TARGET_MODE === 'explicit' && env.TARGET_COURSE_URL) {
        await page.goto(env.TARGET_COURSE_URL, { waitUntil: 'domcontentloaded' });
        this.courseUrl = page.url();
      } else {
        if (!(await this.retryFor(page, '[data-course]', 'course list'))) return;
        const course = page.locator('[data-course]').first();
        await Promise.all([page.waitForURL(/\/course\//), course.click()]);
        this.courseUrl = page.url();
      }
    }
    if (page.url().includes('/course/')) {
      this.move('SCANNING_LESSONS', 'course loaded');
      if (!(await this.retryFor(page, '[data-lesson][data-completed="false"]', 'lesson list')))
        return;
      const lesson = page.locator('[data-lesson][data-completed="false"]').first();
      this.move('OPENING_LESSON', 'selecting incomplete lesson');
      await Promise.all([page.waitForURL(/\/lesson\//), lesson.click()]);
      this.lessonUrl = page.url();
    }
    if (page.url().includes('/lesson/')) await this.openPlayer(page);
  }
  private async openPlayer(page: Page): Promise<void> {
    this.move('DETECTING_PLAYER', 'lesson loaded');
    if (!(await this.retryFor(page, 'video', 'player'))) return;
    await page.locator('video').evaluate((video: HTMLVideoElement, muted: boolean) => {
      video.muted = muted;
      void video.play().catch(() => undefined);
    }, env.MUTE_VIDEO);
    await this.captureVideoState(page);
    this.move('PLAYING', 'player started');
  }
  private async captureVideoState(page: Page): Promise<void> {
    this.video = await page
      .locator('video')
      .evaluate((video: HTMLVideoElement) => ({
        detected: true,
        paused: video.paused,
        currentTime: video.currentTime,
        duration: video.duration,
        ended: video.ended,
      }))
      .catch(() => undefined);
  }
  async confirm(optionId: string): Promise<void> {
    if (
      env.TARGET_MODE === 'youtube_test' ||
      env.TARGET_MODE === 'hls_test' ||
      env.TARGET_MODE === 'icai_test'
    )
      throw new RunnerOperationError('QUESTION_FLOW_DISABLED', false);
    const pending = this.pending;
    if (!pending) throw new RunnerOperationError('NO_PENDING_QUESTION', false);
    const page = await this.browser.page().catch(() => {
      throw new RunnerOperationError('BROWSER_SESSION_EXPIRED', true);
    });
    const questionVisible = await page
      .locator(`[data-question="${pending.question.id}"]`)
      .isVisible()
      .catch(() => false);
    if (!questionVisible) {
      this.pending = undefined;
      throw new RunnerOperationError('QUESTION_NO_LONGER_PRESENT', true);
    }
    if (!pending.question.options.some((option) => option.id === optionId))
      throw new RunnerOperationError('QUESTION_NO_LONGER_PRESENT', true);
    this.move('SUBMITTING_ANSWER', 'operator selected answer');
    const index = await page
      .locator('input')
      .evaluateAll(
        (inputs, id) =>
          inputs.findIndex((input) => input instanceof HTMLInputElement && input.value === id),
        optionId,
      );
    if (index < 0) throw new RunnerOperationError('QUESTION_NO_LONGER_PRESENT', true);
    await page.locator('input').nth(index).check();
    await page.getByRole('button', { name: /submit/i }).click();
    this.move('VERIFYING_ANSWER', 'waiting for acknowledgement');
    await page
      .locator('[data-question]')
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => {
        throw new RunnerOperationError('QUESTION_NO_LONGER_PRESENT', true);
      });
    this.pending = undefined;
    this.move('RESUMING_VIDEO', 'answer acknowledged');
    await page
      .locator('video')
      .evaluate((video: HTMLVideoElement) => void video.play())
      .catch(() => undefined);
    await this.captureVideoState(page);
    this.move('PLAYING', 'video resumed');
  }
}
