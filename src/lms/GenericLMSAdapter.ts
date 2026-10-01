import type { Page } from 'playwright';
import { parseQuestion } from '../questions/questionParser.js';
import type { Question } from '../questions/types.js';
export interface Course { id: string; title: string; url: string }
export interface Lesson extends Course { completed: boolean }
export class GenericLMSAdapter {
  async courses(page: Page): Promise<Course[]> { return page.locator('[data-course]').evaluateAll((nodes) => nodes.map((node) => ({ id: node.getAttribute('data-course') ?? '', title: (node.textContent ?? '').trim(), url: (node as HTMLAnchorElement).href }))); }
  async lessons(page: Page): Promise<Lesson[]> { return page.locator('[data-lesson]').evaluateAll((nodes) => nodes.map((node) => ({ id: node.getAttribute('data-lesson') ?? '', title: (node.textContent ?? '').trim(), url: (node as HTMLAnchorElement).href, completed: node.getAttribute('data-completed') === 'true' }))); }
  async question(page: Page): Promise<Question | null> { for (const frame of page.frames()) { const question = await parseQuestion(frame); if (question) return question; } return null; }
  async player(page: Page): Promise<boolean> { return page.locator('video').count().then(Boolean); }
}
