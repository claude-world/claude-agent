import { useState, useEffect, useRef } from 'react';
import useWebSocket from 'react-use-websocket';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Project, Expert, DiscussionMessage } from '../types';
import { t } from '../i18n';

const WS_URL = '/ws';

const EXPERT_COLORS = [
  'text-blue-400',
  'text-green-400',
  'text-purple-400',
  'text-orange-400',
];

const CLI_BADGE_COLORS: Record<string, string> = {
  claude: 'bg-blue-900/50 text-blue-300 border border-blue-700',
  codex: 'bg-green-900/50 text-green-300 border border-green-700',
  gemini: 'bg-yellow-900/50 text-yellow-300 border border-yellow-700',
};

const MODE_ICONS: Record<string, string> = {
  roundtable: '🏛️',
  debate: '⚔️',
  relay: '🔄',
  auto: '🤖',
};

const STATUS_BADGE: Record<string, string> = {
  setup: 'bg-gray-700 text-gray-300',
  discussing: 'bg-blue-900/50 text-blue-300',
  discussed: 'bg-purple-900/50 text-purple-300',
  concluded: 'bg-green-900/50 text-green-300',
};

function expertColor(index: number): string {
  return EXPERT_COLORS[index % EXPERT_COLORS.length];
}

function cliBadge(cli: string): string {
  return CLI_BADGE_COLORS[cli] ?? 'bg-gray-700 text-gray-300 border border-gray-600';
}

// ---- New Project Form ----

interface NewProjectFormProps {
  onSave: (name: string, topic: string) => Promise<void>;
  onCancel: () => void;
}

function NewProjectForm({ onSave, onCancel }: NewProjectFormProps) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Project name is required'); return; }
    if (!topic.trim()) { setError('Discussion topic is required'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave(name.trim(), topic.trim());
    } catch (err) {
      setError(`Save failed: ${(err as Error).message}`);
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card border-blue-700 space-y-4">
      <h3 className="text-sm font-semibold text-gray-100">{t('projects.newProject')}</h3>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">{t('projects.name')}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="API Design Review"
          className="input-base w-full"
          autoFocus
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">{t('projects.topic')}</label>
        <textarea
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder={t('projects.topicPlaceholder')}
          rows={3}
          className="input-base w-full resize-none"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="btn-primary text-xs py-1.5">
          {saving ? 'Creating...' : 'Create'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-1.5">
          {t('tasks.cancel')}
        </button>
      </div>
    </form>
  );
}

// ---- Expert Card (editable) ----

interface ExpertCardProps {
  expert: Expert;
  index: number;
  availableClis: string[];
  onChange: (updated: Expert) => void;
}

function ExpertCard({ expert, index, availableClis, onChange }: ExpertCardProps) {
  return (
    <div className="card border-gray-600 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`text-sm font-semibold ${expertColor(index)}`}>{expert.name || `Expert ${index + 1}`}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded-full ${cliBadge(expert.cli)}`}>{expert.cli}</span>
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Name</label>
        <input
          type="text"
          value={expert.name}
          onChange={(e) => onChange({ ...expert, name: e.target.value })}
          className="input-base w-full text-xs"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">Role</label>
        <input
          type="text"
          value={expert.role}
          onChange={(e) => onChange({ ...expert, role: e.target.value })}
          className="input-base w-full text-xs"
        />
      </div>

      <div>
        <label className="block text-xs text-gray-500 mb-1">CLI</label>
        <select
          value={expert.cli}
          onChange={(e) => onChange({ ...expert, cli: e.target.value })}
          className="input-base w-full text-xs"
        >
          {availableClis.map((cli) => (
            <option key={cli} value={cli}>{cli}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ---- Discussion Message ----

interface DiscussionMsgProps {
  message: DiscussionMessage;
  expertIndex: number;
}

function DiscussionMsg({ message, expertIndex }: DiscussionMsgProps) {
  const color = expertColor(expertIndex);

  return (
    <div className="card border-gray-700 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-sm font-semibold ${color}`}>{message.expert_name}</span>
        <span className={`text-xs px-1.5 py-0.5 rounded-full ${cliBadge(message.cli)}`}>{message.cli}</span>
        <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-700 text-gray-400">
          {t('projects.round')} {message.round}
        </span>
        <span className="text-xs text-gray-600 ml-auto">
          {new Date(message.created_at).toLocaleTimeString()}
        </span>
      </div>
      <div className="prose-dark text-sm text-gray-200">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
      </div>
    </div>
  );
}

// ---- Setup Panel ----

interface SetupPanelProps {
  project: Project;
  availableClis: string[];
  onSetupExperts: () => Promise<void>;
  onUpdateExperts: (experts: Expert[]) => void;
  onStartDiscussion: (mode: string) => Promise<void>;
  generating: boolean;
  starting: boolean;
}

function SetupPanel({
  project,
  availableClis,
  onSetupExperts,
  onUpdateExperts,
  onStartDiscussion,
  generating,
  starting,
}: SetupPanelProps) {
  const [mode, setMode] = useState(project.discussion_mode || 'auto');

  const handleExpertChange = (index: number, updated: Expert) => {
    const newExperts = [...project.experts];
    newExperts[index] = updated;
    onUpdateExperts(newExperts);
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
      {/* Project info */}
      <div>
        <h3 className="text-base font-semibold text-gray-100">{project.name}</h3>
        <p className="text-sm text-gray-400 mt-1">{project.topic}</p>
      </div>

      {/* Generate experts */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-gray-300">{t('projects.experts')}</h4>
          <button
            onClick={onSetupExperts}
            disabled={generating}
            className="px-3 py-1.5 text-xs bg-purple-700 hover:bg-purple-600 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg transition-colors"
          >
            {generating ? t('projects.generating') : t('projects.generateExperts')}
          </button>
        </div>

        {project.experts.length === 0 && !generating && (
          <p className="text-xs text-gray-600 italic">
            Click "Generate Experts" to auto-generate experts based on your topic.
          </p>
        )}

        {generating && (
          <div className="flex items-center gap-2 text-xs text-purple-400">
            <span className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
            {t('projects.generating')}
          </div>
        )}

        <div className="grid grid-cols-1 gap-3">
          {project.experts.map((expert, i) => (
            <ExpertCard
              key={i}
              expert={expert}
              index={i}
              availableClis={availableClis}
              onChange={(updated) => handleExpertChange(i, updated)}
            />
          ))}
        </div>
      </div>

      {/* Discussion mode */}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold text-gray-300">{t('projects.mode')}</h4>
        <div className="flex flex-wrap gap-2">
          {(['auto', 'roundtable', 'debate', 'relay'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors flex items-center gap-1.5 ${
                mode === m
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              <span>{MODE_ICONS[m]}</span>
              <span>{t(`projects.${m}`)}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Start button */}
      <div className="pt-2">
        <button
          onClick={() => onStartDiscussion(mode)}
          disabled={starting || project.experts.length === 0}
          className="btn-primary w-full disabled:bg-gray-700 disabled:text-gray-500"
        >
          {starting ? 'Starting...' : t('projects.start')}
        </button>
      </div>
    </div>
  );
}

// ---- Discussion Panel ----

interface DiscussionPanelProps {
  project: Project;
  messages: DiscussionMessage[];
  currentRound: number;
  isDiscussing: boolean;
  onAbort: () => void;
  onGuide: (text: string) => Promise<void>;
  onConclude: () => Promise<void>;
  concluding: boolean;
  streamingConclusion?: string;
}

function DiscussionPanel({
  project,
  messages,
  currentRound,
  streamingConclusion,
  isDiscussing,
  onAbort,
  onGuide,
  onConclude,
  concluding,
}: DiscussionPanelProps) {
  const [guide, setGuide] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isDiscussing]);

  const expertNameToIndex = Object.fromEntries(
    project.experts.map((e, i) => [e.name, i])
  );

  const handleGuide = async () => {
    if (!guide.trim()) return;
    await onGuide(guide.trim());
    setGuide('');
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Timeline */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
          {messages.length === 0 && !isDiscussing && (
            <div className="flex flex-col items-center justify-center h-40 text-gray-600 gap-2">
              <span className="text-3xl">💬</span>
              <p className="text-sm">{t('projects.discussing')}</p>
            </div>
          )}

          {messages.map((msg) => (
            <DiscussionMsg
              key={msg.id}
              message={msg}
              expertIndex={expertNameToIndex[msg.expert_name] ?? 0}
            />
          ))}

          {isDiscussing && (
            <div className="card border-gray-700 flex items-center gap-2 text-sm text-gray-400">
              <span className="w-2 h-2 bg-blue-400 rounded-full animate-pulse" />
              <span className="animate-pulse">
                {(() => {
                  // Show which expert is likely speaking next
                  const lastMsg = messages[messages.length - 1];
                  if (lastMsg && project.experts.length > 0) {
                    const lastIdx = project.experts.findIndex(e => e.name === lastMsg.expert_name);
                    const nextIdx = (lastIdx + 1) % project.experts.length;
                    const nextExpert = project.experts[nextIdx];
                    return `${nextExpert?.name || '?'}`;
                  }
                  return project.experts[0]?.name || '';
                })()}
                {' '}
              </span>
              {t('projects.typing') || 'is typing...'}
              {currentRound > 0 && (
                <span className="text-xs text-gray-500">
                  {t('projects.round')} {currentRound}
                </span>
              )}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Guide + conclude bar */}
        <div className="flex-shrink-0 px-6 py-3 border-t border-gray-700 bg-gray-800 space-y-2">
          {/* Streaming conclusion preview */}
          {concluding && streamingConclusion && (
            <div className="p-3 rounded-lg border border-indigo-700 bg-indigo-900/20 max-h-40 overflow-y-auto">
              <p className="text-xs text-indigo-300 font-medium mb-1">{t('projects.concluding')}</p>
              <div className="text-xs text-gray-300 prose-dark">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamingConclusion}</ReactMarkdown>
              </div>
            </div>
          )}

          {/* Abort button during discussion */}
          {isDiscussing && (
            <button onClick={onAbort} className="btn-danger w-full text-sm">
              {t('projects.abort') || 'Stop Discussion'}
            </button>
          )}

          {project.status === 'discussed' && !isDiscussing && (
            <button
              onClick={onConclude}
              disabled={concluding}
              className="btn-primary w-full text-sm"
            >
              {concluding ? t('projects.concluding') : t('projects.conclude')}
            </button>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              value={guide}
              onChange={(e) => setGuide(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleGuide(); }}
              placeholder={t('projects.guidePlaceholder')}
              className="input-base flex-1 text-sm"
            />
            <button
              onClick={handleGuide}
              disabled={!guide.trim()}
              className="btn-secondary text-xs px-3"
            >
              {t('projects.guide')}
            </button>
          </div>
        </div>
      </div>

      {/* Expert mini-panel */}
      <div className="w-44 flex-shrink-0 border-l border-gray-700 overflow-y-auto px-3 py-4 space-y-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('projects.experts')}</p>
        {project.experts.map((expert, i) => {
          const msgCount = messages.filter((m) => m.expert_name === expert.name).length;
          return (
            <div key={i} className="space-y-0.5">
              <p className={`text-xs font-semibold ${expertColor(i)}`}>{expert.name}</p>
              <p className="text-xs text-gray-500 leading-snug">{expert.role}</p>
              <span className={`inline-block text-xs px-1.5 py-0.5 rounded-full ${cliBadge(expert.cli)}`}>{expert.cli}</span>
              <p className="text-xs text-gray-600">{msgCount} msgs</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Conclusion Panel ----

interface ConclusionPanelProps {
  project: Project;
  conclusion: string;
  messages: DiscussionMessage[];
}

function ConclusionPanel({ project, conclusion, messages }: ConclusionPanelProps) {
  const [showTimeline, setShowTimeline] = useState(false);

  const expertNameToIndex = Object.fromEntries(
    project.experts.map((e, i) => [e.name, i])
  );

  const handleDownload = () => {
    const content = `# ${project.name}\n\n**Topic:** ${project.topic}\n\n## Conclusion\n\n${conclusion}\n\n## Discussion\n\n${
      messages.map((m) => `### ${m.expert_name} (Round ${m.round})\n\n${m.content}`).join('\n\n---\n\n')
    }`;
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${project.name.replace(/\s+/g, '-').toLowerCase()}-conclusion.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-100">{project.name}</h3>
          <p className="text-sm text-gray-400 mt-0.5">{project.topic}</p>
        </div>
        <button
          onClick={handleDownload}
          className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 text-white rounded-lg transition-colors"
        >
          {t('projects.download')}
        </button>
      </div>

      {/* Conclusion */}
      <div className="card border-green-700 bg-green-900/10">
        <div className="prose-dark text-sm text-gray-200">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{conclusion}</ReactMarkdown>
        </div>
      </div>

      {/* Collapsed timeline toggle */}
      <button
        onClick={() => setShowTimeline((v) => !v)}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1"
      >
        <span>{showTimeline ? '▲' : '▼'}</span>
        <span>Discussion Timeline ({messages.length} messages)</span>
      </button>

      {showTimeline && (
        <div className="space-y-3">
          {messages.map((msg) => (
            <DiscussionMsg
              key={msg.id}
              message={msg}
              expertIndex={expertNameToIndex[msg.expert_name] ?? 0}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Main Page ----

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Project | null>(null);
  const [messages, setMessages] = useState<DiscussionMessage[]>([]);
  const [conclusion, setConclusion] = useState('');
  const [availableClis, setAvailableClis] = useState<string[]>(['claude']);
  const [currentRound, setCurrentRound] = useState(0);
  const [isDiscussing, setIsDiscussing] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [starting, setStarting] = useState(false);
  const [concluding, setConcluding] = useState(false);
  const [loading, setLoading] = useState(true);
  const selectedRef = useRef<Project | null>(null);

  const { sendJsonMessage, lastJsonMessage } = useWebSocket(WS_URL, {
    shouldReconnect: () => true,
    reconnectInterval: 2000,
    reconnectAttempts: 20,
  });

  // Load initial data
  useEffect(() => {
    fetch('/api/cli-available')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setAvailableClis(data); })
      .catch(() => {});

    fetch('/api/projects')
      .then((r) => r.json())
      .then((data: Project[]) => { if (Array.isArray(data)) setProjects(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Subscribe to project WS events when selected project changes
  useEffect(() => {
    selectedRef.current = selected;
    if (!selected) return;
    sendJsonMessage({ type: 'subscribe_project', projectId: selected.id });

    // Load messages for selected project
    fetch(`/api/projects/${selected.id}/messages`)
      .then((r) => r.json())
      .then((data: DiscussionMessage[]) => { if (Array.isArray(data)) setMessages(data); })
      .catch(() => {});

    // Load conclusion if concluded
    if (selected.status === 'concluded') {
      fetch(`/api/projects/${selected.id}/conclusion`)
        .then((r) => r.json())
        .then((data: { content: string }) => { if (data.content) setConclusion(data.content); })
        .catch(() => {});
    }
  }, [selected, sendJsonMessage]);

  // Handle WS messages for project events
  useEffect(() => {
    if (!lastJsonMessage) return;
    const msg = lastJsonMessage as { type: string; [key: string]: unknown };
    const proj = selectedRef.current;
    if (!proj) return;

    switch (msg.type) {
      case 'project_expert_message': {
        const newMsg = msg.message as DiscussionMessage;
        if (newMsg.project_id === proj.id) {
          setMessages((prev) => {
            // Streaming: if same expert + same round exists, replace content (growing text)
            const existing = prev.findIndex(
              m => m.expert_name === newMsg.expert_name && m.round === newMsg.round
            );
            if (existing >= 0) {
              const updated = [...prev];
              updated[existing] = { ...updated[existing], content: newMsg.content };
              return updated;
            }
            return [...prev, newMsg];
          });
        }
        break;
      }
      case 'project_round_start': {
        if ((msg.projectId as string) === proj.id) {
          setCurrentRound(msg.round as number);
          setIsDiscussing(true);
        }
        break;
      }
      case 'project_round_end': {
        if ((msg.projectId as string) === proj.id) {
          setIsDiscussing(false);
          // Refresh project status
          fetch(`/api/projects/${proj.id}`)
            .then((r) => r.json())
            .then((data: Project) => {
              setSelected(data);
              setProjects((prev) => prev.map((p) => (p.id === data.id ? data : p)));
            })
            .catch(() => {});
        }
        break;
      }
      case 'project_conclusion': {
        if ((msg.projectId as string) === proj.id) {
          setConclusion(msg.content as string);
          // Check if project is actually concluded (status changed)
          fetch(`/api/projects/${proj.id}`)
            .then((r) => r.json())
            .then((data: Project) => {
              if (data.status === 'concluded') {
                setConcluding(false);
                setSelected(data);
                setProjects((prev) => prev.map((p) => (p.id === data.id ? data : p)));
              }
            })
            .catch(() => {});
        }
        break;
      }
    }
  }, [lastJsonMessage]);

  const handleCreateProject = async (name: string, topic: string) => {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, topic }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const created: Project = await res.json();
    setProjects((prev) => [created, ...prev]);
    setSelected(created);
    setMessages([]);
    setConclusion('');
    setShowNewForm(false);
  };

  const handleSetupExperts = async () => {
    if (!selected) return;
    setGenerating(true);
    try {
      const res = await fetch(`/api/projects/${selected.id}/setup-experts`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: Project = await res.json();
      setSelected(updated);
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch {
      // silent
    } finally {
      setGenerating(false);
    }
  };

  const handleUpdateExperts = (experts: Expert[]) => {
    if (!selected) return;
    const updated = { ...selected, experts };
    setSelected(updated);
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    // Persist to server
    fetch(`/api/projects/${selected.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ experts }),
    }).catch(() => {});
  };

  const handleStartDiscussion = async (mode: string) => {
    if (!selected) return;
    setStarting(true);
    try {
      // Update mode first
      await fetch(`/api/projects/${selected.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ discussion_mode: mode }),
      });

      // Start discussion
      const res = await fetch(`/api/projects/${selected.id}/start`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      // Set status locally — don't fetch server (race condition: runDiscussion is async)
      const updated = { ...selected, status: 'discussing', discussion_mode: mode };
      setSelected(updated);
      setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
      setIsDiscussing(true);
      setMessages([]);
    } catch {
      // silent
    } finally {
      setStarting(false);
    }
  };

  const handleGuide = async (text: string) => {
    if (!selected) return;
    await fetch(`/api/projects/${selected.id}/guide`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    }).catch(() => {});
  };

  const handleAbort = async () => {
    if (!selected) return;
    try {
      await fetch(`/api/projects/${selected.id}/abort`, { method: 'POST' });
      const updated = { ...selected, status: 'discussed' };
      setSelected(updated);
      setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
      setIsDiscussing(false);
    } catch {}
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await fetch(`/api/projects/${id}`, { method: 'DELETE' });
      setProjects(prev => prev.filter(p => p.id !== id));
      if (selected?.id === id) {
        setSelected(null);
        setMessages([]);
      }
    } catch {}
  };

  const handleResetProject = async () => {
    if (!selected) return;
    try {
      await fetch(`/api/projects/${selected.id}/reset`, { method: 'POST' });
      const updated = { ...selected, status: 'ready' };
      setSelected(updated);
      setProjects(prev => prev.map(p => p.id === updated.id ? updated : p));
      setMessages([]);
      setIsDiscussing(false);
    } catch {}
  };

  const handleConclude = async () => {
    if (!selected) return;
    setConcluding(true);
    try {
      const res = await fetch(`/api/projects/${selected.id}/conclude`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Conclusion will arrive via WS event project_conclusion
    } catch {
      setConcluding(false);
    }
  };

  const handleSelectProject = (project: Project) => {
    setSelected(project);
    setMessages([]);
    setConclusion('');
    setCurrentRound(0);
    setIsDiscussing(false);
  };

  // Render right panel based on project state
  const renderRightPanel = () => {
    if (!selected) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-600 gap-3">
          <span className="text-4xl">🏛️</span>
          <p className="text-sm">{t('projects.createHint')}</p>
        </div>
      );
    }

    if (selected.status === 'setup' || selected.status === 'ready') {
      return (
        <SetupPanel
          project={selected}
          availableClis={availableClis}
          onSetupExperts={handleSetupExperts}
          onUpdateExperts={handleUpdateExperts}
          onStartDiscussion={handleStartDiscussion}
          generating={generating}
          starting={starting}
        />
      );
    }

    if (selected.status === 'concluded') {
      return (
        <ConclusionPanel
          project={selected}
          conclusion={conclusion}
          messages={messages}
        />
      );
    }

    // discussing | discussed
    return (
      <DiscussionPanel
        project={selected}
        messages={messages}
        currentRound={currentRound}
        isDiscussing={isDiscussing || selected.status === 'discussing'}
        onAbort={handleAbort}
        onGuide={handleGuide}
        onConclude={handleConclude}
        concluding={concluding}
        streamingConclusion={concluding ? conclusion : undefined}
      />
    );
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 border-b border-gray-700 bg-gray-800 flex-shrink-0 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">{t('projects.title')}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{t('projects.subtitle')}</p>
        </div>
        {!showNewForm && (
          <button
            onClick={() => setShowNewForm(true)}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            {t('projects.newProject')}
          </button>
        )}
      </div>

      {/* Body: split layout */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel: project list */}
        <div className="w-72 flex-shrink-0 border-r border-gray-700 flex flex-col overflow-hidden">
          {showNewForm && (
            <div className="p-3 border-b border-gray-700">
              <NewProjectForm
                onSave={handleCreateProject}
                onCancel={() => setShowNewForm(false)}
              />
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {loading && (
              <div className="flex items-center justify-center h-20 text-gray-500 text-xs">
                Loading...
              </div>
            )}

            {!loading && projects.length === 0 && !showNewForm && (
              <div className="flex flex-col items-center justify-center h-40 text-gray-600 gap-2">
                <span className="text-3xl">🏛️</span>
                <p className="text-xs">{t('projects.noProjects')}</p>
              </div>
            )}

            {projects.map((project) => {
              const isActive = selected?.id === project.id;
              return (
                <button
                  key={project.id}
                  onClick={() => handleSelectProject(project)}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${
                    isActive
                      ? 'bg-gray-700 border-blue-600'
                      : 'bg-gray-800 border-gray-700 hover:bg-gray-750 hover:border-gray-600'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-medium text-gray-100 leading-tight">{project.name}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full flex-shrink-0 ${STATUS_BADGE[project.status] ?? 'bg-gray-700 text-gray-300'}`}>
                      {t(`projects.status.${project.status}`)}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1 line-clamp-2">{project.topic}</p>
                  <div className="flex items-center justify-between mt-1">
                    {project.experts.length > 0 && (
                      <p className="text-xs text-gray-600">
                        {project.experts.length} {t('projects.experts')}
                      </p>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteProject(project.id); }}
                      className="text-xs text-gray-600 hover:text-red-400 transition-colors"
                      title="Delete project"
                    >
                      ✕
                    </button>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Right panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {renderRightPanel()}
        </div>
      </div>
    </div>
  );
}
