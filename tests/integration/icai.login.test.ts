import type { Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from 'playwright';
const shared = vi.hoisted(() => ({
  page: undefined as Page | undefined,
  log: vi.fn(),
  write: vi.fn(),
}));
vi.mock('../../src/config/env.js', async () => {
  const actual =
    await vi.importActual<typeof import('../../src/config/env.js')>('../../src/config/env.js');
  return {
    ...actual,
    env: actual.parseEnv({
      TARGET_MODE: 'icai_test',
      ICAI_SRN: 'ABC1234567',
      AUTO_SUBMIT: 'false',
      REQUIRE_HUMAN_CONFIRMATION: 'true',
    }),
  };
});
vi.mock('../../src/util/logger.js', () => ({ logger: { info: shared.log, error: shared.log } }));
vi.mock('../../src/browser/browserManager.js', () => ({
  BrowserManager: class {
    page = async () => shared.page!;
    connected = () => Boolean(shared.page && !shared.page.isClosed());
    connectionStatus = () => 'remote_browser_connected';
    sessionAgeSeconds = () => 0;
    close = async () => {
      await shared.page?.close();
    };
    invalidate = async () => {
      await shared.page?.close();
    };
  },
  testRemoteBrowserConnection: vi.fn(),
}));
vi.mock('../../src/persistence/prisma.js', () => ({ prisma: { $executeRaw: shared.write } }));
import { Runner } from '../../src/orchestration/runner.js';
import { createApp } from '../../src/server/app.js';
import { ICAITestAdapter } from '../../src/icai/ICAITestAdapter.js';
let browser: Browser;
let context: BrowserContext;
let page: Page;
let requests: string[];
const credentials = `Basic ${Buffer.from('admin:change-me').toString('base64')}`;
const fixture = async (path: string): Promise<void> => {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    if (url.origin !== 'https://lms.icai.org') return route.abort();
    let body = '';
    if (url.pathname === '/login' || url.pathname === '/')
      body =
        '<h1>Login</h1><form action=/request method=post><label>Student Registration Number<input name=srn></label><button>Send OTP</button></form>';
    if (url.pathname === '/request')
      body =
        '<h1>OTP Login</h1><form action=/verify method=post><label>One-time password<input name=otp autocomplete=one-time-code></label><button>Verify OTP</button></form>';
    if (url.pathname === '/verify') {
      const otp = new URLSearchParams(route.request().postData() ?? '').get('otp');
      body =
        otp === '654321'
          ? '<h1>Dashboard</h1><a href=/logout>Logout</a><a href=/course/lecture>Open lecture</a><video></video><script>window.mediaPlays=0;const play=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){window.mediaPlays++;return play.call(this)}</script>'
          : '<h1>OTP Login</h1><p role=alert>Invalid OTP</p><label>OTP<input name=otp value=111111></label><button>Verify OTP</button>';
    }
    if (url.pathname === '/missing')
      body =
        '<h1>ICAI Digital Learning Campus</h1><label>SRN ABC1234567<input type=text name=unknown placeholder="Unknown ABC1234567" value="private-value"></label><button>Help 654321</button><script>localStorage.setItem("private","browser-token-secret")</script>';
    if (url.pathname === '/escape')
      return route.fulfill({
        status: 302,
        headers: { location: 'https://outside.example.test/login' },
      });
    await route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html>${body}` });
  });
  // No live network requests: every request in this context is intercepted above.
  if (path !== '/login') await page.goto(`https://lms.icai.org${path}`);
};
const spaFixture = async (
  options: {
    loginStatus?: number;
    rootStatus?: number;
    loginEmpty?: boolean;
    rootEmpty?: boolean;
    delayMs?: number;
    escape?: boolean;
    controlMarkup?: string;
    pageMarkup?: string;
    requestMarkup?: string;
  } = {},
): Promise<void> => {
  const form =
    '<form id="srn-form" action="/request" method="post" hidden><label>SRN<input name="srn"></label>' +
    (options.requestMarkup ?? '<button>Generate OTP</button>') +
    '</form>';
  const button =
    options.controlMarkup ??
    '<button onclick="document.getElementById(\'srn-form\').hidden=false;this.hidden=true">Login with OTP</button>';
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url.pathname);
    if (url.origin !== 'https://lms.icai.org') return route.abort();
    if (options.escape && url.pathname === '/login')
      return route.fulfill({
        status: 302,
        headers: { location: 'https://outside.example.test/escape' },
      });
    if (url.pathname === '/request')
      return route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<label>OTP<input name="otp"></label><button>Verify OTP</button>',
      });
    const root = url.pathname === '/';
    const status = (root ? options.rootStatus : options.loginStatus) ?? 200;
    const empty = root ? options.rootEmpty : options.loginEmpty;
    const rendered = options.delayMs
      ? `${form}<h1>ICAI Digital Learning Campus</h1><div id="spa"></div><script>setTimeout(()=>document.getElementById('spa').innerHTML=${JSON.stringify(button)},${options.delayMs})</script>`
      : form + button;
    const body =
      status >= 300 || empty
        ? '<input name="unknown-ABC1234567" placeholder="ABC1234567" value="654321"><button>Help ABC1234567</button>'
        : (options.pageMarkup ?? rendered);
    await route.fulfill({ status, contentType: 'text/html', body });
  });
};
describe('controlled ICAI browser and OTP API fixtures', () => {
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });
  afterAll(async () => {
    await browser.close();
  });
  beforeEach(async () => {
    context = await browser.newContext();
    page = await context.newPage();
    shared.page = page;
    requests = [];
    shared.log.mockClear();
    shared.write.mockClear();
  });
  afterEach(async () => {
    await context.close();
    vi.restoreAllMocks();
  });
  it.each([
    '<button onclick="document.getElementById(\'srn-form\').hidden=false;this.hidden=true">Login with OTP</button>',
    '<div role="button" onclick="document.getElementById(\'srn-form\').hidden=false;this.hidden=true">Log in with OTP</div>',
    '<div tabindex="0" onclick="document.getElementById(\'srn-form\').hidden=false;this.hidden=true"><span><span> Login   with OTP </span></span></div>',
    '<div role="link" onclick="document.getElementById(\'srn-form\').hidden=false;this.hidden=true"> Sign-in with OTP </div>',
    '<button onclick="document.getElementById(\'srn-form\').hidden=false;this.hidden=true"> LOG   IN with otp </button>',
    '<div onclick="document.getElementById(\'srn-form\').hidden=false;this.hidden=true">Login with OTP</div>',
    '<span onclick="document.getElementById(\'srn-form\').hidden=false;this.hidden=true">Login with OTP</span>',
    '<otp-login onclick="document.getElementById(\'srn-form\').hidden=false;this.hidden=true"><div><span> Login with OTP </span></div></otp-login>',
    '<a onclick="document.getElementById(\'srn-form\').hidden=false;this.hidden=true"><span>sign in with otp</span></a>',
    '<div role="link" onclick="document.getElementById(\'srn-form\').hidden=false;this.hidden=true">LOG   IN   with   otp</div>',
  ])('discovers only exact OTP login labels in custom controls: %s', async (controlMarkup) => {
    await spaFixture({ controlMarkup });
    expect(
      await new ICAITestAdapter(500).requestOtp(page, 'https://lms.icai.org/login', 'ABC1234567'),
    ).toBe('otp_required');
    expect(requests).toEqual(['/login', '/request']);
  });
  it.each([
    '<button onclick="window.clicked=true">Learn about OTP</button>',
    '<div role="button" onclick="window.clicked=true">Sign in with SSP</div>',
    '<div role="button" onclick="window.clicked=true">Login with OTP Open course</div>',
    '<span onclick="window.clicked=true">Click here for OTP help</span>',
    '<div onclick="window.clicked=true">Login</div>',
    '<button hidden onclick="window.clicked=true">Login with OTP</button>',
  ])('never clicks unrelated, generic or hidden OTP/SSP text: %s', async (markup) => {
    await spaFixture({ pageMarkup: '<h1>ICAI Digital Learning Campus</h1>' + markup });
    await expect(
      new ICAITestAdapter(300).requestOtp(page, 'https://lms.icai.org/login', 'ABC1234567'),
    ).rejects.toMatchObject({ code: 'ICAI_OTP_UI_NOT_FOUND' });
    expect(
      await page.evaluate(() => (window as unknown as { clicked?: boolean }).clicked),
    ).toBeUndefined();
    expect(requests).toEqual(['/login']);
  });
  it.each(['Generate OTP', 'Send OTP', 'Request OTP', 'Get OTP'])(
    'requests %s through exact custom text only after SRN appears, then stops at OTP_REQUIRED',
    async (label) => {
      const click = vi.spyOn(Object.getPrototypeOf(page.locator('body')), 'click');
      await spaFixture({
        controlMarkup:
          '<div onclick="window.loginClicks=(window.loginClicks||0)+1;document.getElementById(\'srn-form\').hidden=false;this.hidden=true"><span>Login with OTP</span></div>',
        requestMarkup: `<otp-request onclick="if(!document.querySelector('input[name=srn]').value)throw new Error('SRN required');document.getElementById('srn-form').requestSubmit()"><span>${label}</span></otp-request>`,
      });
      const runner = new Runner();
      await runner.start();
      expect(runner.status()).toMatchObject({
        state: 'OTP_REQUIRED',
        active: false,
        icai: { stage: 'otp_required' },
      });
      expect(click).toHaveBeenCalledTimes(2);
      for (const [options] of click.mock.calls) expect(options).toEqual({ timeout: 10_000 });
      await runner.resume();
      expect(click).toHaveBeenCalledTimes(2);
      expect(requests).toEqual(['/', '/request']);
      expect(shared.write).not.toHaveBeenCalled();
    },
  );
  it('prefers the semantic ancestor to its exact nested span', async () => {
    const prototype = Object.getPrototypeOf(page.locator('body'));
    const normalClick = prototype.click;
    const clickedTags: string[] = [];
    vi.spyOn(prototype, 'click').mockImplementation(async function (this: Locator, options) {
      clickedTags.push(await this.evaluate((element) => element.tagName));
      return normalClick.call(this, options);
    });
    await spaFixture({
      controlMarkup:
        '<button onclick="document.getElementById(\'srn-form\').hidden=false"><span>Login with OTP</span></button>',
    });
    await new ICAITestAdapter(500).requestOtp(page, 'https://lms.icai.org/login', 'ABC1234567');
    expect(clickedTags).toEqual(['BUTTON', 'BUTTON']);
  });
  it('clicks the exact login choice once and never clicks Generate OTP without a visible SRN', async () => {
    const click = vi.spyOn(Object.getPrototypeOf(page.locator('body')), 'click');
    await spaFixture({
      pageMarkup:
        '<h1>ICAI Digital Learning Campus</h1><div onclick="window.loginClicks=(window.loginClicks||0)+1">Login with OTP</div><div onclick="window.requestClicks=(window.requestClicks||0)+1">Generate OTP</div><input name="srn" hidden>',
    });
    await expect(
      new ICAITestAdapter(300).requestOtp(page, 'https://lms.icai.org/login', 'ABC1234567'),
    ).rejects.toMatchObject({ code: 'ICAI_OTP_UI_NOT_FOUND' });
    expect(click).toHaveBeenCalledExactlyOnceWith({ timeout: 10_000 });
    expect(
      await page.evaluate(() => ({
        login: (window as unknown as { loginClicks: number }).loginClicks,
        request: (window as unknown as { requestClicks?: number }).requestClicks,
      })),
    ).toEqual({ login: 1, request: undefined });
    expect(requests).toEqual(['/login']);
  }, 15_000);
  it('restored authentication goes AUTH_REQUIRED → DASHBOARD → PAUSED without course or video activity', async () => {
    await spaFixture({
      pageMarkup:
        '<h1>Dashboard</h1><a href="/logout">Log Out</a><a href="/course/lecture">Open course</a><video></video><script>window.mediaPlays=0;HTMLMediaElement.prototype.play=function(){window.mediaPlays++;return Promise.resolve()}</script>',
    });
    const runner = new Runner();
    await runner.start();
    expect(runner.status()).toMatchObject({
      state: 'PAUSED',
      active: false,
      icai: { stage: 'authenticated' },
    });
    expect(shared.log.mock.calls.map(([event]) => `${event.from}->${event.to}`).slice(-2)).toEqual([
      'AUTH_REQUIRED->DASHBOARD',
      'DASHBOARD->PAUSED',
    ]);
    await runner.resume();
    expect(requests).toEqual(['/']);
    expect(
      await page.evaluate(() => (window as unknown as { mediaPlays: number }).mediaPlays),
    ).toBe(0);
    expect(shared.write).not.toHaveBeenCalled();
  });
  it.each([
    '<input name="Search" placeholder="What do you want to learn?"><button>Previous</button><button>Next</button>',
    '<h1>Dashboard</h1><input placeholder="What do you want to learn?">',
    '<h1>Dashboard</h1><h2>Dashboard</h2><input placeholder="What do you want to learn?">',
    '<h1>Dashboard</h1><a hidden>Logout</a><input placeholder="What do you want to learn?">',
  ])(
    'public search/carousel and fewer than two distinct visible indicators fail closed: %s',
    async (pageMarkup) => {
      await spaFixture({ pageMarkup });
      await expect(
        new ICAITestAdapter(300).requestOtp(page, 'https://lms.icai.org/login', 'ABC1234567'),
      ).rejects.toMatchObject({
        code: 'ICAI_OTP_UI_NOT_FOUND',
        diagnostic: { finalPathname: '/login', httpStatus: 200 },
      });
      expect(requests).toEqual(['/login']);
    },
  );
  it('bounds and redacts diagnostics including custom interactive metadata and relevant text', async () => {
    const pageMarkup =
      '<title>Learning ABC1234567 https://example.test/?token=secret-url</title>' +
      '<p>Learning canary-browserless-secret</p><h1>ICAI Digital Learning Campus</h1><input placeholder="What do you want to learn?" value="private-input-value">' +
      '<div role="button" tabindex="0" onclick="window.clicked=true" aria-label="OTP token=secret-token" title="SRN ABC1234567">OTP help 654321</div>' +
      '<script>localStorage.setItem("private", "storage-secret")</script>' +
      Array.from(
        { length: 60 },
        (_, index) => `<button title="Learning">Learning snippet ${index}</button>`,
      ).join('') +
      '<div hidden>login hidden-secret</div>';
    vi.stubEnv('REMOTE_BROWSER_WS_URL', 'wss://browser.test/?token=canary-browserless-secret');
    await spaFixture({ pageMarkup: pageMarkup + '<p>Learning canary-browserless-secret</p>' });
    let failure: unknown;
    try {
      await new ICAITestAdapter(300).requestOtp(
        page,
        'https://lms.icai.org/login?srn=ABC1234567',
        'ABC1234567',
      );
    } catch (error) {
      failure = error;
    } finally {
      vi.unstubAllEnvs();
    }
    expect(failure).toMatchObject({
      code: 'ICAI_OTP_UI_NOT_FOUND',
      diagnostic: {
        pageTitle: 'Learning [REDACTED] [REDACTED]',
        interactiveElements: expect.arrayContaining([
          expect.objectContaining({
            tagName: 'DIV',
            role: 'button',
            ariaLabel: 'OTP [REDACTED]',
            title: 'SRN [REDACTED]',
            visibleText: 'OTP help [REDACTED]',
          }),
        ]),
      },
    });
    const diagnostic = (
      failure as { diagnostic: { relevantText: string[]; interactiveElements: unknown[] } }
    ).diagnostic;
    expect(diagnostic.relevantText.length).toBeLessThanOrEqual(40);
    expect(diagnostic.interactiveElements.length).toBeLessThanOrEqual(40);
    expect(JSON.stringify(failure)).not.toMatch(
      /ABC1234567|654321|private-input-value|storage-secret|secret-token|secret-url|hidden-secret|canary-browserless-secret|srn=/,
    );
    expect(Object.keys(diagnostic).sort()).toEqual([
      'finalPathname',
      'httpStatus',
      'interactiveElements',
      'pageTitle',
      'relevantText',
    ]);
    expect(requests).toEqual(['/login']);
  });
  it('does not leak textarea or editable values through ancestor diagnostic text', async () => {
    await spaFixture({
      pageMarkup:
        '<h1>ICAI Digital Learning Campus</h1><div role="button">OTP help<textarea>private-textarea-value</textarea><span hidden>hidden-login-value</span><span contenteditable>private-editable-value</span></div>',
    });
    let failure: unknown;
    try {
      await new ICAITestAdapter(300).requestOtp(page, 'https://lms.icai.org/login', 'ABC1234567');
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: 'ICAI_OTP_UI_NOT_FOUND' });
    expect(JSON.stringify(failure)).not.toMatch(
      /private-textarea-value|private-editable-value|hidden-login-value/,
    );
    expect(requests).toEqual(['/login']);
  });
  it('/login non-2xx falls back once to the root SPA and requests OTP normally', async () => {
    await spaFixture({ loginStatus: 404 });
    await new ICAITestAdapter().requestOtp(page, 'https://lms.icai.org/login', 'ABC1234567');
    expect(requests).toEqual(['/login', '/', '/request']);
    expect(await page.locator('input[name=otp]').isVisible()).toBe(true);
  });
  it('root SPA loads without visiting /login', async () => {
    await spaFixture();
    await new ICAITestAdapter().requestOtp(page, 'https://lms.icai.org/', 'ABC1234567');
    expect(requests).toEqual(['/', '/request']);
  });
  it('waits for delayed SPA controls rather than failing at domcontentloaded', async () => {
    await spaFixture({ delayMs: 750 });
    const started = Date.now();
    await new ICAITestAdapter().requestOtp(page, 'https://lms.icai.org/', 'ABC1234567');
    expect(Date.now() - started).toBeGreaterThanOrEqual(700);
    expect(requests).toEqual(['/', '/request']);
  });
  it('/login without application content falls back once to a rendered root', async () => {
    await spaFixture({ loginEmpty: true });
    await new ICAITestAdapter(500).requestOtp(page, 'https://lms.icai.org/login', 'ABC1234567');
    expect(requests).toEqual(['/login', '/', '/request']);
  });
  it('failed HTTP fallback never loops and exposes only sanitized final diagnostics', async () => {
    await spaFixture({ loginStatus: 404, rootStatus: 503 });
    let failure: unknown;
    try {
      await new ICAITestAdapter().requestOtp(
        page,
        'https://lms.icai.org/login?srn=ABC1234567',
        'ABC1234567',
      );
    } catch (error) {
      failure = error;
    }
    expect(requests).toEqual(['/login', '/']);
    expect(failure).toMatchObject({
      code: 'ICAI_LOGIN_HTTP_ERROR',
      diagnostic: {
        finalPathname: '/',
        httpStatus: 503,
        interactiveElements: [{ tagName: 'BUTTON', visibleText: 'Help [REDACTED]' }],
      },
    });
    expect(JSON.stringify(failure)).not.toMatch(/ABC1234567|654321|srn=/);
  });
  it('unrendered fallback stops with APP_NOT_RENDERED and never loops', async () => {
    await spaFixture({ loginEmpty: true, rootEmpty: true });
    await expect(
      new ICAITestAdapter(500).requestOtp(page, 'https://lms.icai.org/login', 'ABC1234567'),
    ).rejects.toMatchObject({
      code: 'ICAI_LOGIN_APP_NOT_RENDERED',
      diagnostic: { finalPathname: '/', httpStatus: 200 },
    });
    expect(requests).toEqual(['/login', '/']);
  });
  it('a cross-origin /login redirect fails without falling back or reaching that origin', async () => {
    await spaFixture({ escape: true });
    await expect(
      new ICAITestAdapter().requestOtp(page, 'https://lms.icai.org/login', 'ABC1234567'),
    ).rejects.toMatchObject({ code: 'ICAI_LOGIN_PAGE_UNAVAILABLE' });
    expect(requests).toEqual(['/login']);
  });
  it('requires Basic Auth, validates OTP, and stops authenticated login before any lecture or media', async () => {
    await fixture('/login');
    const runner = new Runner();
    await runner.start();
    expect(runner.status().state).toBe('OTP_REQUIRED');
    let server: Server | undefined;
    try {
      server = createApp(runner).listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server!.on('listening', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('No test port');
      const post = (body: unknown, auth = credentials) =>
        fetch(`http://127.0.0.1:${address.port}/api/icai/otp`, {
          method: 'POST',
          headers: { authorization: auth, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
      expect((await post({ otp: '654321' }, '')).status).toBe(401);
      expect((await post({ otp: 'bad' })).status).toBe(400);
      const malformed = await fetch(`http://127.0.0.1:${address.port}/api/icai/otp`, {
        method: 'POST',
        headers: { authorization: credentials, 'content-type': 'application/json' },
        body: '{"otp":654321bad}',
      });
      expect(malformed.status).toBe(400);
      expect(await malformed.text()).not.toContain('654321');
      expect((await post({ otp: 654321 })).status).toBe(400);
      expect(runner.status().state).toBe('OTP_REQUIRED');
      const response = await post({ otp: '654321' });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      const result = await response.json();
      expect(result).toMatchObject({
        ok: true,
        status: {
          state: 'PAUSED',
          active: false,
          icai: { stage: 'authenticated', srnConfigured: true },
        },
      });
      expect(JSON.stringify(result)).not.toMatch(/ABC1234567|654321/);
      expect(JSON.stringify(shared.log.mock.calls)).not.toMatch(/ABC1234567|654321/);
      expect(shared.write).not.toHaveBeenCalled();
      expect(requests).toEqual(['/', '/request', '/verify']);
      expect(
        await page.evaluate(() => (window as unknown as { mediaPlays: number }).mediaPlays),
      ).toBe(0);
      await expect(runner.confirm('b')).rejects.toMatchObject({ code: 'QUESTION_FLOW_DISABLED' });
      await runner.resume();
      expect(requests).toEqual(['/', '/request', '/verify']);
    } finally {
      if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
  });
  it('maps actual rejected OTP to one terminal error and clears the browser input', async () => {
    await fixture('/login');
    const runner = new Runner();
    await runner.start();
    await runner.submitIcaiOtp('111111');
    expect(runner.status()).toMatchObject({
      state: 'ERROR',
      active: false,
      errorCode: 'ICAI_OTP_REJECTED',
    });
    expect(await page.locator('input[name=otp]').inputValue()).toBe('');
    await runner.resume();
    expect(requests).toEqual(['/', '/request', '/verify']);
    const errors = shared.log.mock.calls.filter(([event]) => event.to === 'ERROR');
    expect(errors).toHaveLength(1);
    expect(JSON.stringify([runner.status(), shared.log.mock.calls])).not.toMatch(
      /ABC1234567|111111/,
    );
  });
  it('diagnoses missing selectors without values, SRN, OTP, or browser storage', async () => {
    await fixture('/missing');
    const adapter = new ICAITestAdapter(500);
    let diagnostic: unknown;
    try {
      await adapter.requestOtp(page, 'https://lms.icai.org/missing', 'ABC1234567');
    } catch (error) {
      diagnostic = error;
    }
    expect(diagnostic).toMatchObject({
      code: 'ICAI_OTP_UI_NOT_FOUND',
      diagnostic: { finalPathname: '/missing', httpStatus: 200, pageTitle: '' },
    });
    expect(JSON.stringify(diagnostic)).not.toMatch(
      /ABC1234567|654321|private-value|browser-token-secret/,
    );
  });
  it('blocks cross-origin redirects before reaching the destination', async () => {
    await fixture('/login');
    const adapter = new ICAITestAdapter();
    await expect(
      adapter.requestOtp(page, 'https://lms.icai.org/escape', 'ABC1234567'),
    ).rejects.toMatchObject({ code: 'ICAI_LOGIN_PAGE_UNAVAILABLE' });
    expect(requests).not.toContain('/login');
  });
});
