/**
 * Embedding functions for semantic memory search.
 * Two-tier fallback: local transformer model → TF-IDF
 */

import type { EmbeddingFunction } from "./types.ts";

/**
 * Tier 1: @huggingface/transformers — local, offline, no API cost.
 * Downloads model on first use (~80MB to ~/.cache/huggingface/)
 */
class XenovaEmbedding implements EmbeddingFunction {
  readonly dimensions = 384; // all-MiniLM-L6-v2
  private pipeline: any = null;
  private loading = false;
  private loadPromise: Promise<any> | null = null;

  private async getPipeline(): Promise<any> {
    if (this.pipeline) return this.pipeline;
    if (this.loadPromise) return this.loadPromise;

    this.loading = true;
    this.loadPromise = (async () => {
      try {
        const { pipeline } = await import("@huggingface/transformers");
        this.pipeline = await pipeline("feature-extraction", "Xenova/all-MiniLM-L6-v2", {
          dtype: "q8",
        });
        this.loading = false;
        return this.pipeline;
      } catch (err) {
        this.loadPromise = null; // allow retry on next call
        this.loading = false;
        throw err;
      }
    })();
    return this.loadPromise;
  }

  async embed(texts: string[]): Promise<number[][]> {
    const pipe = await this.getPipeline();
    const results: number[][] = [];
    for (const text of texts) {
      const output = await pipe(text, { pooling: "mean", normalize: true });
      results.push(Array.from(output.data as Float32Array));
    }
    return results;
  }
}

/**
 * Tier 2: TF-IDF fallback — no deps, lower quality but always available.
 * Uses 256-dim hash-based representation.
 */
class TfIdfEmbedding implements EmbeddingFunction {
  readonly dimensions = 256;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(text => this.textToVector(text));
  }

  private textToVector(text: string): number[] {
    const words = text.toLowerCase().split(/\W+/).filter(Boolean);
    const vec = new Float64Array(this.dimensions).fill(0);
    const tf: Record<string, number> = {};
    for (const w of words) { tf[w] = (tf[w] || 0) + 1; }

    for (const [word, count] of Object.entries(tf)) {
      // Simple hash into vector dimension
      let hash = 5381;
      for (let i = 0; i < word.length; i++) {
        hash = ((hash << 5) + hash) + word.charCodeAt(i);
        hash = hash & hash; // Convert to 32bit int
      }
      const idx = Math.abs(hash) % this.dimensions;
      vec[idx] += count / words.length;
    }

    // L2 normalize
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    if (norm > 0) for (let i = 0; i < vec.length; i++) vec[i] /= norm;
    return Array.from(vec);
  }
}

let cachedEmbedder: EmbeddingFunction | null = null;
let embedderPromise: Promise<EmbeddingFunction> | null = null;

/**
 * Get the best available embedding function.
 * Tries Xenova first, falls back to TF-IDF.
 * Promise guard prevents concurrent callers from double-downloading the model.
 */
export async function getEmbedder(): Promise<EmbeddingFunction> {
  if (cachedEmbedder) return cachedEmbedder;
  if (embedderPromise) return embedderPromise;

  embedderPromise = (async () => {
    try {
      // Test if @huggingface/transformers is available
      await import("@huggingface/transformers");
      const embedder = new XenovaEmbedding();
      // Warm up with a test embedding (downloads model if needed)
      await embedder.embed(["test"]);
      console.log("[Embedder] Using Xenova/all-MiniLM-L6-v2 (local, 384-dim)");
      cachedEmbedder = embedder;
      return embedder;
    } catch {
      console.log("[Embedder] @huggingface/transformers unavailable, using TF-IDF fallback (256-dim)");
      cachedEmbedder = new TfIdfEmbedding();
      return cachedEmbedder;
    }
  })().catch(err => {
    embedderPromise = null; // allow retry on next call
    throw err;
  });

  return embedderPromise;
}
