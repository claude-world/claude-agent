import { useState, useEffect } from 'react';
import type { McpServerConfig } from '../types';
import { t } from '../i18n';

interface McpEntry {
  name: string;
  config: McpServerConfig;
  enabled: boolean;
}

const KNOWN_SERVERS: Record<string, { tools: number; tier: string; description: string }> = {
  'trend-pulse': { tools: 11, tier: '1', description: 'Trending topics from 20 free sources' },
  'claude-101': { tools: 27, tier: '1', description: '24 use-case templates (email, code, analysis)' },
  'cf-browser': { tools: 15, tier: '2', description: 'Headless Chrome (JS rendering, screenshots)' },
  'notebooklm': { tools: 13, tier: '2', description: 'AI podcasts, slides, reports, research' },
};

const PRESETS: Record<string, McpServerConfig> = {
  'trend-pulse': { type: 'stdio', command: 'uvx', args: ['--from', 'trend-pulse[mcp]', 'trend-pulse-server'] },
  'claude-101': { type: 'stdio', command: 'uvx', args: ['--from', 'claude-101[mcp]', 'claude-101-server'] },
  'cf-browser': { type: 'stdio', command: 'uvx', args: ['--from', 'cf-browser-mcp', 'cf-browser-mcp'], env: { CF_ACCOUNT_ID: '${CF_ACCOUNT_ID}', CF_API_TOKEN: '${CF_API_TOKEN}' } },
  'notebooklm': { type: 'stdio', command: 'uvx', args: ['--from', 'notebooklm-skill', 'notebooklm-mcp'] },
};

export default function McpPage() {
  const [servers, setServers] = useState<McpEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newCommand, setNewCommand] = useState('');
  const [newArgs, setNewArgs] = useState('');
  const [newEnvKey, setNewEnvKey] = useState('');
  const [newEnvVal, setNewEnvVal] = useState('');
  const [status, setStatus] = useState('');

  const fetchServers = async () => {
    try {
      const res = await fetch('/api/mcp');
      const data = await res.json();
      const entries: McpEntry[] = Object.entries(data.mcpServers || {}).map(
        ([name, config]) => ({ name, config: config as McpServerConfig, enabled: true })
      );
      setServers(entries);
    } catch {
      setServers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchServers(); }, []);

  const handleDelete = async (name: string) => {
    try {
      await fetch(`/api/mcp/${name}`, { method: 'DELETE' });
      setStatus(`${t('mcp.deleted') || 'Removed'}: ${name}`);
      fetchServers();
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
  };

  const handleAddPreset = async (name: string) => {
    try {
      await fetch(`/api/mcp/${name}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(PRESETS[name]),
      });
      setStatus(`${t('mcp.added') || 'Added'}: ${name}`);
      fetchServers();
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
  };

  const handleAddCustom = async () => {
    if (!newName.trim() || !newCommand.trim()) return;
    const config: McpServerConfig = {
      type: 'stdio',
      command: newCommand.trim(),
      args: newArgs.trim() ? newArgs.split(/\s+/) : [],
    };
    if (newEnvKey.trim()) {
      config.env = { [newEnvKey.trim()]: newEnvVal.trim() };
    }
    try {
      await fetch(`/api/mcp/${newName.trim()}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      setStatus(`${t('mcp.added') || 'Added'}: ${newName}`);
      setShowAdd(false);
      setNewName(''); setNewCommand(''); setNewArgs(''); setNewEnvKey(''); setNewEnvVal('');
      fetchServers();
      setTimeout(() => setStatus(''), 3000);
    } catch (err) {
      setStatus(`Error: ${(err as Error).message}`);
    }
  };

  const activeNames = new Set(servers.map(s => s.name));
  const availablePresets = Object.keys(PRESETS).filter(n => !activeNames.has(n));

  return (
    <div className="flex flex-col h-full">
      <div className="px-6 pt-8 pb-4 border-b border-gray-700 bg-gray-800 flex-shrink-0 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">{t('mcp.title') || 'MCP Servers'}</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {t('mcp.subtitle') || 'Manage Model Context Protocol servers that provide tools to Claude'}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
        >
          {t('mcp.addCustom') || '+ Add Server'}
        </button>
      </div>

      {status && (
        <div className="px-6 py-2 border-b border-gray-700 bg-green-900/20 flex-shrink-0">
          <p className="text-xs text-green-400">{status}</p>
        </div>
      )}

      {showAdd && (
        <div className="px-6 py-4 border-b border-gray-700 bg-gray-800/50 flex-shrink-0 space-y-3">
          <p className="text-xs text-gray-400 font-medium">{t('mcp.addCustomTitle') || 'Add Custom MCP Server'}</p>
          <div className="grid grid-cols-2 gap-3">
            <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="Server name" className="input-base" />
            <input value={newCommand} onChange={e => setNewCommand(e.target.value)} placeholder="Command (e.g. uvx, npx, python)" className="input-base" />
            <input value={newArgs} onChange={e => setNewArgs(e.target.value)} placeholder="Arguments (space-separated)" className="input-base col-span-2" />
            <input value={newEnvKey} onChange={e => setNewEnvKey(e.target.value)} placeholder="Env var name (optional)" className="input-base" />
            <input value={newEnvVal} onChange={e => setNewEnvVal(e.target.value)} placeholder="Env var value" className="input-base" />
          </div>
          <div className="flex gap-2">
            <button onClick={handleAddCustom} disabled={!newName.trim() || !newCommand.trim()} className="btn-primary text-xs disabled:opacity-50">
              {t('mcp.save') || 'Add'}
            </button>
            <button onClick={() => setShowAdd(false)} className="text-xs text-gray-400 hover:text-gray-200 px-3">
              {t('mcp.cancel') || 'Cancel'}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {loading ? (
          <div className="text-gray-500 text-sm text-center py-8">{t('mcp.loading') || 'Loading...'}</div>
        ) : (
          <>
            {/* Active servers */}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                {t('mcp.active') || 'Active'} ({servers.length})
              </h3>
              {servers.length === 0 ? (
                <p className="text-sm text-gray-500 italic">{t('mcp.noServers') || 'No MCP servers configured.'}</p>
              ) : (
                <div className="space-y-2">
                  {servers.map(({ name, config }) => {
                    const info = KNOWN_SERVERS[name];
                    return (
                      <div key={name} className="card flex items-center gap-4">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="w-2 h-2 rounded-full bg-green-400 flex-shrink-0" />
                            <h4 className="text-sm font-medium text-gray-100">{name}</h4>
                            {info && <span className="badge-gray">{info.tools} tools</span>}
                            {info && (
                              <span className={info.tier === '1' ? 'badge-green' : 'badge-yellow'}>
                                Tier {info.tier}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 ml-4">
                            {info?.description || `${config.command} ${(config.args || []).join(' ')}`}
                          </p>
                          <p className="text-xs text-gray-600 mt-0.5 ml-4 font-mono">
                            {config.command} {(config.args || []).join(' ')}
                          </p>
                          {config.env && Object.keys(config.env).length > 0 && (
                            <p className="text-xs text-gray-600 mt-0.5 ml-4">
                              env: {Object.keys(config.env).join(', ')}
                            </p>
                          )}
                        </div>
                        <button
                          onClick={() => handleDelete(name)}
                          className="text-xs text-red-400 hover:text-red-300 px-2 py-1 flex-shrink-0"
                        >
                          {t('mcp.remove') || 'Remove'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Available presets */}
            {availablePresets.length > 0 && (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  {t('mcp.available') || 'Available to Add'}
                </h3>
                <div className="space-y-2">
                  {availablePresets.map(name => {
                    const info = KNOWN_SERVERS[name];
                    return (
                      <div key={name} className="card flex items-center gap-4 opacity-60 hover:opacity-100 transition-opacity">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="w-2 h-2 rounded-full bg-gray-600 flex-shrink-0" />
                            <h4 className="text-sm font-medium text-gray-300">{name}</h4>
                            {info && <span className="badge-gray">{info.tools} tools</span>}
                            {info && (
                              <span className={info.tier === '1' ? 'badge-green' : 'badge-yellow'}>
                                Tier {info.tier}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 mt-0.5 ml-4">{info?.description}</p>
                        </div>
                        <button
                          onClick={() => handleAddPreset(name)}
                          className="text-xs text-blue-400 hover:text-blue-300 px-3 py-1 border border-blue-600 rounded-lg flex-shrink-0"
                        >
                          {t('mcp.add') || 'Add'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Setup guide */}
            <div className="text-xs text-gray-600 space-y-1 pt-2 pb-8">
              <p className="font-medium text-gray-500">{t('mcp.setupHint') || 'Setup Notes:'}</p>
              <p>Tier 1 (trend-pulse, claude-101): {t('mcp.tier1') || 'Zero auth — works out of the box.'}</p>
              <p>cf-browser: {t('mcp.cfSetup') || 'Set CF_ACCOUNT_ID + CF_API_TOKEN in your shell profile.'}</p>
              <p>notebooklm: {t('mcp.nlmSetup') || 'Run `uvx notebooklm login` once (opens browser for Google login).'}</p>
              <p>{t('mcp.uvxNote') || 'All servers require `uvx`. Install: curl -LsSf https://astral.sh/uv/install.sh | sh'}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
