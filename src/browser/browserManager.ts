import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { env } from '../config/env.js';
export class BrowserManager {
  private context?: BrowserContext;
  private remoteBrowser?: Browser;
  public constructor(private readonly remoteBrowserWsUrl = env.REMOTE_BROWSER_WS_URL, private readonly dataDir = env.RUNNER_DATA_DIR) {}
  async page(): Promise<Page> {
    if (!this.context && this.remoteBrowserWsUrl) {
      this.remoteBrowser = await chromium.connectOverCDP(this.remoteBrowserWsUrl);
      this.context = this.remoteBrowser.contexts()[0] ?? await this.remoteBrowser.newContext({ viewport: { width: 1440, height: 900 } });
    }
    if (!this.context) {
      await mkdir(this.dataDir, { recursive: true });
      this.context = await chromium.launchPersistentContext(`${this.dataDir}/browser-profile`, { headless: true, viewport: { width: 1440, height: 900 }, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    }
    return this.context.pages()[0] ?? this.context.newPage();
  }
  async close(): Promise<void> {
    if (!this.remoteBrowser) await this.context?.storageState({ path: `${this.dataDir}/browser-state.json` });
    await this.context?.close(); this.context = undefined;
    if (this.remoteBrowser) await this.remoteBrowser.close(); this.remoteBrowser = undefined;
  }
  connected(): boolean { return this.remoteBrowser?.isConnected() ?? Boolean(this.context?.browser()?.isConnected()); }
}
