/**
 * VectorMemoryStore — LanceDB wrapper for semantic memory search.
 * Stored at ~/.claude-agent/data/vectors/
 * Falls back to in-memory array if LanceDB is not available.
 */

import path from "path";
import fs from "fs";
import os from "os";
import type { MemoryRecord, EmbeddingFunction, SemanticSearchResult } from "./types.ts";
import { getEmbedder } from "./embedding.ts";

/** Escape single quotes for LanceDB filter string literals. */
function esc(v: string): string { return v.replace(/'/g, "''"); }

const VECTORS_DIR = path.join(process.env.HOME || os.homedir(), ".claude-agent", "data", "vectors");
const TABLE_NAME = "memories";

export class VectorMemoryStore {
  private db: any = null;          // LanceDB connection
  private table: any = null;       // LanceDB table
  private embedder: EmbeddingFunction | null = null;
  private fallbackStore: MemoryRecord[] = [];  // in-memory fallback
  private useLanceDB = false;
  private initialized = false;
  // Single shared init promise to prevent race conditions
  private initPromise: Promise<void> | null = null;
  private lanceDBFailures = 0;
  private static MAX_LANCEDB_FAILURES = 3;
  private upsertedCount = 0;

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit().catch(err => {
      this.initPromise = null; // allow retry on next call
      throw err;
    });
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    // Initialize embedder (async, may download model)
    this.embedder = await getEmbedder().catch(() => null);

    // Try to initialize LanceDB
    try {
      const lancedb = await import("@lancedb/lancedb");
      if (!fs.existsSync(VECTORS_DIR)) {
        fs.mkdirSync(VECTORS_DIR, { recursive: true });
      }
      this.db = await lancedb.connect(VECTORS_DIR);
      this.useLanceDB = true;
      console.log("[VectorStore] LanceDB initialized at", VECTORS_DIR);

      // Create or open table
      try {
        this.table = await this.db.openTable(TABLE_NAME);
        console.log(`[VectorStore] Opened existing table '${TABLE_NAME}'`);
      } catch {
        // Table doesn't exist yet — will be created on first upsert
        console.log(`[VectorStore] Table '${TABLE_NAME}' will be created on first insert`);
      }
    } catch (err) {
      console.log("[VectorStore] LanceDB unavailable, using in-memory fallback:", err instanceof Error ? err.message : err);
      this.useLanceDB = false;
    }

    this.initialized = true;
  }

  private async getEmbedding(text: string): Promise<number[]> {
    if (!this.embedder) return new Array(256).fill(0);
    const result = await this.embedder.embed([text]);
    return result[0];
  }

  /**
   * Upsert a memory record into the vector store.
   */
  async upsertMemory(record: MemoryRecord): Promise<void> {
    await this.init(); // ensure LanceDB is ready before any write
    const embedding = await this.getEmbedding(`${record.key}: ${record.value}`);
    // LanceDB requires Float32Array for fixed-size vector columns
    const vecData = Float32Array.from(embedding);

    if (this.useLanceDB && this.db) {
      try {
        const row = { ...record, vector: vecData };
        if (!this.table) {
          try {
            this.table = await this.db.createTable(TABLE_NAME, [row]);
          } catch {
            // Table may already exist from a prior partial run — try to open it
            this.table = await this.db.openTable(TABLE_NAME);
            await this.table.add([row]);
          }
        } else {
          // Delete existing entry for this chat_id+key, then insert
          try {
            await this.table.delete(`chat_id = '${esc(record.chat_id)}' AND key = '${esc(record.key)}'`);
          } catch (delErr) {
            console.warn("[VectorStore] Delete before upsert failed:", delErr);
          }
          await this.table.add([row]);
        }
        this.lanceDBFailures = 0;
        this.upsertedCount++;
        return;
      } catch (outerErr) {
        // Both DB paths failed — increment failure counter
        this.lanceDBFailures++;
        if (this.lanceDBFailures >= VectorMemoryStore.MAX_LANCEDB_FAILURES) {
          console.error(`[VectorStore] LanceDB disabled after ${this.lanceDBFailures} consecutive failures`);
          this.useLanceDB = false;
        } else {
          console.warn(`[VectorStore] upsertMemory failed (${this.lanceDBFailures}/${VectorMemoryStore.MAX_LANCEDB_FAILURES}), falling back to in-memory:`, outerErr);
        }
      }
    }

    // Fallback: in-memory
    const idx = this.fallbackStore.findIndex(r => r.chat_id === record.chat_id && r.key === record.key);
    if (idx >= 0) {
      this.fallbackStore[idx] = { ...record };
    } else {
      this.fallbackStore.push({ ...record });
    }
  }

  /**
   * Semantic search: find top-k memories similar to query.
   */
  async searchSimilar(chat_id: string, query: string, limit = 5): Promise<SemanticSearchResult[]> {
    await this.init(); // ensure initialized before any search
    const queryEmbedding = await this.getEmbedding(query);

    if (this.useLanceDB && this.table) {
      try {
        const queryVec = Float32Array.from(queryEmbedding);
        const results = await this.table
          .search(queryVec)
          .where(`chat_id = '${esc(chat_id)}'`)
          .limit(limit)
          .toArray(); // LanceDB v0.12 public API (not .execute())

        return results.map((r: any) => ({
          key: r.key,
          value: r.value,
          chat_id: r.chat_id,
          memory_type: r.memory_type || 'general',
          // Undefined _distance → unknown quality → score 0 (not 1.0)
          score: r._distance !== undefined
            ? Math.max(0, 1 - r._distance / 2) // L2 on unit-normalized vectors: [0,2] → [1,0]
            : 0,
        }));
      } catch (err) {
        console.error("[VectorStore] LanceDB search failed:", err);
      }
    }

    // Fallback: cosine similarity on in-memory store
    const candidates = this.fallbackStore.filter(r => r.chat_id === chat_id);
    if (candidates.length === 0) return [];

    const scored = await Promise.all(
      candidates.map(async r => {
        const emb = await this.getEmbedding(`${r.key}: ${r.value}`);
        const score = cosineSimilarity(queryEmbedding, emb);
        return { ...r, score };
      })
    );

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(r => ({
        key: r.key,
        value: r.value,
        chat_id: r.chat_id,
        memory_type: r.memory_type || 'general',
        score: r.score,
      }));
  }

  /**
   * Bulk sync from SQLite role_memories (called on startup).
   * Non-blocking: fires and forgets.
   */
  async syncFromSqlite(memories: Array<{ id: string; chat_id: string; key: string; value: string; memory_type?: string; source?: string; updated_at: string }>): Promise<void> {
    await this.init(); // ensure embedder is ready
    let count = 0;
    for (const m of memories) {
      try {
        await this.upsertMemory({
          id: m.id,
          chat_id: m.chat_id,
          key: m.key,
          value: m.value,
          memory_type: m.memory_type || 'general',
          source: m.source || 'explicit',
          updated_at: m.updated_at,
        });
        count++;
      } catch {}
    }
    console.log(`[VectorStore] Synced ${count}/${memories.length} memories from SQLite`);
  }

  /**
   * Delete a memory from the vector index.
   */
  async deleteMemory(chat_id: string, key: string): Promise<void> {
    await this.init();
    if (this.useLanceDB && this.table) {
      try {
        await this.table.delete(`chat_id = '${esc(chat_id)}' AND key = '${esc(key)}'`);
        return;
      } catch {}
    }
    const idx = this.fallbackStore.findIndex(r => r.chat_id === chat_id && r.key === key);
    if (idx >= 0) this.fallbackStore.splice(idx, 1);
  }

  getStats(): { total: number; useLanceDB: boolean; embedderType: string } {
    return {
      total: this.useLanceDB ? this.upsertedCount : this.fallbackStore.length,
      useLanceDB: this.useLanceDB,
      embedderType: this.embedder ? (this.embedder.dimensions === 384 ? 'xenova' : 'tfidf') : 'none',
    };
  }
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
