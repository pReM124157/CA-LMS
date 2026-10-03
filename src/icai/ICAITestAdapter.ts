import type { Locator, Page, Route } from 'playwright';
import { env } from '../config/env.js';

export const ICAI_ORIGIN = 'https://lms.icai.org';
export type ICAIErrorCode =
  | 'ICAI_LOGIN_PAGE_UNAVAILABLE'
  | 'ICAI_LOGIN_HTTP_ERROR'
  | 'ICAI_LOGIN_APP_NOT_RENDERED'
  | 'ICAI_OTP_UI_NOT_FOUND'
  | 'ICAI_OTP_REQUEST_FAILED'
  | 'ICAI_OTP_INPUT_NOT_FOUND'
  | 'ICAI_OTP_REJECTED'
  | 'ICAI_LOGIN_NOT_CONFIRMED';
export type LoginDiagnostics = {
  finalPathname: string;
  httpStatus?: number;
  pageTitle: string;
  relevantText: string[];
  inputs: {
    type: string;
    name: string;
    id: string;
    placeholder: string;
    ariaLabel: string;
    autocomplete: string;
    labelText: string;
  }[];
  interactiveElements: {
    tagName: string;
    role: string;
    ariaLabel: string;
    title: string;
    visibleText: string;
  }[];
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
  constructor(
    private readonly spaReadyTimeoutMs = 15_000,
    private readonly targetMode = env.TARGET_MODE,
  ) {}
  private entryStatus?: number;
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
  private async srn(page: Page, otpModeSelected = false): Promise<Locator | undefined> {
    const inputs = page.locator('input');
    const index = await inputs.evaluateAll((nodes, allowFallback) => {
      // Fail closed rather than claiming uniqueness from a truncated input list.
      if (nodes.length > 200) return -1;
      const visible = (node: Element): boolean => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.visibility !== 'collapse' &&
          style.display !== 'none'
        );
      };
      const normalize = (text: string): string =>
        text
          .replace(/([a-z])([A-Z])/g, '$1 $2')
          .replace(/[^a-z0-9]+/gi, ' ')
          .trim();
      const labels = (input: HTMLInputElement): string =>
        Array.from(input.labels ?? [])
          .filter(visible)
          .map((label) => {
            const walker = document.createTreeWalker(label, NodeFilter.SHOW_TEXT);
            const parts: string[] = [];
            while (walker.nextNode()) {
              const parent = walker.currentNode.parentElement;
              if (
                parent &&
                visible(parent) &&
                !parent.closest('input, textarea, select, [contenteditable]')
              )
                parts.push(walker.currentNode.textContent ?? '');
            }
            return parts.join(' ');
          })
          .join(' ');
      const candidates = nodes.flatMap((node, index) => {
        const input = node as HTMLInputElement;
        if (
          !visible(input) ||
          !['text', 'email', 'tel'].includes(input.type) ||
          input.matches(':disabled') ||
          input.readOnly ||
          input.closest('[role="search"]')
        )
          return [];
        const metadata = [
          labels(input),
          input.getAttribute('aria-label') ?? '',
          input.placeholder,
          input.name,
          input.id,
        ].map(normalize);
        const evidence = [...metadata, input.autocomplete, input.getAttribute('role') ?? ''].join(
          ' ',
        );
        if (/otp|one[ -]?time|verification\s+code|search|what do you want to learn/i.test(evidence))
          return [];
        return [{ index, metadata, form: input.closest('form, [role="form"]') }];
      });
      const srn =
        /\bsrn\b|\b(?:student\s+)?registration(?:\s+(?:number|no))?\b|\buser(?:\s*name|\s*id)\b/i;
      // Rank metadata sources globally, rather than taking the first matching DOM node.
      for (let priority = 0; priority < 5; priority++) {
        const match = candidates.find((candidate) => srn.test(candidate.metadata[priority] ?? ''));
        if (match) return match.index;
      }
      if (!allowFallback) return -1;
      const forms = Array.from(document.querySelectorAll('form, [role="form"]')).filter(visible);
      if (forms.length !== 1) return -1;
      const inForm = candidates.filter((candidate) => candidate.form === forms[0]);
      return inForm.length === 1 ? inForm[0]!.index : -1;
    }, otpModeSelected);
    return index >= 0 ? inputs.nth(index) : undefined;
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
  private loginControl(page: Page): Promise<Locator | undefined> {
    return this.exactOtpControl(page, /^\s*(?:login|log\s+in|sign\s+in|sign-in)\s+with\s+otp\s*$/i);
  }
  private requestControl(page: Page): Promise<Locator | undefined> {
    return this.exactOtpControl(page, /^\s*(?:generate|send|request|get)\s+otp\s*$/i);
  }
  private async otpLoginSubmit(srnInput: Locator): Promise<Locator | undefined> {
    // Restrict generic login labels to the identified SRN form, never page-wide.
    const form = srnInput.locator('xpath=ancestor::*[self::form or @role="form"][1]');
    if (!(await form.count()) || !(await form.isVisible())) return undefined;
    // Even a hidden password field makes this unsuitable for the OTP fallback.
    if (await form.locator('input[type="password"]').count()) return undefined;
    const label = /^\s*(?:login|log\s+in|sign\s+in)\s*$/i;
    const button = await this.visible([form.locator('button').filter({ hasText: label })]);
    if (button) return button;
    const submits = form.locator('input[type="submit"]');
    for (let index = 0; index < Math.min(await submits.count(), 30); index++) {
      const submit = submits.nth(index);
      // Value is read solely to select this explicit submit control; never returned/logged.
      if (
        (await submit.isVisible()) &&
        (await submit.evaluate(
          (element, source) =>
            new RegExp(source, 'i').test(
              (element as HTMLInputElement).value.replace(/\s+/g, ' ').trim(),
            ),
          label.source,
        ))
      )
        return submit;
    }
    const roleButton = await this.visible([
      form.locator('[role="button"]').and(form.getByRole('button', { name: label })),
    ]);
    return roleButton ?? this.exactOtpControl(form, label);
  }
  private async exactOtpControl(page: Page | Locator, label: RegExp): Promise<Locator | undefined> {
    // These allowlisted labels alone authorize the custom-element fallback.
    // Prefer semantic controls across all candidates before returning exact text.
    const matches = page.getByText(label);
    let fallback: Locator | undefined;
    for (let index = 0; index < Math.min(await matches.count(), 40); index++) {
      let node = matches.nth(index);
      if (!(await node.isVisible())) continue;
      const exact = await node.evaluate((element, source) => {
        const text = (element as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() ?? '';
        return new RegExp(source, 'i').test(text);
      }, label.source);
      if (!exact) continue;
      fallback ??= node;
      for (let depth = 0; depth <= 4; depth++) {
        const allowed = await node.evaluate((element, source) => {
          const text = (element as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() ?? '';
          return (
            new RegExp(source, 'i').test(text) &&
            element.matches('button, a, [role="button"], [role="link"], [tabindex="0"]')
          );
        }, label.source);
        if (allowed && (await node.isVisible())) return node;
        node = node.locator('xpath=..');
        if (!(await node.count())) break;
      }
    }
    return fallback;
  }
  async authenticated(page: Page): Promise<boolean> {
    this.assertOrigin(page, 'ICAI_LOGIN_NOT_CONFIRMED');
    const indicators = [
      /^self[-\s]paced online module[s]?$/i,
      /^my learning history$/i,
      /^dashboard$/i,
      /^my courses$/i,
      /^(?:log ?out|sign out)$/i,
    ];
    let count = 0;
    for (const indicator of indicators) {
      if (await this.visible([page.getByText(indicator)])) count++;
    }
    // The pair counts as one independent indicator, never two by itself.
    if (
      (await this.visible([page.getByText(/^set a$/i)])) &&
      (await this.visible([page.getByText(/^set b$/i)]))
    )
      count++;
    return count >= 2;
  }
  async diagnostics(page: Page, secrets: string[]): Promise<LoginDiagnostics> {
    const raw = await page.evaluate(() => {
      const visible = (node: Element): boolean => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          style.visibility !== 'collapse' &&
          style.display !== 'none' &&
          style.opacity !== '0'
        );
      };
      // Exclude form/control content even when an interactive ancestor wraps it.
      const text = (node: Element): string => {
        if (node.closest('input, textarea, select, script, style, [contenteditable]')) return '';
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        const parts: string[] = [];
        let count = 0;
        while (walker.nextNode() && count++ < 200) {
          const parent = walker.currentNode.parentElement;
          if (
            parent &&
            visible(parent) &&
            !parent.closest('input, textarea, select, script, style, [contenteditable]')
          )
            parts.push(walker.currentNode.textContent ?? '');
        }
        return parts.join(' ').replace(/\s+/g, ' ').trim();
      };
      const relevant =
        /login|log in|sign[ -]in|otp|ssp|dashboard|self[- ]paced|learning|courses|logout/i;
      const snippets = new Set<string>();
      for (const node of Array.from(document.querySelectorAll('body *')).slice(0, 5000)) {
        if (!visible(node) || node.matches('script, style, input, textarea, select')) continue;
        const value = text(node);
        if (
          relevant.test(value) &&
          !Array.from(node.children).some((child) => visible(child) && relevant.test(text(child)))
        )
          snippets.add(value.slice(0, 320));
        if (snippets.size >= 40) break;
      }
      return {
        pageTitle: document.title.slice(0, 320),
        relevantText: [...snippets],
        inputs: Array.from(document.querySelectorAll('input'))
          .filter(visible)
          .slice(0, 20)
          .map((input) => ({
            type: input.type,
            name: input.name.slice(0, 320),
            id: input.id.slice(0, 320),
            placeholder: input.placeholder.slice(0, 320),
            ariaLabel: (input.getAttribute('aria-label') ?? '').slice(0, 320),
            autocomplete: input.autocomplete.slice(0, 320),
            labelText: Array.from(input.labels ?? [])
              .filter(visible)
              .map(text)
              .join(' ')
              .slice(0, 320),
          })),
        interactiveElements: Array.from(
          document.querySelectorAll('button, a, [role], [tabindex], [onclick]'),
        )
          .filter(visible)
          .slice(0, 40)
          .map((node) => ({
            tagName: node.tagName,
            role: node.getAttribute('role') ?? '',
            ariaLabel: (node.getAttribute('aria-label') ?? '').slice(0, 320),
            title: (node.getAttribute('title') ?? '').slice(0, 320),
            visibleText: node.matches('input, textarea, select') ? '' : text(node).slice(0, 320),
          })),
      };
    });
    const configuredSecrets = Object.entries(process.env)
      .filter(([key]) => /SRN|OTP|TOKEN|SECRET|PASSWORD|API_KEY|AUTHORIZATION/i.test(key))
      .map(([, value]) => value ?? '');
    // Browserless credentials may be embedded in the configured WebSocket URL.
    // Read only configuration here, never cookies, storage, headers or input values.
    try {
      const remote = new URL(process.env.REMOTE_BROWSER_WS_URL ?? '');
      configuredSecrets.push(remote.username, remote.password);
      for (const [key, value] of remote.searchParams)
        if (/token|secret|password|key|auth/i.test(key)) configuredSecrets.push(value);
    } catch {
      /* No configured remote endpoint. */
    }
    const clean = (text: string): string => {
      let value = text;
      for (const secret of [...secrets, ...configuredSecrets])
        if (secret) value = value.split(secret).join('[REDACTED]');
      return value
        .replace(/https?:\/\/\S+|\b[A-Za-z]{3}\d{7}\b|\b\d{4,}\b/gi, '[REDACTED]')
        .replace(
          /\b(?:token|secret|password|authorization|cookie|srn|otp)\s*[=:]\s*\S+/gi,
          '[REDACTED]',
        )
        .replace(/\S*\?\S+/g, '[REDACTED]')
        .slice(0, 160);
    };
    return {
      finalPathname: clean(new URL(page.url()).pathname),
      ...(this.entryStatus !== undefined ? { httpStatus: this.entryStatus } : {}),
      pageTitle: clean(raw.pageTitle),
      relevantText: raw.relevantText.map(clean),
      inputs: raw.inputs.map((input) => ({
        type: clean(input.type),
        name: clean(input.name),
        id: clean(input.id),
        placeholder: clean(input.placeholder),
        ariaLabel: clean(input.ariaLabel),
        autocomplete: clean(input.autocomplete),
        labelText: clean(input.labelText),
      })),
      interactiveElements: raw.interactiveElements.map((node) => ({
        tagName: clean(node.tagName),
        role: clean(node.role),
        ariaLabel: clean(node.ariaLabel),
        title: clean(node.title),
        visibleText: clean(node.visibleText),
      })),
    };
  }
  private async missing(page: Page, code: ICAIErrorCode, secrets: string[]): Promise<never> {
    this.assertOrigin(page, code);
    throw new ICAILoginError(code, await this.diagnostics(page, secrets).catch(() => undefined));
  }
  private async waitForApp(page: Page): Promise<boolean> {
    const deadline = Date.now() + this.spaReadyTimeoutMs;
    do {
      this.assertOrigin(page, 'ICAI_LOGIN_PAGE_UNAVAILABLE');
      if (
        (await this.srn(page)) ||
        (await this.authenticated(page)) ||
        (await this.loginControl(page)) ||
        (await this.visible([
          page.getByText(
            /(?:login|log\s+in|sign(?:\s+|-)in)\s+with\s+(?:otp|ssp)|(?:ICAI\s+)?digital learning campus/i,
          ),
          page.getByPlaceholder('What do you want to learn?'),
        ]))
      )
        return true;
      await page.waitForTimeout(250);
    } while (Date.now() < deadline);
    return false;
  }
  private async openEntry(page: Page, url: string, srn: string): Promise<void> {
    this.entryStatus = undefined;
    try {
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20_000 });
      this.assertOrigin(page, 'ICAI_LOGIN_PAGE_UNAVAILABLE');
      this.entryStatus = response?.status();
      if (response && !response.ok()) return this.missing(page, 'ICAI_LOGIN_HTTP_ERROR', [srn]);
      if (!(await this.waitForApp(page)))
        return this.missing(page, 'ICAI_LOGIN_APP_NOT_RENDERED', [srn]);
    } catch (error) {
      if (error instanceof ICAILoginError) throw error;
      throw new ICAILoginError('ICAI_LOGIN_PAGE_UNAVAILABLE');
    }
  }
  async requestOtp(
    page: Page,
    loginUrl: string,
    srn: string,
  ): Promise<'authenticated' | 'otp_required'> {
    try {
      const entry = new URL(loginUrl);
      if (entry.origin !== ICAI_ORIGIN || entry.username || entry.password)
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
      try {
        await this.openEntry(page, loginUrl, srn);
      } catch (error) {
        if (
          !this.escaped &&
          entry.pathname.replace(/\/$/, '') === '/login' &&
          error instanceof ICAILoginError &&
          (error.code === 'ICAI_LOGIN_HTTP_ERROR' || error.code === 'ICAI_LOGIN_APP_NOT_RENDERED')
        ) {
          // One explicit retry at the canonical root; no recursive fallback.
          await this.openEntry(page, `${ICAI_ORIGIN}/`, srn);
        } else throw error;
      }
    } catch (error) {
      if (error instanceof ICAILoginError) throw error;
      throw new ICAILoginError('ICAI_LOGIN_PAGE_UNAVAILABLE');
    }
    try {
      let srnInput: Locator | undefined;
      let switchControl: Locator | undefined;
      let otpModeSelected = false;
      const controlsDeadline = Date.now() + this.spaReadyTimeoutMs;
      do {
        this.assertOrigin(page, 'ICAI_OTP_REQUEST_FAILED');
        if (await this.authenticated(page)) return 'authenticated';
        switchControl = await this.loginControl(page);
        srnInput = await this.srn(page);
        if (switchControl || srnInput) break;
        await page.waitForTimeout(250);
      } while (Date.now() < controlsDeadline);
      if (switchControl) {
        await switchControl.click({ timeout });
        otpModeSelected = true;
        this.assertOrigin(page, 'ICAI_OTP_REQUEST_FAILED');
        const deadline = Date.now() + timeout;
        do {
          this.assertOrigin(page, 'ICAI_OTP_REQUEST_FAILED');
          srnInput = await this.srn(page, true);
          if (srnInput) break;
          await page.waitForTimeout(200);
        } while (Date.now() < deadline);
      }
      if (!srnInput) {
        if (await this.authenticated(page)) return 'authenticated';
        return this.missing(page, 'ICAI_OTP_UI_NOT_FOUND', [srn]);
      }
      await srnInput.fill(srn, { timeout });
      let request: Locator | undefined;
      let loginSubmitSelected = false;
      const requestDeadline = Date.now() + timeout;
      do {
        this.assertOrigin(page, 'ICAI_OTP_REQUEST_FAILED');
        if (await this.otp(page)) return 'otp_required';
        request = undefined;
        if (otpModeSelected && this.targetMode === 'icai_test')
          request = await this.otpLoginSubmit(srnInput);
        loginSubmitSelected = Boolean(request);
        if (!request) request = await this.requestControl(page);
        if (request) break;
        await page.waitForTimeout(200);
      } while (Date.now() < requestDeadline);
      if (!request) {
        if (await this.authenticated(page)) return 'authenticated';
        return this.missing(page, 'ICAI_OTP_UI_NOT_FOUND', [srn]);
      }
      this.assertOrigin(page, 'ICAI_OTP_REQUEST_FAILED');
      if (await this.otp(page)) return 'otp_required';
      await request.click({ timeout });
      return await this.waitForRequestedOtp(page, srn, loginSubmitSelected);
    } catch (error) {
      if (error instanceof ICAILoginError) throw error;
      throw new ICAILoginError('ICAI_OTP_REQUEST_FAILED');
    }
  }
  private async waitForRequestedOtp(
    page: Page,
    srn: string,
    afterLogin: boolean,
  ): Promise<'otp_required'> {
    let secondRequestAllowed = afterLogin;
    let deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      this.assertOrigin(page, 'ICAI_OTP_REQUEST_FAILED');
      const invalidSrn = await this.visible([
        page.getByText(
          /(?:invalid|incorrect)\s+(?:srn|(?:student\s+)?registration(?:\s+(?:number|no))?)|(?:srn|registration\s+(?:number|no)|user)\s+(?:is\s+)?(?:not found|invalid)/i,
        ),
      ]);
      if (invalidSrn) return this.missing(page, 'ICAI_OTP_REQUEST_FAILED', [srn]);
      if (await this.otp(page)) return 'otp_required';
      if (secondRequestAllowed) {
        const generate = await this.requestControl(page);
        if (generate) {
          this.assertOrigin(page, 'ICAI_OTP_REQUEST_FAILED');
          if (await this.otp(page)) return 'otp_required';
          // Only one second-stage request is allowed. LOGIN is never searched here.
          secondRequestAllowed = false;
          await generate.click({ timeout });
          deadline = Date.now() + 20_000;
          continue;
        }
      }
      await page.waitForTimeout(200);
    }
    return this.missing(page, 'ICAI_OTP_INPUT_NOT_FOUND', [srn]);
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
