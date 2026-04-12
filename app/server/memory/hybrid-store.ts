/**
 * HybridMemoryStore — facade combining SQLite (ground truth) + LanceDB (semantic search).
 *
 * Writes: both stores (SQLite first, then async LanceDB)
 * Reads: SQLite for exact lookup, LanceDB for semantic search
 */

import { randomUUID } from "crypto";
import { VectorMemoryStore } from "./vector-store.ts";
import type { SemanticSearchResult } from "./types.ts";
import store from "../db.ts";

export class HybridMemoryStore {
  private vectorStore: VectorMemoryStore;
  private initialized = false;
  private initPromise: Promise<void> | null = null;

  constructor() {
    this.vectorStore = new VectorMemoryStore();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit().catch(err => {
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    await this.vectorStore.init();
    this.initialized = true;
  }

  /**
   * Set a memory — writes to SQLite immediately, then async-queues LanceDB upsert.
   */
  async setMemory(chat_id: string, key: string, value: string, memory_type = 'general', source = 'explicit'): Promise<void> {
    // SQLite (synchronous, ground truth)
    store.setRoleMemory(chat_id, key, value);

    // Ensure vector store is fully initialized before upsert
    await this.init();

    // LanceDB (async, non-blocking)
    const id = randomUUID();
    const updated_at = new Date().toISOString();
    this.vectorStore.upsertMemory({ id, chat_id, key, value, memory_type, source, updated_at })
      .catch(err => console.error("[HybridStore] LanceDB upsert failed:", err));
  }

  /**
   * Get a memory by exact key — always uses SQLite.
   */
  getMemory(chat_id: string, key: string): { key: string; value: string } | undefined {
    return store.getRoleMemory(chat_id, key) as any;
  }

  /**
   * List all memories for a chat — from SQLite.
   */
  listMemories(chat_id: string): Array<{ key: string; value: string }> {
    return store.listRoleMemories(chat_id) as any[];
  }

  /**
   * Semantic search — uses LanceDB vector similarity.
   * Returns memories semantically similar to the query.
   */
  async searchSimilar(chat_id: string, query: string, limit = 5): Promise<SemanticSearchResult[]> {
    if (!this.initialized) await this.init();
    return this.vectorStore.searchSimilar(chat_id, query, limit);
  }

  /**
   * Delete a memory from both stores.
   */
  async deleteMemory(chat_id: string, key: string): Promise<void> {
    store.deleteRoleMemory(chat_id, key);
    await this.vectorStore.deleteMemory(chat_id, key).catch(() => {});
  }

  /**
   * Sync all existing SQLite memories to vector store (background, on startup).
   */
  syncFromSqlite(): void {
    (async () => {
      try {
        const rows = store.listAllRoleMemories();
        await this.vectorStore.syncFromSqlite(rows);
      } catch (err) {
        console.error("[HybridStore] Background sync failed:", err);
      }
    })().catch(() => {});
  }

  getStats(): ReturnType<VectorMemoryStore['getStats']> {
    return this.vectorStore.getStats();
  }
}

// Singleton instance
export const hybridMemory = new HybridMemoryStore();
