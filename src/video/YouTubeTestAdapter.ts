import type { Page } from 'playwright';

export type YouTubeTestState = { ready: boolean; playerState: number | null; currentTime: number; duration: number; muted: boolean; error: string | null; errorCode: number | null; origin: string };
export class YouTubeTestAdapter {
  async state(page: Page): Promise<YouTubeTestState> { return page.evaluate(() => (window as Window & { __YT_TEST_STATE__?: YouTubeTestState }).__YT_TEST_STATE__ ?? { ready: false, playerState: null, currentTime: 0, duration: 0, muted: true, error: 'YOUTUBE_API_LOAD_FAILED', errorCode: null, origin: window.location.origin }); }
  async start(page: Page): Promise<void> { await page.evaluate(() => (window as Window & { __YT_TEST_START__?: () => void }).__YT_TEST_START__?.()); }
  async waitReady(page: Page, timeout = 15_000): Promise<YouTubeTestState> { await page.waitForFunction(() => { const state = (window as Window & { __YT_TEST_STATE__?: YouTubeTestState }).__YT_TEST_STATE__; return Boolean(state?.ready || state?.error); }, undefined, { timeout }); const state = await this.state(page); if (state.error) throw new Error(state.error); return state; }
  playing(state: YouTubeTestState): boolean { return state.playerState === 1; }
  ended(state: YouTubeTestState): boolean { return state.playerState === 0; }
}
