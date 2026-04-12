/**
 * Hybrid Memory System — Type definitions
 */

export interface MemoryRecord {
  id: string;          // UUID
  chat_id: string;
  key: string;
  value: string;
  memory_type: string; // user | feedback | project | reference | general
  source: string;      // explicit | extracted | vector
  updated_at: string;
}

export interface EmbeddingFunction {
  embed(texts: string[]): Promise<number[][]>;
  readonly dimensions: number;
}

export interface SemanticSearchResult {
  key: string;
  value: string;
  chat_id: string;
  memory_type: string;
  score: number;       // similarity score 0-1
}
