import type { Frame } from 'playwright';
import type { Question } from './types.js';
export async function parseQuestion(frame: Frame): Promise<Question | null> {
  const dialog = frame.locator('[data-question], [role="dialog"]:has(input[type="radio"])').first();
  if (!(await dialog.count()) || !(await dialog.isVisible())) return null;
  const text = (await dialog.locator('[data-question-text], h1, h2, h3, p').first().textContent())?.trim() ?? '';
  const options = await dialog.locator('label').evaluateAll((labels) => labels.map((label) => { const input = label.querySelector('input'); return { id: input?.value ?? input?.id ?? '', text: (label.textContent ?? '').trim() }; }).filter((option) => option.id && option.text));
  return text && options.length ? { id: await dialog.getAttribute('data-question') ?? crypto.randomUUID(), text, options, url: frame.url() } : null;
}
