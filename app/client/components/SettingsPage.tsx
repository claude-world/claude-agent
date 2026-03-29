import { useState, useEffect } from 'react';
import type { Language, ModelDefault, McpServer } from '../types';
import { t, setLocale as setGlobalLocale } from '../i18n';

const LANGUAGES: { value: Language; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'zh-TW', label: '繁體中文 (Traditional Chinese)' },
  { value: 'ja', label: '日本語 (Japanese)' }
];

const MODELS: { value: ModelDefault; label: string; description: string }[] = [
  { value: 'haiku', label: 'Haiku', description: 'Fast & cheap — simple tasks' },
  { value: 'sonnet', label: 'Sonnet', description: 'Balanced — complex coding (default)' },
  { value: 'opus', label: 'Opus', description: 'Best quality — critical tasks (1M context)' }
];

const TOOL_COUNTS: Record<string, number> = {
  'trend-pulse': 11, 'claude-101': 27, 'cf-browser': 15, 'notebooklm': 13,
};

const TIER_LABELS: Record<string, string> = {
  'trend-pulse': 'Tier 1 — Zero Auth (always available)',
  'claude-101': 'Tier 1 — Zero Auth (always available)',
  'cf-browser': 'Tier 2 — Requires CF_ACCOUNT_ID + CF_API_TOKEN',
  'notebooklm': 'Tier 2 — Requires Google login (uvx notebooklm login)'
};

function McpServerCard({ server }: { server: McpServer }) {
  const statusColors: Record<McpServer['status'], string> = {
    connected: 'text-green-400',
    disconnected: 'text-gray-500',
    error: 'text-red-400'
  };
  const dotColors: Record<McpServer['status'], string> = {
    connected: 'bg-green-400',
    disconnected: 'bg-gray-600',
    error: 'bg-red-500'
  };

  return (
    <div className="card flex items-center gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`w-2 h-2 rounded-full flex-shrink-0 ${dotColors[server.status]}`} />
          <h4 className="text-sm font-medium text-gray-100">{server.name}</h4>
          {server.tools !== undefined && (
            <span className="badge-gray">{server.tools} tools</span>
          )}
        </div>
        <p className="text-xs text-gray-500 mt-0.5 ml-4">
          {TIER_LABELS[server.name] ?? 'MCP Server'}
        </p>
      </div>
      <span className={`text-xs font-medium flex-shrink-0 ${statusColors[server.status]}`}>
        {server.status.charAt(0).toUpperCase() + server.status.slice(1)}
      </span>
    </div>
  );
}

interface SettingsPageProps {
  onLocaleChange?: (locale: Language) => void;
}

export default function SettingsPage({ onLocaleChange }: SettingsPageProps) {
  const [language, setLanguage] = useState<Language>('en');
  const [modelDefault, setModelDefault] = useState<ModelDefault>('sonnet');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectPath, setProjectPath] = useState('');
  const [projectStatus, setProjectStatus] = useState<{ has_claude_md: boolean; has_skills: boolean; has_memory: boolean } | null>(null);
  const [initPath, setInitPath] = useState('');
  const [initStatus, setInitStatus] = useState('');
  const [mcpServers, setMcpServers] = useState<McpServer[]>([]);

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        if (data.language) setLanguage(data.language as Language);
        if (data.model_default) setModelDefault(data.model_default as ModelDefault);
      })
      .catch(() => {});

    // Load project info
    fetch('/api/project')
      .then(r => r.json())
      .then(data => {
        setProjectPath(data.agent_root || '');
        setProjectStatus({ has_claude_md: data.has_claude_md, has_skills: data.has_skills, has_memory: data.has_memory });
      })
      .catch(() => {});
    fetch('/api/mcp')
      .then((r) => r.json())
      .then((data: { mcpServers?: Record<string, unknown> }) => {
        if (data.mcpServers) {
          const servers: McpServer[] = Object.keys(data.mcpServers).map((name) => ({
            name,
            status: 'connected' as const,
            tools: TOOL_COUNTS[name],
          }));
          setMcpServers(servers);
        }
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, model_default: modelDefault })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(`Save failed: ${(err as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <h2 className="text-lg font-semibold text-gray-100">{t('settings.title')}</h2>
        <p className="text-xs text-gray-400 mt-0.5">{t('settings.subtitle')}</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-8 max-w-2xl">
        {/* Language */}
        <section>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('settings.language')}</h3>
          <div className="space-y-2">
            {LANGUAGES.map(({ value, label }) => (
              <label
                key={value}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  language === value
                    ? 'border-blue-600 bg-blue-600/10'
                    : 'border-gray-700 hover:border-gray-600'
                }`}
              >
                <input
                  type="radio"
                  name="language"
                  value={value}
                  checked={language === value}
                  onChange={() => { setLanguage(value); setGlobalLocale(value); onLocaleChange?.(value); }}
                  className="accent-blue-500"
                />
                <span className="text-sm text-gray-200">{label}</span>
              </label>
            ))}
          </div>
        </section>

        {/* Model */}
        <section>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('settings.model')}</h3>
          <div className="space-y-2">
            {MODELS.map(({ value, label, description }) => (
              <label
                key={value}
                className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                  modelDefault === value
                    ? 'border-blue-600 bg-blue-600/10'
                    : 'border-gray-700 hover:border-gray-600'
                }`}
              >
                <input
                  type="radio"
                  name="model"
                  value={value}
                  checked={modelDefault === value}
                  onChange={() => setModelDefault(value)}
                  className="accent-blue-500"
                />
                <div className="flex-1">
                  <span className="text-sm font-medium text-gray-200">{label}</span>
                  <span className="text-xs text-gray-500 ml-2">{description}</span>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Save */}
        <div className="flex items-center gap-3 pt-2">
          <button onClick={save} disabled={isSaving} className="btn-primary">
            {isSaving ? t('settings.saving') : t('settings.save')}
          </button>
          {saveSuccess && <span className="text-sm text-green-400">{t('settings.saved')}</span>}
          {error && <span className="text-sm text-red-400">{error}</span>}
        </div>

        {/* Project Directory */}
        <section className="pt-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-1">{t('settings.projectTitle') || 'Project Directory'}</h3>
          <p className="text-xs text-gray-500 mb-3">{t('settings.projectDesc') || 'The directory where CLAUDE.md, skills, agents, and memory are stored.'}</p>

          <div className="p-3 rounded-lg border border-gray-700 space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 font-mono flex-1 truncate">{projectPath || '(not set)'}</span>
              {projectStatus && (
                <div className="flex gap-1">
                  <span className={projectStatus.has_claude_md ? 'badge-green' : 'badge-gray'}>CLAUDE.md</span>
                  <span className={projectStatus.has_skills ? 'badge-green' : 'badge-gray'}>Skills</span>
                  <span className={projectStatus.has_memory ? 'badge-green' : 'badge-gray'}>Memory</span>
                </div>
              )}
            </div>

            <div className="flex gap-2 items-center">
              <input
                type="text"
                value={initPath}
                onChange={e => setInitPath(e.target.value)}
                placeholder={t('settings.projectPlaceholder') || '~/claude-agent or /path/to/project'}
                className="input-base flex-1 text-xs"
              />
              <button
                onClick={async () => {
                  try {
                    const res = await fetch('/api/project/browse');
                    const data = await res.json();
                    if (data.path) setInitPath(data.path);
                  } catch {}
                }}
                className="btn-secondary text-xs py-1.5 whitespace-nowrap"
              >
                {t('settings.projectBrowse') || 'Browse'}
              </button>
              <button
                onClick={async () => {
                  if (!initPath.trim()) return;
                  setInitStatus('Initializing...');
                  try {
                    const res = await fetch('/api/project/init', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ project_path: initPath.trim() }),
                    });
                    const data = await res.json();
                    if (data.success) {
                      setProjectPath(data.path);
                      setInitStatus('Initialized! Restart app to use new path.');
                    } else {
                      setInitStatus(`Error: ${data.error}`);
                    }
                  } catch (err) { setInitStatus(`Error: ${(err as Error).message}`); }
                  setTimeout(() => setInitStatus(''), 5000);
                }}
                className="btn-primary text-xs py-1.5"
              >
                {t('settings.projectInit') || 'Initialize'}
              </button>
              <button
                onClick={async () => {
                  if (!confirm('Reset all skills, agents, rules to defaults? Your memory will be kept.')) return;
                  setInitStatus('Resetting...');
                  try {
                    const res = await fetch('/api/project/reset', { method: 'POST' });
                    const data = await res.json();
                    setInitStatus(data.success ? 'Reset complete!' : `Error: ${data.error}`);
                  } catch (err) { setInitStatus(`Error: ${(err as Error).message}`); }
                  setTimeout(() => setInitStatus(''), 5000);
                }}
                className="text-xs text-yellow-400 hover:text-yellow-300 px-2"
              >
                {t('settings.projectReset') || 'Reset Defaults'}
              </button>
            </div>
            {initStatus && <p className="text-xs text-yellow-400">{initStatus}</p>}
          </div>
        </section>

        {/* CLI Detection */}
        <section className="pt-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">{t('settings.cliTitle') || 'CLI Detection'}</h3>
          <CliDetector />
        </section>

        {/* OpenClaw Migration */}
        <section className="pt-6 pb-8">
          <h3 className="text-sm font-semibold text-gray-300 mb-1">{t('settings.migrateTitle') || 'Migrate from OpenClaw'}</h3>
          <p className="text-xs text-gray-500 mb-3">
            {t('settings.migrateDesc') || 'Import your memory, skills, agents, and config from OpenClaw.'}
          </p>
          <MigrateSection />
        </section>
      </div>
    </div>
  );
}

function CliDetector() {
  const [clis, setClis] = useState<{ name: string; path: string | null; version: string | null }[]>([]);
  const [loading, setLoading] = useState(true);
  const [defaultCli, setDefaultCli] = useState<string>('claude');
  const [savingDefault, setSavingDefault] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/cli-detect')
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setClis(data); })
      .catch(() => {})
      .finally(() => setLoading(false));

    fetch('/api/settings')
      .then(r => r.json())
      .then((data: Record<string, string>) => {
        if (data.default_cli) setDefaultCli(data.default_cli);
      })
      .catch(() => {});
  }, []);

  const setAsDefault = async (cliName: string) => {
    setSavingDefault(cliName);
    try {
      await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ default_cli: cliName }),
      });
      setDefaultCli(cliName);
    } catch {}
    setSavingDefault(null);
  };

  // Only show AI CLIs in the detection section (claude, codex, gemini, opencode)
  const AI_CLIS = ['claude', 'codex', 'gemini', 'opencode'];
  const aiClis = clis.filter(c => AI_CLIS.includes(c.name));
  const otherClis = clis.filter(c => !AI_CLIS.includes(c.name));

  if (loading) return <p className="text-xs text-gray-500">{t('settings.detecting') || 'Detecting CLIs...'}</p>;

  return (
    <div className="space-y-3">
      {aiClis.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500 font-medium">AI CLIs</p>
          {aiClis.map(cli => (
            <div key={cli.name} className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-700">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cli.path ? 'bg-green-400' : 'bg-gray-600'}`} />
              <span className="text-sm text-gray-200 font-medium w-24">{cli.name}</span>
              {cli.path ? (
                <>
                  <span className="text-xs text-gray-400 font-mono truncate flex-1">{cli.path}</span>
                  {cli.version && <span className="badge-green text-xs">{cli.version}</span>}
                  {defaultCli === cli.name ? (
                    <span className="text-xs text-blue-400 font-medium px-2">Default</span>
                  ) : (
                    <button
                      onClick={() => setAsDefault(cli.name)}
                      disabled={savingDefault === cli.name}
                      className="text-xs text-gray-500 hover:text-blue-400 transition-colors px-2 disabled:opacity-50"
                    >
                      {savingDefault === cli.name ? 'Saving...' : 'Set Default'}
                    </button>
                  )}
                </>
              ) : (
                <span className="text-xs text-gray-500 italic flex-1">{t('settings.notInstalled') || 'Not installed'}</span>
              )}
            </div>
          ))}
        </div>
      )}
      {otherClis.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs text-gray-500 font-medium">Other tools</p>
          {otherClis.map(cli => (
            <div key={cli.name} className="flex items-center gap-3 p-2.5 rounded-lg border border-gray-700">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cli.path ? 'bg-green-400' : 'bg-gray-600'}`} />
              <span className="text-sm text-gray-200 font-medium w-24">{cli.name}</span>
              {cli.path ? (
                <>
                  <span className="text-xs text-gray-400 font-mono truncate flex-1">{cli.path}</span>
                  {cli.version && <span className="badge-green text-xs">{cli.version}</span>}
                </>
              ) : (
                <span className="text-xs text-gray-500 italic">{t('settings.notInstalled') || 'Not installed'}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MigrateSection() {
  const [status, setStatus] = useState<'idle' | 'checking' | 'ready' | 'running' | 'done' | 'not-found'>('idle');
  const [output, setOutput] = useState('');

  const checkOpenclaw = async () => {
    setStatus('checking');
    try {
      const res = await fetch('/api/migrate/check');
      const data = await res.json();
      setStatus(data.found ? 'ready' : 'not-found');
      setOutput(data.summary || '');
    } catch {
      setStatus('not-found');
    }
  };

  const runMigration = async () => {
    setStatus('running');
    setOutput('');
    try {
      const res = await fetch('/api/migrate/run', { method: 'POST' });
      const data = await res.json();
      setOutput(data.report || data.error || 'Migration completed.');
      setStatus('done');
    } catch (err) {
      setOutput(`Error: ${(err as Error).message}`);
      setStatus('done');
    }
  };

  useEffect(() => { checkOpenclaw(); }, []);

  return (
    <div className="space-y-3">
      {status === 'checking' && (
        <p className="text-xs text-gray-400">{t('settings.migrateChecking') || 'Checking for OpenClaw installation...'}</p>
      )}
      {status === 'not-found' && (
        <div className="p-3 rounded-lg border border-gray-700 bg-gray-800/50">
          <p className="text-xs text-gray-400">{t('settings.migrateNotFound') || 'OpenClaw not found at ~/.openclaw/'}</p>
          <p className="text-xs text-gray-500 mt-1">{t('settings.migrateNotFoundHint') || 'If installed elsewhere, use the CLI: node scripts/migrate-openclaw.cjs --openclaw-dir /path/to/.openclaw'}</p>
        </div>
      )}
      {status === 'ready' && (
        <div className="space-y-2">
          <div className="p-3 rounded-lg border border-blue-700 bg-blue-900/20">
            <p className="text-xs text-blue-300 whitespace-pre-wrap">{output}</p>
          </div>
          <button onClick={runMigration} className="btn-primary text-xs">
            {t('settings.migrateRun') || 'Start Migration'}
          </button>
        </div>
      )}
      {status === 'running' && (
        <p className="text-xs text-yellow-400">{t('settings.migrateRunning') || 'Migration in progress...'}</p>
      )}
      {status === 'done' && (
        <div className="p-3 rounded-lg border border-green-700 bg-green-900/20">
          <p className="text-xs text-green-300 whitespace-pre-wrap font-mono">{output}</p>
        </div>
      )}
    </div>
  );
}
