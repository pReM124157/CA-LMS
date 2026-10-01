import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('playwright', () => ({ chromium: { connectOverCDP: vi.fn(), launchPersistentContext: vi.fn() } }));
import { chromium } from 'playwright';
import { BrowserManager } from '../../src/browser/browserManager.js';

const newPage = vi.fn().mockResolvedValue({ id: 'page' });
const context = { pages: vi.fn().mockReturnValue([]), newPage, close: vi.fn().mockResolvedValue(undefined), storageState: vi.fn().mockResolvedValue(undefined), browser: vi.fn().mockReturnValue({ isConnected: () => true }) };
describe('BrowserManager browser backends', () => {
  beforeEach(() => { vi.clearAllMocks(); context.pages.mockReturnValue([]); });
  it('launches a local persistent Chromium context without a remote URL', async () => { vi.mocked(chromium.launchPersistentContext).mockResolvedValue(context as never); const manager = new BrowserManager(undefined, './data/test-local'); await manager.page(); expect(chromium.launchPersistentContext).toHaveBeenCalledOnce(); expect(chromium.connectOverCDP).not.toHaveBeenCalled(); await manager.close(); });
  it('connects over CDP without default context overrides and does not create a local profile', async () => { const remote = { contexts: vi.fn().mockReturnValue([]), newContext: vi.fn().mockResolvedValue(context), isConnected: vi.fn().mockReturnValue(true), close: vi.fn().mockResolvedValue(undefined) }; vi.mocked(chromium.connectOverCDP).mockResolvedValue(remote as never); const manager = new BrowserManager('wss://remote.example.test/cdp'); await manager.page(); expect(chromium.connectOverCDP).toHaveBeenCalledWith('wss://remote.example.test/cdp', { noDefaults: true }); expect(chromium.launchPersistentContext).not.toHaveBeenCalled(); await manager.close(); expect(remote.close).toHaveBeenCalledOnce(); });
  it('redacts a remote connection failure without silently falling back to local Chromium', async () => { vi.mocked(chromium.connectOverCDP).mockRejectedValue(new Error('token=secret')); const manager = new BrowserManager('wss://token@remote.example.test/cdp'); await expect(manager.page()).rejects.toThrow('REMOTE_BROWSER_CONNECTION_FAILED'); expect(chromium.launchPersistentContext).not.toHaveBeenCalled(); });
});
