import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { env } from '../config/env.js';

export type BrowserConnectionStatus = 'local' | 'remote_browser_connected' | 'remote_browser_reconnecting' | 'remote_browser_disconnected';

export class BrowserManager {
  private context?: BrowserContext;
  private remoteBrowser?: Browser;
  private sessionStartedAt?: number;
  private status: BrowserConnectionStatus = env.REMOTE_BROWSER_WS_URL ? 'remote_browser_disconnected' : 'local';
  public constructor(private readonly remoteBrowserWsUrl = env.REMOTE_BROWSER_WS_URL, private readonly dataDir = env.RUNNER_DATA_DIR) {}
  async page(): Promise<Page> {
    if (this.context && !this.isAlive()) this.clearDeadConnection();
    if (!this.context && this.remoteBrowserWsUrl) {
      this.status = 'remote_browser_reconnecting';
      try {
        this.remoteBrowser = await chromium.connectOverCDP(this.remoteBrowserWsUrl);
        this.context = this.remoteBrowser.contexts()[0] ?? await this.remoteBrowser.newContext({ viewport: { width: 1440, height: 900 } });
        this.sessionStartedAt = Date.now();
        this.status = 'remote_browser_connected';
      } catch {
        this.clearDeadConnection();
        this.status = 'remote_browser_disconnected';
        throw new Error('REMOTE_BROWSER_CONNECTION_FAILED');
      }
    }
    if (!this.context) {
      await mkdir(this.dataDir, { recursive: true });
      this.context = await chromium.launchPersistentContext(`${this.dataDir}/browser-profile`, { headless: true, viewport: { width: 1440, height: 900 }, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
      this.sessionStartedAt = Date.now();
    }
    return this.context.pages()[0] ?? this.context.newPage();
  }
  async close(): Promise<void> {
    if (!this.remoteBrowser) await this.context?.storageState({ path: `${this.dataDir}/browser-state.json` });
    await this.context?.close(); this.context = undefined;
    if (this.remoteBrowser) await this.remoteBrowser.close(); this.remoteBrowser = undefined;
    this.sessionStartedAt = undefined;
    this.status = this.remoteBrowserWsUrl ? 'remote_browser_disconnected' : 'local';
  }
  connected(): boolean { return this.remoteBrowser?.isConnected() ?? Boolean(this.context?.browser()?.isConnected()); }
  connectionStatus(): BrowserConnectionStatus { return this.status; }
  sessionAgeSeconds(): number | undefined { return this.sessionStartedAt ? Math.floor((Date.now() - this.sessionStartedAt) / 1000) : undefined; }
  private isAlive(): boolean { return this.remoteBrowser ? this.remoteBrowser.isConnected() : Boolean(this.context?.browser()?.isConnected()); }
  private clearDeadConnection(): void { this.context = undefined; this.remoteBrowser = undefined; this.sessionStartedAt = undefined; }
}

export async function testRemoteBrowserConnection(remoteBrowserWsUrl = env.REMOTE_BROWSER_WS_URL): Promise<{ ok: boolean; mode: 'remote' | 'not_configured'; error?: 'REMOTE_BROWSER_CONNECTION_FAILED' }> {
  if (!remoteBrowserWsUrl) return { ok: false, mode: 'not_configured' };
  const manager = new BrowserManager(remoteBrowserWsUrl);
  try {
    const page = await manager.page();
    await page.goto('about:blank');
    return { ok: true, mode: 'remote' };
  } catch {
    return { ok: false, mode: 'remote', error: 'REMOTE_BROWSER_CONNECTION_FAILED' };
  } finally {
    await manager.close().catch(() => undefined);
  }
}
