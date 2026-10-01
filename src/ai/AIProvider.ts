import { z } from 'zod';
import type { Question, Recommendation } from '../questions/types.js';
export const answerSchema = z.object({ answerOptionId: z.string().min(1), answerText: z.string(), confidence: z.number().min(0).max(1), reasoning: z.string() });
export interface AIProvider { providerName(): string; healthCheck(): Promise<boolean>; solveQuestion(question: Question): Promise<Recommendation>; }
export class DeterministicProvider implements AIProvider {
  providerName(): string { return 'deterministic-local'; }
  async healthCheck(): Promise<boolean> { return true; }
  async solveQuestion(question: Question): Promise<Recommendation> { const answer = question.options[0]; if (!answer) throw new Error('Question has no options'); return { provider: this.providerName(), answerOptionId: answer.id, answerText: answer.text, confidence: 0.2, reasoning: 'No configured AI provider; first option is a test-only recommendation.', usedSearch: false, latencyMs: 0 }; }
}
