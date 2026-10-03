import type { Locator, Page, Route } from 'playwright';

export const ICAI_ORIGIN = 'https://lms.icai.org';
export type ICAIErrorCode =
  | 'ICAI_LOGIN_PAGE_UNAVAILABLE'
  | 'ICAI_OTP_UI_NOT_FOUND'
  | 'ICAI_OTP_REQUEST_FAILED'
  | 'ICAI_OTP_INPUT_NOT_FOUND'
  | 'ICAI_OTP_REJECTED'
  | 'ICAI_LOGIN_NOT_CONFIRMED';
export type LoginDiagnostics = {
  inputs: { type: string; name: string; id: string; placeholder: string; labels: string[] }[];
  controls: string[];
};
export class ICAILoginError extends Error {
  constructor(
    public readonly code: ICAIErrorCode,
    public readonly diagnostic?: LoginDiagnostics,
  ) {
    super(code);
  }
}
export const validOtp = (otp: unknown): otp is string =>
  typeof otp === 'string' && /^\d{4,8}$/.test(otp);
const timeout = 10_000;

export class ICAITestAdapter {
  private guarded?: Page;
  private escaped = false;
  private readonly guardRoute = async (route: Route): Promise<void> => {
    if (
      route.request().isNavigationRequest() &&
      new URL(route.request().url()).origin !== ICAI_ORIGIN
    ) {
      this.escaped = true;
      await route.abort();
    } else await route.fallback();
  };
  assertOrigin(page: Page, code: ICAIErrorCode): void {
    if (this.escaped || new URL(page.url()).origin !== ICAI_ORIGIN) throw new ICAILoginError(code);
  }
  private async visible(candidates: Locator[]): Promise<Locator | undefined> {
    for (const candidate of candidates) {
      const count = Math.min(await candidate.count(), 30);
      for (let index = 0; index < count; index++) {
        const item = candidate.nth(index);
        if (await item.isVisible()) return item;
      }
    }
    return undefined;
  }
  private srn(page: Page): Promise<Locator | undefined> {
    const name = /\bsrn\b|student registration (number|no)/i;
    return this.visible([
      page.getByRole('textbox', { name }),
      page.getByLabel(name),
      page.getByPlaceholder(name),
      page.locator('input[name*="srn" i], input[id*="srn" i]'),
    ]);
  }
  private otp(page: Page): Promise<Locator | undefined> {
    const name = /\botp\b|one[ -]?time (password|code)|verification code/i;
    return this.visible([
      page.getByRole('textbox', { name }),
      page.getByLabel(name),
      page.getByPlaceholder(name),
      page.locator('input[autocomplete="one-time-code"], input[name*="otp" i], input[id*="otp" i]'),
    ]);
  }
  private control(page: Page, name: RegExp): Promise<Locator | undefined> {
    return this.visible([page.getByRole('button', { name }), page.getByRole('link', { name })]);
  }
  async diagnostics(page: Page, secrets: string[]): Promise<LoginDiagnostics> {
    const raw = await page.evaluate(() => ({
      inputs: Array.from(document.querySelectorAll('input'))
        .slice(0, 30)
        .map((input) => ({
          type: input.type,
          name: input.name,
          id: input.id,
          placeholder: input.placeholder,
          labels: Array.from(input.labels ?? []).map((label) =>
            (label.textContent ?? '').slice(0, 160),
          ),
        })),
      controls: Array.from(document.querySelectorAll('button, a, input[type="submit"]'))
        .filter((node) => (node as HTMLElement).getBoundingClientRect().width > 0)
        .slice(0, 30)
        .map((node) => (node.textContent ?? node.getAttribute('aria-label') ?? '').slice(0, 160)),
    }));
    const clean = (text: string): string => {
      let value = text;
      for (const secret of secrets) if (secret) value = value.split(secret).join('[REDACTED]');
      return value
        .replace(/https?:\/\/\S+|\b[A-Za-z]{3}\d{7}\b|\b\d{4,}\b/g, '[REDACTED]')
        .slice(0, 160);
    };
    return {
      inputs: raw.inputs.map((input) => ({
        type: clean(input.type),
        name: clean(input.name),
        id: clean(input.id),
        placeholder: clean(input.placeholder),
        labels: input.labels.map(clean),
      })),
      controls: raw.controls.map(clean),
    };
  }
  private async missing(page: Page, code: ICAIErrorCode, secrets: string[]): Promise<never> {
    this.assertOrigin(page, code);
    throw new ICAILoginError(code, await this.diagnostics(page, secrets).catch(() => undefined));
  }
  async requestOtp(page: Page, loginUrl: string, srn: string): Promise<void> {
    try {
      if (new URL(loginUrl).origin !== ICAI_ORIGIN)
        throw new ICAILoginError('ICAI_LOGIN_PAGE_UNAVAILABLE');
      if (this.guarded !== page) {
        // Context routing also guards the first navigation of any popup.
        await page.context().route('**/*', this.guardRoute);
        this.guarded = page;
        page.on('popup', (popup) => {
          void popup.close().catch(() => undefined);
        });
      }
      this.escaped = false;
      const response = await page.goto(loginUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000,
      });
      this.assertOrigin(page, 'ICAI_LOGIN_PAGE_UNAVAILABLE');
      if (response && !response.ok()) throw new ICAILoginError('ICAI_LOGIN_PAGE_UNAVAILABLE');
    } catch {
      throw new ICAILoginError('ICAI_LOGIN_PAGE_UNAVAILABLE');
    }
    try {
      let srnInput = await this.srn(page);
      const switchControl = await this.control(page, /^(login|sign in) (with|via) otp$/i);
      if (!srnInput && switchControl) {
        await switchControl.click({ timeout });
        this.assertOrigin(page, 'ICAI_OTP_REQUEST_FAILED');
        const deadline = Date.now() + timeout;
        do {
          this.assertOrigin(page, 'ICAI_OTP_REQUEST_FAILED');
          srnInput = await this.srn(page);
          if (srnInput) break;
          await page.waitForTimeout(200);
        } while (Date.now() < deadline);
      }
      if (!srnInput) return this.missing(page, 'ICAI_OTP_UI_NOT_FOUND', [srn]);
      await srnInput.fill(srn, { timeout });
      const request = await this.control(
        page,
        /^(request|send|generate|get) (an? )?otp$|^(login|sign in) (with|via) otp$/i,
      );
      if (!request) return this.missing(page, 'ICAI_OTP_UI_NOT_FOUND', [srn]);
      this.assertOrigin(page, 'ICAI_OTP_REQUEST_FAILED');
      const requestName =
        (await request.textContent()) ?? (await request.getAttribute('aria-label')) ?? '';
      let requestSent = !/^(login|sign in) (with|via) otp$/i.test(requestName.trim());
      await request.click({ timeout });
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        this.assertOrigin(page, 'ICAI_OTP_REQUEST_FAILED');
        if (await this.otp(page)) return;
        if (!requestSent) {
          const send = await this.control(page, /^(request|send|generate|get) (an? )?otp$/i);
          if (send) {
            const currentSrn = await this.srn(page);
            if (currentSrn) await currentSrn.fill(srn, { timeout });
            await send.click({ timeout });
            requestSent = true;
          }
        }
        await page.waitForTimeout(200);
      }
      return this.missing(page, 'ICAI_OTP_INPUT_NOT_FOUND', [srn]);
    } catch (error) {
      if (error instanceof ICAILoginError) throw error;
      throw new ICAILoginError('ICAI_OTP_REQUEST_FAILED');
    }
  }
  async submitOtp(page: Page, otp: string, srn: string): Promise<void> {
    let input: Locator | undefined;
    try {
      this.assertOrigin(page, 'ICAI_LOGIN_NOT_CONFIRMED');
      input = await this.otp(page);
      if (!input) return this.missing(page, 'ICAI_OTP_INPUT_NOT_FOUND', [srn, otp]);
      const submit = await this.control(page, /^(verify( otp)?|login|log in|sign in|submit)$/i);
      if (!submit) return this.missing(page, 'ICAI_OTP_UI_NOT_FOUND', [srn, otp]);
      await input.fill(otp, { timeout });
      this.assertOrigin(page, 'ICAI_LOGIN_NOT_CONFIRMED');
      await submit.click({ timeout });
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        this.assertOrigin(page, 'ICAI_LOGIN_NOT_CONFIRMED');
        const rejected = await this.visible([
          page.getByText(
            /(invalid|incorrect|expired|rejected)\s+(otp|one[ -]?time)|otp\s+(is\s+)?(invalid|incorrect|expired)/i,
          ),
        ]);
        if (rejected) throw new ICAILoginError('ICAI_OTP_REJECTED');
        const dashboard = await this.visible([
          page.getByRole('heading', {
            name: /dashboard|digital learning campus|my (courses|learning)/i,
          }),
          page.getByRole('navigation', { name: /dashboard/i }),
        ]);
        const authenticated = await this.control(page, /^(log ?out|sign out)$/i);
        if (dashboard && authenticated && !(await this.otp(page))) return;
        await page.waitForTimeout(200);
      }
      throw new ICAILoginError('ICAI_LOGIN_NOT_CONFIRMED');
    } catch (error) {
      if (error instanceof ICAILoginError) throw error;
      throw new ICAILoginError('ICAI_LOGIN_NOT_CONFIRMED');
    } finally {
      if (!this.escaped && new URL(page.url()).origin === ICAI_ORIGIN) {
        const remaining = await this.otp(page).catch(() => undefined);
        await remaining?.fill('', { timeout: 1000 }).catch(() => undefined);
      }
    }
  }
}
