import type { Page } from 'playwright';

export type HLSErrorCode =
  | 'HLS_MANIFEST_LOAD_FAILED'
  | 'HLS_MEDIA_ERROR'
  | 'HLS_PLAYBACK_NOT_ADVANCING'
  | 'HLS_UNSUPPORTED'
  | 'MEDIA_DECODE_FAILED';
export type HLSState = {
  detected: boolean;
  paused: boolean;
  currentTime: number;
  duration: number;
  ended: boolean;
  readyState: number;
  networkState: number;
  error?: HLSErrorCode;
};
export class HLSTestAdapter {
  async start(page: Page, source: string): Promise<void> {
    await page.waitForFunction(
      () =>
        typeof (window as unknown as { __HLS_TEST_START__?: unknown }).__HLS_TEST_START__ ===
        'function',
      undefined,
      { timeout: 10_000 },
    );
    await page.evaluate(
      (url) =>
        (window as unknown as { __HLS_TEST_START__: (source: string) => void }).__HLS_TEST_START__(
          url,
        ),
      source,
    );
  }
  async state(page: Page): Promise<HLSState> {
    return page.locator('video').evaluate((video: HTMLVideoElement) => ({
      detected: true,
      paused: video.paused,
      currentTime: video.currentTime,
      duration: video.duration,
      ended: video.ended,
      readyState: video.readyState,
      networkState: video.networkState,
      error: (window as unknown as { __HLS_TEST_ERROR__?: HLSErrorCode }).__HLS_TEST_ERROR__,
    }));
  }
  async pause(page: Page): Promise<void> {
    await page.locator('video').evaluate((video: HTMLVideoElement) => video.pause());
  }
}
