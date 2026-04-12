import { useState, useEffect } from 'react';
import { t } from '../i18n';
import type { AgentLineage } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

const MEMORY_SCOPE_COLORS: Record<AgentLineage['memory_scope'], string> = {
  full: 'bg-green-900/50 text-green-300',
  summary: 'bg-yellow-900/50 text-yellow-300',
  none: 'bg-gray-700 text-gray-400',
};

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString([], {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return ts;
  }
}

function countDescendants(node: AgentLineage): number {
  if (!node.children || node.children.length === 0) return 0;
  return node.children.reduce((sum, c) => sum + 1 + countDescendants(c), 0);
}

// ── Spawn Form (inline) ───────────────────────────────────────────────────────

interface SpawnFormProps {
  parentId: string;
  onSpawn: (child: AgentLineage) => void;
  onCancel: () => void;
}

function SpawnForm({ parentId, onSpawn, onCancel }: SpawnFormProps) {
  const [name, setName] = useState('');
  const [memoryScope, setMemoryScope] = useState<AgentLineage['memory_scope']>('summary');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t('lineages.nameRequired') || 'Name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/executions/lineages/${parentId}/spawn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), memory_scope: memoryScope }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const child: AgentLineage = await res.json();
      onSpawn(child);
    } catch (err) {
      setError(`${t('lineages.spawnFailed') || 'Spawn failed'}: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 ml-4 card border-blue-700/60 space-y-2 bg-gray-800/80"
      onClick={e => e.stopPropagation()}
    >
      <p className="text-xs font-medium text-gray-400">
        {t('lineages.spawnChild') || 'Spawn Child Agent'}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Child agent name"
          autoFocus
          className="input-base text-xs py-1.5 col-span-1"
        />
        <select
          value={memoryScope}
          onChange={e => setMemoryScope(e.target.value as AgentLineage['memory_scope'])}
          className="input-base text-xs py-1.5 col-span-1"
        >
          <option value="full">{t('lineages.scopeFull')}</option>
          <option value="summary">{t('lineages.scopeSummary')}</option>
          <option value="none">{t('lineages.scopeNone')}</option>
        </select>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={saving} className="btn-primary text-xs py-1 px-3">
          {saving ? (t('lineages.spawning') || 'Spawning...') : (t('lineages.spawn') || 'Spawn')}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-1 px-3">
          {t('lineages.cancel') || 'Cancel'}
        </button>
      </div>
    </form>
  );
}

// ── Inherited Memory Viewer ───────────────────────────────────────────────────

interface InheritedMemoryProps {
  memory: string;
}

function InheritedMemoryViewer({ memory }: InheritedMemoryProps) {
  const [expanded, setExpanded] = useState(false);
  let parsed: Record<string, string> = {};
  try { parsed = JSON.parse(memory || '{}'); } catch {}
  const entries = Object.entries(parsed);

  if (entries.length === 0) return null;

  return (
    <div className="mt-1">
      <button
        onClick={e => { e.stopPropagation(); setExpanded(v => !v); }}
        className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
      >
        {expanded ? '▲' : '▶'}{' '}
        {t('lineages.inheritedMemory') || 'Inherited memory'} ({entries.length})
      </button>
      {expanded && (
        <div className="mt-1.5 space-y-0.5 pl-2 border-l border-gray-700">
          {entries.map(([key, value]) => (
            <div key={key} className="flex gap-2 text-xs">
              <span className="font-mono text-blue-400 flex-shrink-0">{key}</span>
              <span className="text-gray-500 truncate">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tree Node ─────────────────────────────────────────────────────────────────

interface TreeNodeProps {
  node: AgentLineage;
  depth: number;
  onChildSpawned: (parentId: string, child: AgentLineage) => void;
  onNodeDeleted: (id: string) => void;
}

function TreeNode({ node, depth, onChildSpawned, onNodeDeleted }: TreeNodeProps) {
  const [showSpawnForm, setShowSpawnForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/executions/lineages/${node.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onNodeDeleted(node.id); // only after success
    } catch {
      setConfirmDelete(false);
    }
  };

  const handleSpawn = (child: AgentLineage) => {
    onChildSpawned(node.id, child);
    setShowSpawnForm(false);
  };

  return (
    <div className="relative">
      {/* Vertical connector for non-root nodes */}
      {depth > 0 && (
        <div
          className="absolute left-0 top-0 bottom-0 border-l border-gray-700"
          style={{ left: `${(depth - 1) * 20 + 8}px` }}
        />
      )}

      <div style={{ paddingLeft: `${depth * 20}px` }}>
        {/* Horizontal connector */}
        {depth > 0 && (
          <div
            className="absolute border-t border-gray-700"
            style={{
              left: `${(depth - 1) * 20 + 8}px`,
              top: '14px',
              width: '12px',
            }}
          />
        )}

        <div className="card mb-2 hover:border-gray-600 transition-colors">
          <div className="flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-gray-100">{node.name}</span>
                <span className="badge-gray text-xs">v{node.version}</span>
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${MEMORY_SCOPE_COLORS[node.memory_scope]}`}>
                  {node.memory_scope}
                </span>
                <span className="text-xs text-gray-600">{formatDate(node.created_at)}</span>
              </div>
              <InheritedMemoryViewer memory={node.inherited_memory} />
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={e => { e.stopPropagation(); setShowSpawnForm(v => !v); }}
                className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
              >
                {showSpawnForm ? t('lineages.cancel') : t('lineages.spawnChild')}
              </button>
              {confirmDelete ? (
                <div className="flex gap-1">
                  <button onClick={handleDelete} className="btn-danger text-xs py-0.5 px-2">
                    {t('lineages.confirm') || 'Confirm'}
                  </button>
                  <button
                    onClick={e => { e.stopPropagation(); setConfirmDelete(false); }}
                    className="btn-secondary text-xs py-0.5 px-2"
                  >
                    {t('lineages.cancel') || 'Cancel'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={e => { e.stopPropagation(); setConfirmDelete(true); }}
                  className="text-xs text-gray-600 hover:text-red-400 transition-colors"
                >
                  {t('lineages.delete') || 'Delete'}
                </button>
              )}
            </div>
          </div>
        </div>

        {showSpawnForm && (
          <SpawnForm
            parentId={node.id}
            onSpawn={handleSpawn}
            onCancel={() => setShowSpawnForm(false)}
          />
        )}
      </div>

      {/* Render children */}
      {node.children && node.children.length > 0 && (
        <div className="relative">
          {node.children.map(child => (
            <TreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              onChildSpawned={onChildSpawned}
              onNodeDeleted={onNodeDeleted}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Create Root Form ──────────────────────────────────────────────────────────

interface CreateRootFormProps {
  onCreate: (lineage: AgentLineage) => void;
  onCancel: () => void;
}

function CreateRootForm({ onCreate, onCancel }: CreateRootFormProps) {
  const [name, setName] = useState('');
  const [memoryScope, setMemoryScope] = useState<AgentLineage['memory_scope']>('full');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t('lineages.nameRequired') || 'Name is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/executions/lineages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), memory_scope: memoryScope }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created: AgentLineage = await res.json();
      onCreate(created);
    } catch (err) {
      setError(`${t('lineages.createFailed') || 'Create failed'}: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card border-blue-700 space-y-3">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
        {t('lineages.createLineage') || 'New Root Lineage'}
      </h3>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          {t('lineages.name') || 'Name'}
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="e.g. Research Agent v1"
          autoFocus
          className="input-base w-full"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          {t('lineages.memoryScope') || 'Memory Scope'}
        </label>
        <select
          value={memoryScope}
          onChange={e => setMemoryScope(e.target.value as AgentLineage['memory_scope'])}
          className="input-base w-full"
        >
          <option value="full">{t('lineages.scopeFull')}</option>
          <option value="summary">{t('lineages.scopeSummary')}</option>
          <option value="none">{t('lineages.scopeNone')}</option>
        </select>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="btn-primary text-xs py-1.5">
          {saving
            ? (t('lineages.creating') || 'Creating...')
            : (t('lineages.create') || 'Create Lineage')}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-1.5">
          {t('lineages.cancel') || 'Cancel'}
        </button>
      </div>
    </form>
  );
}

// ── Helpers: tree mutation ────────────────────────────────────────────────────

function insertChild(tree: AgentLineage, parentId: string, child: AgentLineage): AgentLineage {
  if (tree.id === parentId) {
    return {
      ...tree,
      children: [...(tree.children ?? []), { ...child, children: [] }],
    };
  }
  return {
    ...tree,
    children: (tree.children ?? []).map(c => insertChild(c, parentId, child)),
  };
}

function removeNode(tree: AgentLineage, nodeId: string): AgentLineage | null {
  if (tree.id === nodeId) return null;
  return {
    ...tree,
    children: (tree.children ?? [])
      .map(c => removeNode(c, nodeId))
      .filter(Boolean) as AgentLineage[],
  };
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function LineagesPage() {
  const [rootLineages, setRootLineages] = useState<AgentLineage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTree, setSelectedTree] = useState<AgentLineage | null>(null);
  const [loadingTree, setLoadingTree] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  // Fetch root lineages list
  useEffect(() => {
    fetch('/api/executions/lineages')
      .then(r => r.json())
      .then((data: AgentLineage[]) => {
        if (Array.isArray(data)) setRootLineages(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  // Fetch full tree when selection changes
  useEffect(() => {
    if (!selectedId) {
      setSelectedTree(null);
      return;
    }
    setLoadingTree(true);
    fetch(`/api/executions/lineages/${selectedId}/tree`)
      .then(r => r.json())
      .then((data: AgentLineage) => setSelectedTree(data))
      .catch(console.error)
      .finally(() => setLoadingTree(false));
  }, [selectedId]);

  const handleCreate = (lineage: AgentLineage) => {
    setRootLineages(prev => [...prev, lineage]);
    setShowCreate(false);
    setSelectedId(lineage.id);
  };

  const handleChildSpawned = (parentId: string, child: AgentLineage) => {
    if (!selectedTree) return;
    setSelectedTree(tree => tree ? insertChild(tree, parentId, child) : tree);
  };

  const handleNodeDeleted = (id: string) => {
    // If the deleted node is the root, remove from list too
    if (id === selectedId) {
      setRootLineages(prev => prev.filter(l => l.id !== id));
      setSelectedId(null);
      setSelectedTree(null);
      return;
    }
    if (selectedTree) {
      const updated = removeNode(selectedTree, id);
      setSelectedTree(updated);
    }
    // Refresh root list in case a root was deleted via nested action
    setRootLineages(prev => prev.filter(l => l.id !== id));
  };

  const handleRootDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/executions/lineages/${id}`, { method: 'DELETE' });
      if (!res.ok) return;
      setRootLineages(prev => prev.filter(l => l.id !== id));
      if (selectedId === id) {
        setSelectedId(null);
        setSelectedTree(null);
      }
    } catch {}
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">
              {t('lineages.title') || 'Lineages'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {t('lineages.subtitle') || 'Agent lineage trees with inherited memory'}
            </p>
          </div>
          {!showCreate && (
            <button onClick={() => setShowCreate(true)} className="btn-secondary text-xs py-1.5">
              {t('lineages.createLineage') || '+ New Lineage'}
            </button>
          )}
        </div>
      </div>

      {/* Two-panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left panel: root list */}
        <div className="w-64 flex-shrink-0 border-r border-gray-700 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-2">
            {showCreate && (
              <CreateRootForm
                onCreate={handleCreate}
                onCancel={() => setShowCreate(false)}
              />
            )}

            {loading ? (
              <div className="flex items-center justify-center h-24 text-gray-500 text-xs">
                {t('lineages.loading') || 'Loading...'}
              </div>
            ) : rootLineages.length === 0 && !showCreate ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-600 gap-2">
                <span className="text-3xl">🧬</span>
                <p className="text-xs">{t('lineages.noLineages') || 'No lineages yet'}</p>
              </div>
            ) : (
              rootLineages.map(lineage => {
                const spawnCount = countDescendants(lineage);
                return (
                  <div
                    key={lineage.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(lineage.id)}
                    onKeyDown={e => e.key === 'Enter' && setSelectedId(lineage.id)}
                    className={`w-full text-left card transition-colors cursor-pointer group ${
                      lineage.id === selectedId
                        ? 'border-blue-600 bg-gray-700/60'
                        : 'hover:border-gray-600'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-sm font-medium text-gray-100 truncate">
                            {lineage.name}
                          </span>
                          <span className="badge-gray text-xs">v{lineage.version}</span>
                        </div>
                        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                          <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${MEMORY_SCOPE_COLORS[lineage.memory_scope]}`}>
                            {lineage.memory_scope}
                          </span>
                          {spawnCount > 0 && (
                            <span className="text-xs text-gray-600">
                              {spawnCount} child{spawnCount !== 1 ? 'ren' : ''}
                            </span>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={e => { e.stopPropagation(); handleRootDelete(lineage.id); }}
                        className="opacity-0 group-hover:opacity-100 text-gray-700 hover:text-red-400 transition-all text-xs flex-shrink-0"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                );
              })
            )}
            <div className="pb-4" />
          </div>
        </div>

        {/* Right panel: tree view */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {selectedId ? (
            loadingTree ? (
              <div className="flex items-center justify-center flex-1 text-gray-500 text-sm">
                {t('lineages.loadingTree') || 'Loading tree...'}
              </div>
            ) : selectedTree ? (
              <div className="flex-1 overflow-y-auto px-4 py-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  {t('lineages.treeView') || 'Lineage Tree'}
                </p>
                <div className="relative">
                  <TreeNode
                    node={selectedTree}
                    depth={0}
                    onChildSpawned={handleChildSpawned}
                    onNodeDeleted={handleNodeDeleted}
                  />
                </div>
                <div className="pb-8" />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 text-gray-600 gap-2">
                <p className="text-sm">{t('lineages.loadError') || 'Failed to load lineage'}</p>
              </div>
            )
          ) : (
            <div className="flex flex-col items-center justify-center flex-1 text-gray-600 gap-2">
              <span className="text-4xl">🧬</span>
              <p className="text-sm">
                {t('lineages.selectLineage') || 'Select a lineage to view its tree'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
