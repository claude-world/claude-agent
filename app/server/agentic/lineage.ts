/**
 * Lineage — agent memory inheritance system.
 * Mother agents spawn children that inherit subset of parent's memory.
 */

import store from "../db.ts";
import type { AgentLineage } from "../db.ts";

export type MemoryScope = "full" | "summary" | "none";

export interface SpawnChildOptions {
  name: string;
  parentId: string;
  memoryScope?: MemoryScope;
  /** Keys to inherit when memoryScope is 'summary' */
  summaryKeys?: string[];
  /** Chat ID to inherit memories from */
  sourceChatId?: string;
}

/**
 * Spawn a child lineage from a parent, with memory inheritance.
 */
export function spawnChildLineage(opts: SpawnChildOptions): AgentLineage {
  const parent = store.getLineage(opts.parentId);
  if (opts.parentId && !parent) {
    throw new Error(`Parent lineage '${opts.parentId}' not found`);
  }
  const parentVersion = parent?.version ?? 0;

  let inheritedMemory: Record<string, string> = {};

  if (opts.sourceChatId && opts.memoryScope !== "none") {
    const memories = store.listRoleMemories(opts.sourceChatId);
    if (opts.memoryScope === "full") {
      // Inherit all memories
      for (const m of memories) {
        inheritedMemory[m.key] = m.value;
      }
    } else if (opts.memoryScope === "summary") {
      // Inherit only specified keys or non-ephemeral types
      const keysToInherit = new Set(opts.summaryKeys || []);
      for (const m of memories) {
        if (keysToInherit.has(m.key) || (m as any).memory_type === "project" || (m as any).memory_type === "reference") {
          inheritedMemory[m.key] = m.value;
        }
      }
    }
  }

  return store.createLineage({
    name: opts.name,
    parent_id: opts.parentId,
    version: parentVersion + 1,
    memory_scope: opts.memoryScope ?? "summary",
    inherited_memory: inheritedMemory,
  });
}

/**
 * Create a root lineage (no parent).
 */
export function createRootLineage(name: string, memory_scope: MemoryScope = "none"): AgentLineage {
  return store.createLineage({ name, memory_scope });
}

/**
 * Get the full lineage tree for a given root.
 */
export function getLineageTree(rootId: string): AgentLineage & { children: any[] } {
  const root = store.getLineage(rootId);
  if (!root) throw new Error(`Lineage ${rootId} not found`);
  return { ...root, children: buildTree(rootId) };
}

function buildTree(parentId: string, visited = new Set<string>(), depth = 0): any[] {
  if (depth > 20 || visited.has(parentId)) return [];
  visited.add(parentId);
  const children = store.listLineageChildren(parentId);
  return children.map(c => ({ ...c, children: buildTree(c.id, visited, depth + 1) }));
}

/**
 * Get inherited memories for a lineage as a Record.
 */
export function getInheritedMemories(lineageId: string): Record<string, string> {
  const lineage = store.getLineage(lineageId);
  if (!lineage) return {};
  try {
    return JSON.parse(lineage.inherited_memory) as Record<string, string>;
  } catch {
    return {};
  }
}
