import { useState, useEffect, useMemo, useRef } from 'react';
import type { Skill, SkillCategory } from '../types';
import { t } from '../i18n';

const MODEL_BADGE: Record<string, string> = {
  haiku: 'badge-green',
  sonnet: 'badge-blue',
  opus: 'badge-purple'
};

const CATEGORIES: SkillCategory[] = [
  'Core',
  'Content',
  'Productivity',
  'Messaging',
  'Smart Home',
  'Media',
  'System',
  'Migration'
];

// Fallback static skill list when API is not available
const STATIC_SKILLS: Skill[] = [
  // Core
  { id: 'memory-manager', name: 'Memory Manager', command: '/memory-manager', model: 'haiku', category: 'Core', description: 'Consolidate and manage memory files' },
  { id: 'task-tracker', name: 'Task Tracker', command: '/task-tracker', model: 'haiku', category: 'Core', description: 'Track tasks, reminders, and deadlines' },
  { id: 'daily-briefing', name: 'Daily Briefing', command: '/daily-briefing', model: 'sonnet', category: 'Core', description: 'Morning summary of tasks and updates' },
  { id: 'context-health', name: 'Context Health', command: '/context-health', model: 'haiku', category: 'Core', description: 'Check and repair context window health' },
  { id: 'brainstorm', name: 'Brainstorm', command: '/brainstorm', model: 'sonnet', category: 'Core', description: 'Generate ideas on any topic' },
  { id: 'draft-message', name: 'Draft Message', command: '/draft-message', model: 'sonnet', category: 'Core', description: 'Write emails, messages, and documents' },
  { id: 'quick-research', name: 'Quick Research', command: '/quick-research', model: 'sonnet', category: 'Core', description: 'Fast multi-source research' },
  { id: 'summarize', name: 'Summarize', command: '/summarize', model: 'haiku', category: 'Core', description: 'Summarize URLs, documents, or text' },
  { id: 'skill-creator', name: 'Skill Creator', command: '/skill-creator', model: 'sonnet', category: 'Core', description: 'Create new skills from templates' },
  // Content
  { id: 'trend-scout', name: 'Trend Scout', command: '/trend-scout', model: 'haiku', category: 'Content', description: 'Find trending topics from 20+ sources' },
  { id: 'content-creator', name: 'Content Creator', command: '/content-creator', model: 'sonnet', category: 'Content', description: 'Create social media content with quality gate' },
  { id: 'podcast-maker', name: 'Podcast Maker', command: '/podcast-maker', model: 'sonnet', category: 'Content', description: 'Generate podcast scripts and audio' },
  { id: 'deep-read', name: 'Deep Read', command: '/deep-read', model: 'sonnet', category: 'Content', description: 'Read JS-heavy pages via headless browser' },
  { id: 'image-gen', name: 'Image Gen', command: '/image-gen', model: 'sonnet', category: 'Content', description: 'Generate images via AI' },
  { id: 'rss-monitor', name: 'RSS Monitor', command: '/rss-monitor', model: 'haiku', category: 'Content', description: 'Monitor RSS feeds for updates' },
  // Productivity
  { id: 'email', name: 'Email', command: '/email', model: 'sonnet', category: 'Productivity', description: 'Check and send Gmail' },
  { id: 'google-workspace', name: 'Google Workspace', command: '/google-workspace', model: 'sonnet', category: 'Productivity', description: 'Gmail + Calendar + Drive integration' },
  { id: 'github-ops', name: 'GitHub Ops', command: '/github-ops', model: 'sonnet', category: 'Productivity', description: 'GitHub repository operations' },
  { id: 'gh-issues', name: 'GH Issues', command: '/gh-issues', model: 'haiku', category: 'Productivity', description: 'GitHub issue management' },
  { id: 'notion', name: 'Notion', command: '/notion', model: 'haiku', category: 'Productivity', description: 'Read and write Notion pages' },
  { id: 'obsidian', name: 'Obsidian', command: '/obsidian', model: 'haiku', category: 'Productivity', description: 'Obsidian vault operations' },
  { id: 'trello', name: 'Trello', command: '/trello', model: 'haiku', category: 'Productivity', description: 'Trello board management' },
  { id: 'things-mac', name: 'Things', command: '/things-mac', model: 'haiku', category: 'Productivity', description: 'Things 3 task management (macOS)' },
  { id: 'pdf-editor', name: 'PDF Editor', command: '/pdf-editor', model: 'haiku', category: 'Productivity', description: 'Read, edit and convert PDFs' },
  { id: 'bear-notes', name: 'Bear Notes', command: '/bear-notes', model: 'haiku', category: 'Productivity', description: 'Bear note-taking app (macOS)' },
  { id: 'apple-notes', name: 'Apple Notes', command: '/apple-notes', model: 'haiku', category: 'Productivity', description: 'Apple Notes integration' },
  { id: 'apple-reminders', name: 'Apple Reminders', command: '/apple-reminders', model: 'haiku', category: 'Productivity', description: 'Apple Reminders integration' },
  // Messaging
  { id: 'imessage', name: 'iMessage', command: '/imessage', model: 'haiku', category: 'Messaging', description: 'Send and receive iMessages (macOS)' },
  { id: 'whatsapp', name: 'WhatsApp', command: '/whatsapp', model: 'haiku', category: 'Messaging', description: 'WhatsApp messaging integration' },
  { id: 'slack-ops', name: 'Slack Ops', command: '/slack-ops', model: 'haiku', category: 'Messaging', description: 'Slack workspace operations' },
  { id: 'x-twitter', name: 'X / Twitter', command: '/x-twitter', model: 'haiku', category: 'Messaging', description: 'Post and read tweets' },
  // Smart Home
  { id: 'spotify', name: 'Spotify', command: '/spotify', model: 'haiku', category: 'Smart Home', description: 'Control Spotify playback' },
  { id: 'sonos', name: 'Sonos', command: '/sonos', model: 'haiku', category: 'Smart Home', description: 'Control Sonos speakers' },
  { id: 'hue-lights', name: 'Hue Lights', command: '/hue-lights', model: 'haiku', category: 'Smart Home', description: 'Control Philips Hue lights' },
  { id: 'smart-bed', name: 'Smart Bed', command: '/smart-bed', model: 'haiku', category: 'Smart Home', description: 'Smart bed controls' },
  // Media
  { id: 'camera', name: 'Camera', command: '/camera', model: 'haiku', category: 'Media', description: 'Camera and photo operations' },
  { id: 'video-extract', name: 'Video Extract', command: '/video-extract', model: 'sonnet', category: 'Media', description: 'Extract frames and content from video' },
  { id: 'speech-to-text', name: 'Speech to Text', command: '/speech-to-text', model: 'haiku', category: 'Media', description: 'Transcribe audio files' },
  { id: 'text-to-speech', name: 'Text to Speech', command: '/text-to-speech', model: 'haiku', category: 'Media', description: 'Convert text to audio' },
  { id: 'gif-search', name: 'GIF Search', command: '/gif-search', model: 'haiku', category: 'Media', description: 'Find and share GIFs' },
  // System
  { id: 'weather', name: 'Weather', command: '/weather', model: 'haiku', category: 'System', description: 'Current weather and forecast' },
  { id: 'places', name: 'Places', command: '/places', model: 'haiku', category: 'System', description: 'Find nearby restaurants and places' },
  { id: 'password-manager', name: 'Password Manager', command: '/password-manager', model: 'haiku', category: 'System', description: '1Password / Bitwarden integration' },
  { id: 'security-audit', name: 'Security Audit', command: '/security-audit', model: 'sonnet', category: 'System', description: 'Audit open ports and security posture' },
  { id: 'tmux-control', name: 'Tmux Control', command: '/tmux-control', model: 'haiku', category: 'System', description: 'Manage tmux sessions and panes' },
  { id: 'session-logs', name: 'Session Logs', command: '/session-logs', model: 'haiku', category: 'System', description: 'Browse Claude session logs' },
  { id: 'peekaboo', name: 'Peekaboo', command: '/peekaboo', model: 'haiku', category: 'System', description: 'macOS screen capture MCP' },
  // Migration
  { id: 'migrate-openclaw', name: 'Migrate OpenClaw', command: '/migrate-openclaw', model: 'sonnet', category: 'Migration', description: 'Import settings from OpenClaw' }
];

interface SkillCardProps {
  skill: Skill;
}

function SkillCard({ skill }: SkillCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="card hover:border-gray-600 transition-colors cursor-pointer"
      onClick={() => setExpanded((v) => !v)}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-100">{skill.name}</h3>
            <span className={MODEL_BADGE[skill.model] ?? 'badge-gray'}>
              {skill.model}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1 font-mono">{skill.command}</p>
          <p className="text-xs text-gray-400 mt-1">{skill.description}</p>
        </div>
        <span className="text-gray-600 text-xs flex-shrink-0 mt-0.5">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          {skill.full_description && (
            <p className="text-xs text-gray-300 mb-2">{skill.full_description}</p>
          )}
          {skill.prerequisites && skill.prerequisites.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1">Prerequisites:</p>
              <ul className="space-y-0.5">
                {skill.prerequisites.map((p) => (
                  <li key={p} className="text-xs text-gray-500 font-mono flex items-center gap-1">
                    <span className="text-yellow-600">$</span> {p}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!skill.full_description && !skill.prerequisites?.length && (
            <p className="text-xs text-gray-500 italic">No additional details available.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>(STATIC_SKILLS);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<SkillCategory | 'All'>('All');
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createPrompt, setCreatePrompt] = useState('');
  const [createStatus, setCreateStatus] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const importRef = useRef<HTMLInputElement>(null);

  const refreshSkills = () => {
    fetch('/api/skills')
      .then((r) => r.json())
      .then((data: Skill[]) => {
        if (Array.isArray(data) && data.length > 0) setSkills(data);
      })
      .catch(() => {});
  };

  const handleExport = async () => {
    try {
      const res = await fetch('/api/skills/export');
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `claude-agent-skills-${new Date().toISOString().slice(0, 10)}.json`;
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
        // Bundle import
        const bundle = JSON.parse(text);
        if (bundle.skills && Array.isArray(bundle.skills)) {
          const res = await fetch('/api/skills/import-bundle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ skills: bundle.skills }),
          });
          const result = await res.json();
          setImportStatus(`Imported ${result.imported} skills`);
        }
      } else if (file.name.endsWith('.md')) {
        // Single skill import
        const name = file.name.replace(/\.md$/i, '').replace('SKILL', '').replace(/^-+|-+$/g, '').toLowerCase() || 'imported-skill';
        const res = await fetch('/api/skills/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, content: text }),
        });
        const result = await res.json();
        setImportStatus(`Imported skill: ${result.name}`);
      }
      refreshSkills();
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
    setCreateStatus('Creating skill via AI... (this uses a chat session)');
    try {
      // Create a session and send /skill-creator command
      const sessionRes = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Create skill: ${createPrompt.slice(0, 50)}` }),
      });
      const session = await sessionRes.json();

      // Connect via WebSocket and send the command
      const wsUrl = `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.host}/ws`;
      const ws = new WebSocket(wsUrl);
      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'subscribe', sessionId: session.id }));
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'chat', sessionId: session.id, content: `/skill-creator ${createPrompt}` }));
        }, 500);
      };
      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'result') {
          setCreateStatus(msg.success ? 'Skill created! Refreshing list...' : 'Creation failed.');
          ws.close();
          refreshSkills();
          setTimeout(() => { setShowCreateModal(false); setCreateStatus(''); }, 2000);
        } else if (msg.type === 'assistant_message') {
          setCreateStatus(msg.content.slice(0, 200) + '...');
        }
      };
    } catch (err) {
      setCreateStatus(`Error: ${(err as Error).message}`);
    }
  };

  useEffect(() => {
    fetch('/api/skills')
      .then((r) => r.json())
      .then((data: Skill[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setSkills(data);
        }
      })
      .catch(() => {
        // Use static fallback (already set)
      })
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    let list = skills;
    if (activeCategory !== 'All') {
      list = list.filter((s) => s.category === activeCategory);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.command.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q)
      );
    }
    return list;
  }, [skills, activeCategory, search]);

  const grouped = useMemo(() => {
    const map: Partial<Record<SkillCategory, Skill[]>> = {};
    for (const skill of filtered) {
      if (!map[skill.category]) map[skill.category] = [];
      map[skill.category]!.push(skill);
    }
    return map;
  }, [filtered]);

  const visibleCategories =
    activeCategory === 'All'
      ? CATEGORIES.filter((c) => grouped[c]?.length)
      : ([activeCategory] as SkillCategory[]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 border-b border-gray-700 bg-gray-800 flex-shrink-0 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">{t('skills.title')}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {t('skills.subtitle', { count: skills.length })} · {t('skills.clickExpand')}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors">
            {t('skills.export') || 'Export All'}
          </button>
          <button onClick={() => importRef.current?.click()} className="px-3 py-1.5 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded-lg transition-colors">
            {t('skills.import') || 'Import'}
          </button>
          <button onClick={handleCreate} className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors">
            {t('skills.create') || '+ New Skill'}
          </button>
          <input ref={importRef} type="file" accept=".json,.md" className="hidden" onChange={handleImportFile} />
        </div>
      </div>

      {/* Import/Create modals */}
      {showCreateModal && (
        <div className="px-6 py-3 border-b border-gray-700 bg-gray-800/50 flex-shrink-0">
          <p className="text-xs text-gray-400 mb-2">{t('skills.createHint') || 'Describe the skill you want. Claude will create it using /skill-creator.'}</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={createPrompt}
              onChange={(e) => setCreatePrompt(e.target.value)}
              placeholder={t('skills.createPlaceholder') || 'e.g. "A skill that manages my Todoist tasks via CLI"'}
              className="input-base flex-1"
              onKeyDown={(e) => e.key === 'Enter' && handleCreateSubmit()}
            />
            <button onClick={handleCreateSubmit} disabled={!createPrompt.trim()} className="btn-primary text-xs disabled:opacity-50">
              {t('skills.createSubmit') || 'Create with AI'}
            </button>
            <button onClick={() => setShowCreateModal(false)} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200">
              {t('skills.cancel') || 'Cancel'}
            </button>
          </div>
          {createStatus && <p className="text-xs text-yellow-400 mt-2">{createStatus}</p>}
        </div>
      )}

      {importStatus && (
        <div className="px-6 py-2 border-b border-gray-700 bg-green-900/20 flex-shrink-0">
          <p className="text-xs text-green-400">{importStatus}</p>
        </div>
      )}

      {/* Filters */}
      <div className="px-6 py-3 border-b border-gray-700 bg-gray-800 flex-shrink-0 flex gap-3 flex-wrap items-center">
        <input
          type="text"
          placeholder={t('skills.search')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="input-base w-56"
        />
        <div className="flex gap-1.5 flex-wrap">
          <button
            onClick={() => setActiveCategory('All')}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              activeCategory === 'All'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
            }`}
          >
            {t('skills.all')}
          </button>
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                activeCategory === cat
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              {t(`cat.${cat}`)}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
            {t('skills.loading')}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
            {t('skills.noMatch')}
          </div>
        ) : (
          <div className="space-y-6">
            {visibleCategories.map((cat) => (
              <div key={cat}>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  {t(`cat.${cat}`)} ({grouped[cat]?.length ?? 0})
                </h3>
                <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-3">
                  {(grouped[cat] ?? []).map((skill) => (
                    <SkillCard key={skill.id} skill={skill} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
