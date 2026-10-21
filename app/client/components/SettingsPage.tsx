import React, { useState, useEffect } from 'react';
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
  { value: 'opus', label: 'Opus', description: 'Most capable — critical tasks' }
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

  // Multi-LLM Executor state
  const [executorType, setExecutorType] = useState<string>('claude-cli');
  const [anthropicApiKey, setAnthropicApiKey] = useState('');
  const [openaiApiKey, setOpenaiApiKey] = useState('');
  const [openaiModel, setOpenaiModel] = useState('gpt-4o');
  const [grokApiKey, setGrokApiKey] = useState('');
  const [geminiApiKey, setGeminiApiKey] = useState('');
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState('llama3.2');

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        if (data.language) setLanguage(data.language as Language);
        if (data.model_default) setModelDefault(data.model_default as ModelDefault);
        if (data.executor_default) setExecutorType(data.executor_default);
        if (data.executor_anthropic_api_key) setAnthropicApiKey(data.executor_anthropic_api_key);
        if (data.executor_openai_api_key) setOpenaiApiKey(data.executor_openai_api_key);
        if (data.executor_openai_model) setOpenaiModel(data.executor_openai_model);
        if (data.executor_grok_api_key) setGrokApiKey(data.executor_grok_api_key);
        if (data.executor_gemini_api_key) setGeminiApiKey(data.executor_gemini_api_key);
        if (data.executor_ollama_base_url) setOllamaBaseUrl(data.executor_ollama_base_url);
        if (data.executor_ollama_model) setOllamaModel(data.executor_ollama_model);
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
        body: JSON.stringify({
          language,
          model_default: modelDefault,
          executor_default: executorType,
          executor_anthropic_api_key: anthropicApiKey,
          executor_openai_api_key: openaiApiKey,
          executor_openai_model: openaiModel,
          executor_grok_api_key: grokApiKey,
          executor_gemini_api_key: geminiApiKey,
          executor_ollama_base_url: ollamaBaseUrl,
          executor_ollama_model: ollamaModel,
        })
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

        {/* Multi-LLM Executor */}
        <section>
          <h3 className="text-sm font-semibold text-gray-300 mb-1">
            {t('settings.executorTitle') || 'Multi-LLM Executor'}
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            {t('settings.executorSubtitle') || 'Choose which AI provider powers conversations'}
          </p>
          <div className="card space-y-3">
            <div>
              <label className="text-xs text-gray-400 block mb-1">
                {t('settings.executorType') || 'Executor Type'}
              </label>
              <select
                value={executorType}
                onChange={e => setExecutorType(e.target.value)}
                className="input-base w-full text-sm"
              >
                <option value="claude-cli">claude-cli (Claude Code CLI)</option>
                <option value="anthropic-sdk">anthropic-sdk (Anthropic API)</option>
                <option value="openai">openai (OpenAI API)</option>
                <option value="grok">grok (xAI Grok)</option>
                <option value="gemini">gemini (Google Gemini)</option>
                <option value="ollama">ollama (Local Ollama)</option>
                <option value="codex-cli">codex-cli (OpenAI Codex CLI)</option>
                <option value="gemini-cli">gemini-cli (Google Gemini CLI)</option>
                <option value="opencode-cli">opencode-cli (OpenCode CLI)</option>
              </select>
            </div>

            {(executorType === 'claude-cli' || executorType === 'codex-cli' || executorType === 'gemini-cli' || executorType === 'opencode-cli') && (
              <p className="text-xs text-gray-500 mt-1">
                {t('settings.executorCliNote') || 'Uses CLI tool directly — no API key needed. Ensure the CLI is installed and in PATH.'}
              </p>
            )}

            {executorType === 'anthropic-sdk' && (
              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  {t('settings.executorAnthropicKey') || 'Anthropic API Key'}
                </label>
                <input
                  type="password"
                  value={anthropicApiKey}
                  onChange={e => setAnthropicApiKey(e.target.value)}
                  placeholder="sk-ant-..."
                  className="input-base w-full text-sm font-mono"
                />
              </div>
            )}

            {executorType === 'openai' && (
              <>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    {t('settings.executorOpenAiKey') || 'OpenAI API Key'}
                  </label>
                  <input
                    type="password"
                    value={openaiApiKey}
                    onChange={e => setOpenaiApiKey(e.target.value)}
                    placeholder="sk-..."
                    className="input-base w-full text-sm font-mono"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    {t('settings.executorOpenAiModel') || 'OpenAI Model'}
                  </label>
                  <input
                    type="text"
                    value={openaiModel}
                    onChange={e => setOpenaiModel(e.target.value)}
                    placeholder="gpt-4o"
                    className="input-base w-full text-sm"
                  />
                </div>
              </>
            )}

            {executorType === 'grok' && (
              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  {t('settings.executorGrokKey') || 'Grok API Key (xAI)'}
                </label>
                <input
                  type="password"
                  value={grokApiKey}
                  onChange={e => setGrokApiKey(e.target.value)}
                  placeholder="xai-..."
                  className="input-base w-full text-sm font-mono"
                />
              </div>
            )}

            {executorType === 'gemini' && (
              <div>
                <label className="text-xs text-gray-400 block mb-1">
                  {t('settings.executorGeminiKey') || 'Gemini API Key'}
                </label>
                <input
                  type="password"
                  value={geminiApiKey}
                  onChange={e => setGeminiApiKey(e.target.value)}
                  placeholder="AIza..."
                  className="input-base w-full text-sm font-mono"
                />
              </div>
            )}

            {executorType === 'ollama' && (
              <>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    {t('settings.executorOllamaUrl') || 'Ollama Base URL'}
                  </label>
                  <input
                    type="text"
                    value={ollamaBaseUrl}
                    onChange={e => setOllamaBaseUrl(e.target.value)}
                    placeholder="http://localhost:11434"
                    className="input-base w-full text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 block mb-1">
                    {t('settings.executorOllamaModel') || 'Ollama Model'}
                  </label>
                  <input
                    type="text"
                    value={ollamaModel}
                    onChange={e => setOllamaModel(e.target.value)}
                    placeholder="llama3.2"
                    className="input-base w-full text-sm"
                  />
                </div>
              </>
            )}
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

        {/* Updates */}
        <section className="pt-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-1">{t('settings.updatesTitle')}</h3>
          <p className="text-xs text-gray-500 mb-3">{t('settings.updatesDesc')}</p>
          <UpdateChecker />
        </section>

        {/* Auto-start on Boot */}
        <section className="pt-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-1">{t('settings.autostartTitle')}</h3>
          <p className="text-xs text-gray-500 mb-3">{t('settings.autostartDesc')}</p>
          <AutostartToggle />
        </section>

        {/* Webhook Secret */}
        <section className="pt-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-1">{t('settings.webhookTitle')}</h3>
          <p className="text-xs text-gray-500 mb-3">{t('settings.webhookDesc')}</p>
          <WebhookSecretSection />
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

// ── Update checker UI ────────────────────────────────────────────────────────

function UpdateChecker() {
  const [info, setInfo] = useState<{
    currentVersion: string;
    latestVersion: string | null;
    hasUpdate: boolean;
    lastChecked: string | null;
    releaseUrl: string | null;
  } | null>(null);
  const [desktopState, setDesktopState] = useState<DesktopUpdateState | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/update-info')
      .then(r => r.json())
      .then(setInfo)
      .catch(() => {});

    if (!window.claudeAgentDesktop) return;

    window.claudeAgentDesktop.getUpdateState()
      .then(setDesktopState)
      .catch(() => {});

    return window.claudeAgentDesktop.onUpdateState(setDesktopState);
  }, []);

  const checkNow = async () => {
    setChecking(true);
    setCheckError(null);

    let nextError: string | null = null;

    try {
      const res = await fetch('/api/check-update', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setInfo(data);
    } catch (err) {
      nextError = (err as Error).message;
    }

    if (window.claudeAgentDesktop) {
      try {
        const state = await window.claudeAgentDesktop.checkForUpdates();
        setDesktopState(state);
      } catch (err) {
        nextError ||= (err as Error).message;
      }
    }

    setCheckError(nextError);
    setChecking(false);
  };

  const installNow = async () => {
    if (!window.claudeAgentDesktop) return;
    setCheckError(null);
    try {
      const result = await window.claudeAgentDesktop.installUpdate();
      if (!result.ok) setCheckError('Update is not ready to install yet.');
    } catch (err) {
      setCheckError((err as Error).message);
    }
  };

  const effectiveCurrentVersion = desktopState?.currentVersion || info?.currentVersion || '…';
  const effectiveLatestVersion = desktopState?.latestVersion || info?.latestVersion || null;
  const hasDesktopUpdate = Boolean(desktopState?.available || desktopState?.downloaded);
  const hasAnyUpdate = hasDesktopUpdate || Boolean(info?.hasUpdate);
  const isBusy = checking || Boolean(desktopState?.checking || desktopState?.downloading);

  return (
    <div className="p-3 rounded-lg border border-gray-700 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">{t('settings.updateCurrentVersion')}</span>
            <span className="badge-gray font-mono">v{effectiveCurrentVersion}</span>
            {desktopState?.downloaded && (
              <span className="badge-green text-xs">{t('settings.updateReady') || 'Ready to install'}</span>
            )}
            {desktopState?.downloading && (
              <span className="badge text-xs bg-blue-500/20 text-blue-300 border border-blue-600 px-1.5 py-0.5 rounded">
                {t('settings.updateDownloading') || 'Downloading'} {desktopState.progressPercent ?? 0}%
              </span>
            )}
            {!desktopState?.downloaded && !desktopState?.downloading && hasAnyUpdate && effectiveLatestVersion && (
              <span className="badge text-xs bg-yellow-500/20 text-yellow-300 border border-yellow-600 px-1.5 py-0.5 rounded">
                v{effectiveLatestVersion} {t('settings.updateAvailable')}
              </span>
            )}
            {info && !hasAnyUpdate && info.latestVersion && (
              <span className="badge-green text-xs">{t('settings.updateUpToDate')}</span>
            )}
          </div>
          {info?.lastChecked && (
            <p className="text-xs text-gray-600">
              {t('settings.updateLastChecked')} {new Date(info.lastChecked).toLocaleString()}
            </p>
          )}
          {desktopState?.supported && (
            <p className="text-xs text-gray-500">{t('settings.updateAutoHint') || 'Desktop app updates download in the background and can be installed here once ready.'}</p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {desktopState?.downloaded && (
            <button
              onClick={installNow}
              className="btn-primary text-xs py-1.5 px-3 flex-shrink-0"
            >
              {t('settings.updateInstallNow') || 'Install & Restart'}
            </button>
          )}
          <button
            onClick={checkNow}
            disabled={isBusy}
            className="btn-secondary text-xs py-1.5 px-3 flex-shrink-0"
          >
            {desktopState?.downloading
              ? `${t('settings.updateDownloading') || 'Downloading'}…`
              : isBusy
                ? t('settings.updateChecking')
                : t('settings.updateCheckNow')}
          </button>
        </div>
      </div>

      {(desktopState?.error || checkError) && (
        <p className="text-xs text-red-400">{desktopState?.error || checkError}</p>
      )}
      {hasAnyUpdate && info?.releaseUrl && (
        <div className="p-2.5 rounded border border-yellow-700 bg-yellow-900/20 flex items-center justify-between gap-3">
          <p className="text-xs text-yellow-300">{t('settings.updateBanner', { version: `v${effectiveLatestVersion}` })}</p>
          <a
            href={info.releaseUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-yellow-400 hover:text-yellow-300 whitespace-nowrap flex-shrink-0"
          >
            {t('settings.updateViewRelease')}
          </a>
        </div>
      )}
    </div>
  );
}

// ── Auto-start toggle UI ─────────────────────────────────────────────────────

function AutostartToggle() {
  const [status, setStatus] = useState<{
    enabled: boolean;
    platform: string;
    servicePath: string;
    error?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/autostart')
      .then(r => r.json())
      .then(setStatus)
      .catch(() => {});
  }, []);

  const toggle = async () => {
    if (!status) return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/autostart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !status.enabled }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setStatus(data);
    } catch (err) {
      setSaveError((err as Error).message);
    }
    setSaving(false);
  };

  if (!status) return <p className="text-xs text-gray-500">Loading…</p>;

  return (
    <div className="p-3 rounded-lg border border-gray-700 space-y-3">
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${status.enabled ? 'bg-green-400' : 'bg-gray-600'}`} />
            <span className="text-sm text-gray-200 font-medium">
              {status.enabled ? t('settings.autostartEnabled') : t('settings.autostartDisabled')}
            </span>
            <span className="text-xs text-gray-500">{status.platform}</span>
          </div>
          {status.servicePath && (
            <p className="text-xs text-gray-600 font-mono ml-4">{status.servicePath}</p>
          )}
        </div>
        <button
          onClick={toggle}
          disabled={saving || !!status.error}
          className={`flex-shrink-0 relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none disabled:opacity-50 ${
            status.enabled ? 'bg-blue-600' : 'bg-gray-600'
          }`}
          title={status.error ? `Unsupported: ${status.error}` : undefined}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
              status.enabled ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      {saveError && <p className="text-xs text-red-400">{saveError}</p>}
      {status.error && (
        <p className="text-xs text-yellow-500">{status.error}</p>
      )}
    </div>
  );
}

// ── Webhook secret UI ────────────────────────────────────────────────────────

function WebhookSecretSection() {
  const [secret, setSecret] = useState('');
  // isPlaceholder: true when the displayed value is the masked "•••" sentinel,
  // not a real value the user has typed or generated. Saving in this state is a no-op.
  const [isPlaceholder, setIsPlaceholder] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    fetch('/api/settings')
      .then(r => r.json())
      .then((data: Record<string, string>) => {
        if (data.webhook_secret_set === 'true') {
          setSecret('••••••••••••••••');
          setIsPlaceholder(true);
        }
      })
      .catch(() => {});
  }, []);

  const generate = () => {
    // 64-char base64url alphabet avoids modulo bias with 256-byte values
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    setSecret(Array.from(arr, b => chars[b % chars.length]).join(''));
    setIsPlaceholder(false);
    setSaved(false);
  };

  const clear = () => { setSecret(''); setIsPlaceholder(false); setSaved(false); };

  const save = async () => {
    if (isPlaceholder) return; // nothing changed — don't overwrite with placeholder
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_secret: secret }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setSaved(true);
      if (!secret) setIsPlaceholder(false); // secret was cleared
      setTimeout(() => setSaved(false), 3000);
    } catch (err) {
      setSaveError((err as Error).message);
    }
    setSaving(false);
  };

  return (
    <div className="p-3 rounded-lg border border-gray-700 space-y-3">
      <div className="flex items-center gap-2">
        <input
          type={show ? 'text' : 'password'}
          value={secret}
          onChange={e => { setSecret(e.target.value); setIsPlaceholder(false); setSaved(false); }}
          placeholder={t('settings.webhookPlaceholder')}
          className="input-base flex-1 text-xs font-mono"
        />
        <button
          onClick={() => setShow(s => !s)}
          className="btn-secondary text-xs py-1.5 px-3 flex-shrink-0"
        >
          {show ? t('secrets.hide') : t('secrets.show')}
        </button>
        <button
          onClick={generate}
          className="btn-secondary text-xs py-1.5 px-3 flex-shrink-0"
        >
          {t('settings.webhookGenerate')}
        </button>
        {isPlaceholder ? (
          <button
            onClick={clear}
            className="btn-secondary text-xs py-1.5 px-3 flex-shrink-0 text-red-400 hover:text-red-300"
          >
            Clear
          </button>
        ) : (
          <button
            onClick={save}
            disabled={saving}
            className="btn-primary text-xs py-1.5 px-3 flex-shrink-0"
          >
            {saving ? t('settings.webhookSaving') : t('settings.webhookSave')}
          </button>
        )}
      </div>
      {isPlaceholder && (
        <p className="text-xs text-gray-500">A secret is already set. Generate a new one or click Clear to remove it.</p>
      )}
      {saved && <p className="text-xs text-green-400">{t('settings.webhookSaved')}</p>}
      {saveError && <p className="text-xs text-red-400">{saveError}</p>}
      <p className="text-xs text-gray-600">{t('settings.webhookEndpointHint')}</p>
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
