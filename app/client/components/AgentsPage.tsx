import { useState, useEffect, useRef } from 'react';
import type { Agent } from '../types';
import { t } from '../i18n';

const MODEL_BADGE: Record<string, string> = {
  haiku: 'badge-green',
  sonnet: 'badge-blue',
  opus: 'badge-purple',
};

function modelBadgeClass(model: string): string {
  const key = model.toLowerCase();
  if (key.includes('haiku')) return 'badge-green';
  if (key.includes('opus')) return 'badge-purple';
  if (key.includes('sonnet')) return 'badge-blue';
  return MODEL_BADGE[key] ?? 'badge-gray';
}

interface AgentCardProps {
  agent: Agent;
  onDelete: (id: string) => void;
}

function AgentCard({ agent, onDelete }: AgentCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmDelete) {
      onDelete(agent.id);
    } else {
      setConfirmDelete(true);
    }
  };

  const handleCancelDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDelete(false);
  };

  return (
    <div
      className="card hover:border-gray-600 transition-colors cursor-pointer"
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-100">{agent.name}</h3>
            <span className={modelBadgeClass(agent.model)}>{agent.model}</span>
          </div>
          <p className="text-xs text-gray-400 mt-1">{agent.description}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {confirmDelete ? (
            <>
              <button
                onClick={handleDelete}
                className="text-xs px-2 py-1 rounded border border-red-700 text-red-400 hover:bg-red-900/30"
              >
                Confirm
              </button>
              <button
                onClick={handleCancelDelete}
                className="text-xs px-2 py-1 rounded border border-gray-600 text-gray-400 hover:bg-gray-700"
              >
                {t('tasks.cancel')}
              </button>
            </>
          ) : (
            <button
              onClick={handleDelete}
              className="text-gray-600 hover:text-red-400 transition-colors text-xs"
            >
              {t('agents.delete')}
            </button>
          )}
          <span className="text-gray-600 text-xs mt-0.5">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          {agent.description && (
            <p className="text-xs text-gray-300 mb-2">{agent.description}</p>
          )}
          {agent.tools && agent.tools.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1">{t('agents.tools')}:</p>
              <div className="flex flex-wrap gap-1">
                {agent.tools.map((tool) => (
                  <span key={tool} className="text-xs text-gray-500 font-mono bg-gray-800 px-1.5 py-0.5 rounded">
                    {tool}
                  </span>
                ))}
              </div>
            </div>
          )}
          {!agent.description && (!agent.tools || agent.tools.length === 0) && (
            <p className="text-xs text-gray-500 italic">No additional details available.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createPrompt, setCreatePrompt] = useState('');
  const [createStatus, setCreateStatus] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  const refreshAgents = () => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((data: Agent[]) => {
        if (Array.isArray(data)) setAgents(data);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((data: Agent[]) => {
        if (Array.isArray(data)) setAgents(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleExport = async () => {
    try {
      const res = await fetch('/api/agents/export');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `claude-agent-agents-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (file.name.endsWith('.json')) {
        const bundle = JSON.parse(text);
        if (bundle.agents && Array.isArray(bundle.agents)) {
          const res = await fetch('/api/agents/import-bundle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ agents: bundle.agents }),
          });
          const result = await res.json();
          setImportStatus(`Imported ${result.imported} agents`);
        } else {
          setImportStatus('Invalid bundle format (expected { agents: [...] })');
        }
      } else if (file.name.endsWith('.md')) {
        const name = file.name.replace(/\.md$/i, '').toLowerCase();
        const res = await fetch('/api/agents/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, content: text }),
        });
        const result = await res.json();
        setImportStatus(`Imported agent: ${result.name}`);
      }
      refreshAgents();
      setTimeout(() => setImportStatus(''), 3000);
    } catch (err) {
      setImportStatus(`Import failed: ${(err as Error).message}`);
    }
    e.target.value = '';
  };

  const handleCreate = () => {
    setShowCreateModal(true);
    setCreatePrompt('');
    setCreateStatus('');
  };

  const handleCreateSubmit = async () => {
    if (!createPrompt.trim()) return;
    setCreateStatus('Creating agent via AI... (this uses a chat session)');
    try {
      const sessionRes = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Create agent: ${createPrompt.slice(0, 50)}` }),
      });
      const session = await sessionRes.json();

      const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'subscribe', sessionId: session.id }));
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'chat', sessionId: session.id, content: `/skill-creator agent: ${createPrompt}` }));
        }, 500);
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'result') {
          setCreateStatus(msg.success ? 'Agent created! Refreshing list...' : 'Creation failed.');
          ws.close();
          refreshAgents();
          setTimeout(() => { setShowCreateModal(false); setCreateStatus(''); }, 2000);
        } else if (msg.type === 'assistant_message') {
          setCreateStatus(msg.content.slice(0, 200) + '...');
        }
      };
    } catch (err) {
      setCreateStatus(`Error: ${(err as Error).message}`);
    }
  };

  const handleDelete = async (id: string) => {
    setAgents((prev) => prev.filter((a) => a.id !== id));
    try {
      await fetch(`/api/agents/${id}`, { method: 'DELETE' });
    } catch {
      // optimistic removal already applied
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 border-b border-gray-700 bg-gray-800 flex-shrink-0 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">{t('agents.title')}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{t('agents.subtitle')}</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleExport}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
          >
            {t('agents.export')}
          </button>
          <button
            onClick={() => importRef.current?.click()}
            className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors"
          >
            {t('agents.import')}
          </button>
          <button
            onClick={handleCreate}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            {t('agents.create')}
          </button>
          <input ref={importRef} type="file" accept=".json,.md" className="hidden" onChange={handleImportFile} />
        </div>
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <div className="px-6 py-3 border-b border-gray-700 bg-gray-800/50 flex-shrink-0">
          <p className="text-xs text-gray-400 mb-2">{t('agents.createHint')}</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={createPrompt}
              onChange={(e) => setCreatePrompt(e.target.value)}
              placeholder="e.g. A research agent that searches the web and summarizes findings"
              className="input-base flex-1"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateSubmit()}
            />
            <button
              onClick={handleCreateSubmit}
              disabled={!createPrompt.trim()}
              className="btn-primary text-xs disabled:opacity-50"
            >
              {t('agents.createSubmit')}
            </button>
            <button
              onClick={() => setShowCreateModal(false)}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
            >
              {t('tasks.cancel')}
            </button>
          </div>
          {createStatus && <p className="text-xs text-yellow-400 mt-2">{createStatus}</p>}
        </div>
      )}

      {/* Import status */}
      {importStatus && (
        <div className="px-6 py-2 border-b border-gray-700 bg-green-900/20 flex-shrink-0">
          <p className="text-xs text-green-400">{importStatus}</p>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
            Loading agents...
          </div>
        ) : agents.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-2">
            <span className="text-4xl">🤖</span>
            <p className="text-sm">{t('agents.noAgents')}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
            {agents.map((agent) => (
              <AgentCard key={agent.id} agent={agent} onDelete={handleDelete} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
