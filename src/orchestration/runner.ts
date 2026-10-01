import type { Page } from 'playwright';
import { BrowserManager } from '../browser/browserManager.js';
import { env } from '../config/env.js';
import { GenericLMSAdapter } from '../lms/GenericLMSAdapter.js';
import { DeterministicProvider, type AIProvider } from '../ai/AIProvider.js';
import { AutoSubmitPolicy } from '../security/autoSubmitPolicy.js';
import { logger } from '../util/logger.js';
import { RunnerStateMachine, type RunnerState } from './runnerStateMachine.js';
import type { Question, Recommendation } from '../questions/types.js';

export class Runner {
  private readonly browser = new BrowserManager(); private readonly adapter = new GenericLMSAdapter(); private readonly machine = new RunnerStateMachine();
  private readonly solver: AIProvider; private readonly policy = new AutoSubmitPolicy(env.AUTO_SUBMIT, env.AUTOSUBMIT_ALLOWED_HOSTS.split(','));
  private active = false; private pending?: { question: Question; recommendation: Recommendation }; private timer?: NodeJS.Timeout;
  private heartbeatAt?: number;
  constructor(solver: AIProvider = new DeterministicProvider()) { this.solver = solver; }
  status(): { state: RunnerState; active: boolean; browser: boolean; pending: Question | undefined; heartbeatAt: number | undefined } { return { state: this.machine.state, active: this.active, browser: this.browser.connected(), pending: this.pending?.question, heartbeatAt: this.heartbeatAt }; }
  private move(next: RunnerState, reason: string): void { const event = this.machine.transition(next); logger.info({ module: 'runner', event: 'state_transition', ...event, reason }); }
  async start(): Promise<void> { if (this.active) return; this.active = true; this.heartbeatAt = Date.now(); this.move('RESTORING_SESSION', 'runner started'); const page = await this.browser.page(); await page.goto(env.LMS_BASE_URL, { waitUntil: 'domcontentloaded' }); await this.advance(page); this.timer = setInterval(() => void this.tick(), env.QUESTION_POLL_INTERVAL_MS); }
  async pause(): Promise<void> { this.active = false; this.move('PAUSED', 'operator paused runner'); }
  async resume(): Promise<void> { if (!this.active) await this.start(); }
  async stop(): Promise<void> { this.active = false; if (this.timer) clearInterval(this.timer); this.timer = undefined; await this.browser.close(); this.move('COMPLETED', 'operator stopped runner'); }
  private async tick(): Promise<void> { if (!this.active || this.pending) return; this.heartbeatAt = Date.now(); try { const page = await this.browser.page(); const question = await this.adapter.question(page); if (!question) return; this.move('QUESTION_DETECTED', 'question dialog appeared'); await page.locator('video').evaluate((video: HTMLVideoElement) => video.pause()).catch(() => undefined); this.move('SOLVING_QUESTION', 'extracting recommendation'); const recommendation = await this.solver.solveQuestion(question); this.pending = { question, recommendation }; if (this.policy.permits(question.url)) { logger.warn({ event: 'auto_submit_test_host', hostname: new URL(question.url).hostname }); await this.confirm(recommendation.answerOptionId); } else this.move('WAITING_FOR_CONFIRMATION', 'production host requires operator confirmation'); } catch (error) { logger.error({ err: error }, 'runner tick failed'); this.move('RECOVERING', 'polling error'); } }
  private async advance(page: Page): Promise<void> {
    if (page.url().includes('/login')) { this.move('AUTH_REQUIRED', 'login required'); return; }
    if (new URL(page.url()).pathname === '/') {
      this.move('DASHBOARD', 'dashboard loaded'); this.move('SCANNING_COURSES', 'selecting incomplete course');
      const course = page.locator('[data-course]').first(); if (!(await course.count())) return;
      await Promise.all([page.waitForURL(/\/course\//), course.click()]);
    }
    if (page.url().includes('/course/')) {
      this.move('SCANNING_LESSONS', 'course loaded'); const lesson = page.locator('[data-lesson][data-completed="false"]').first(); if (!(await lesson.count())) return;
      this.move('OPENING_LESSON', 'selecting incomplete lesson'); await Promise.all([page.waitForURL(/\/lesson\//), lesson.click()]);
    }
    if (page.url().includes('/lesson/')) {
      this.move('DETECTING_PLAYER', 'lesson loaded'); if (await this.adapter.player(page)) {
        await page.locator('video').evaluate((video: HTMLVideoElement, muted: boolean) => { video.muted = muted; void video.play().catch(() => undefined); }, env.MUTE_VIDEO);
        this.move('PLAYING', 'player started');
      }
    }
  }
  async confirm(optionId: string): Promise<void> { const pending = this.pending; if (!pending) throw new Error('No question awaits confirmation'); if (!pending.question.options.some((option) => option.id === optionId)) throw new Error('Selected option does not belong to this question'); const page = await this.browser.page(); this.move('SUBMITTING_ANSWER', 'operator selected answer'); const index = await page.locator('input').evaluateAll((inputs, id) => inputs.findIndex((input) => input instanceof HTMLInputElement && input.value === id), optionId); if (index < 0) throw new Error('Selected option is no longer available'); await page.locator('input').nth(index).check(); await page.getByRole('button', { name: /submit/i }).click(); await page.locator('[data-question]').waitFor({ state: 'hidden', timeout: 5000 }); this.pending = undefined; this.move('RESUMING_VIDEO', 'answer acknowledged'); await page.locator('video').evaluate((video: HTMLVideoElement) => void video.play()).catch(() => undefined); this.move('PLAYING', 'video resumed'); }
}
