export interface Option { id: string; text: string }
export interface Question { id: string; text: string; options: Option[]; url: string }
export interface Recommendation { provider: string; answerOptionId: string; answerText: string; confidence: number; reasoning: string; usedSearch: boolean; latencyMs: number }
