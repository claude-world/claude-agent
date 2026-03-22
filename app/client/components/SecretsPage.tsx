import { useState, useEffect, useCallback } from 'react';
import type { Secret } from '../types';
import { t } from '../i18n';

const PRESETS: { name: string; description: string; category: Secret['category'] }[] = [
  { name: 'OPENAI_API_KEY', description: 'OpenAI API key (for /image-gen, /speech-to-text)', category: 'api' },
  { name: 'THREADS_TOKEN', description: 'Meta Threads publishing token', category: 'social' },
  { name: 'SLACK_TOKEN', description: 'Slack bot token (for /slack-ops)', category: 'social' },
  { name: 'TRELLO_API_KEY', description: 'Trello API key', category: 'api' },
  { name: 'TRELLO_TOKEN', description: 'Trello auth token', category: 'api' },
  { name: 'NOTION_API_KEY', description: 'Notion integration token', category: 'api' },
  { name: 'GOOGLE_PLACES_API_KEY', description: 'Google Places API key', category: 'api' },
  { name: 'ELEVENLABS_API_KEY', description: 'ElevenLabs TTS API key', category: 'api' },
  { name: 'CF_ACCOUNT_ID', description: 'Cloudflare Account ID', category: 'mcp' },
  { name: 'CF_API_TOKEN', description: 'Cloudflare API token', category: 'mcp' },
  { name: 'GH_TOKEN', description: 'GitHub personal access token', category: 'api' },
];

const CATEGORY_BADGES: Record<Secret['category'], string> = {
  general: 'badge-gray',
  social: 'badge-blue',
  api: 'badge-green',
  mcp: 'badge-purple',
};

const CATEGORY_LABELS: Record<Secret['category'], string> = {
  general: 'general',
  social: 'social',
  api: 'api',
  mcp: 'mcp',
};

interface EditForm {
  value: string;
  description: string;
  category: Secret['category'];
}

export default function SecretsPage() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState('');

  // Add form state
  const [addName, setAddName] = useState('');
  const [addValue, setAddValue] = useState('');
  const [addDesc, setAddDesc] = useState('');
  const [addCategory, setAddCategory] = useState<Secret['category']>('general');

  // Edit form state (keyed by id)
  const [editForms, setEditForms] = useState<Record<string, EditForm>>({});

  const fetchSecrets = useCallback(async () => {
    try {
      const res = await fetch('/api/secrets');
      const data = await res.json();
      if (Array.isArray(data)) setSecrets(data);
    } catch {
      setSecrets([]);
    }
  }, []);

  useEffect(() => { fetchSecrets(); }, [fetchSecrets]);

  const showStatus = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(''), 3000);
  };

  const handleCreate = async () => {
    if (!addName.trim() || !addValue.trim()) return;
    try {
      await fetch('/api/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: addName.trim(),
          value: addValue.trim(),
          description: addDesc.trim(),
          category: addCategory,
        }),
      });
      setShowAdd(false);
      setAddName('');
      setAddValue('');
      setAddDesc('');
      setAddCategory('general');
      fetchSecrets();
      showStatus('Secret saved.');
    } catch (err) {
      showStatus(`Error: ${(err as Error).message}`);
    }
  };

  const handleStartEdit = (secret: Secret) => {
    setEditingId(secret.id);
    setEditForms(prev => ({
      ...prev,
      [secret.id]: { value: '', description: secret.description, category: secret.category },
    }));
  };

  const handleUpdate = async (id: string) => {
    const form = editForms[id];
    if (!form) return;
    try {
      const body: Partial<EditForm> = {
        description: form.description,
        category: form.category,
      };
      if (form.value.trim()) body.value = form.value.trim();
      await fetch(`/api/secrets/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setEditingId(null);
      fetchSecrets();
      showStatus('Secret updated.');
    } catch (err) {
      showStatus(`Error: ${(err as Error).message}`);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete secret "${name}"?`)) return;
    try {
      await fetch(`/api/secrets/${id}`, { method: 'DELETE' });
      fetchSecrets();
      showStatus(`Deleted: ${name}`);
    } catch (err) {
      showStatus(`Error: ${(err as Error).message}`);
    }
  };

  const toggleReveal = (id: string) => {
    setRevealedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePresetClick = (preset: typeof PRESETS[number]) => {
    setAddName(preset.name);
    setAddDesc(preset.description);
    setAddCategory(preset.category);
    setAddValue('');
    setShowAdd(true);
  };

  const handleNameInput = (val: string) => {
    setAddName(val.toUpperCase().replace(/\s+/g, '_'));
  };

  const filtered = search.trim()
    ? secrets.filter(s =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        s.description.toLowerCase().includes(search.toLowerCase())
      )
    : secrets;

  const existingNames = new Set(secrets.map(s => s.name));
  const availablePresets = PRESETS.filter(p => !existingNames.has(p.name));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 border-b border-gray-700 bg-gray-800 flex-shrink-0 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">{t('secrets.title')}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{t('secrets.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowAdd(v => !v)}
          className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
        >
          {t('secrets.add')}
        </button>
      </div>

      {/* Status banner */}
      {status && (
        <div className="px-6 py-2 border-b border-gray-700 bg-green-900/20 flex-shrink-0">
          <p className="text-xs text-green-400">{status}</p>
        </div>
      )}

      {/* Injected note */}
      <div className="px-6 py-2 border-b border-gray-700 bg-gray-800/30 flex-shrink-0">
        <p className="text-xs text-gray-500">{t('secrets.injected')}</p>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="px-6 py-4 border-b border-gray-700 bg-gray-800/50 flex-shrink-0 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <input
              value={addName}
              onChange={e => handleNameInput(e.target.value)}
              placeholder={t('secrets.namePlaceholder')}
              className="input-base font-mono"
            />
            <select
              value={addCategory}
              onChange={e => setAddCategory(e.target.value as Secret['category'])}
              className="input-base"
            >
              <option value="general">general</option>
              <option value="social">social</option>
              <option value="api">api</option>
              <option value="mcp">mcp</option>
            </select>
            <input
              type="password"
              value={addValue}
              onChange={e => setAddValue(e.target.value)}
              placeholder={t('secrets.valuePlaceholder')}
              className="input-base col-span-2"
            />
            <input
              value={addDesc}
              onChange={e => setAddDesc(e.target.value)}
              placeholder={t('secrets.descPlaceholder')}
              className="input-base col-span-2"
            />
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={!addName.trim() || !addValue.trim()}
              className="btn-primary text-xs disabled:opacity-50"
            >
              {t('secrets.save')}
            </button>
            <button
              onClick={() => { setShowAdd(false); setAddName(''); setAddValue(''); setAddDesc(''); setAddCategory('general'); }}
              className="text-xs text-gray-400 hover:text-gray-200 px-3"
            >
              {t('secrets.cancel')}
            </button>
          </div>
        </div>
      )}

      {/* Main scrollable area */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
        {/* Search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('secrets.search')}
          className="input-base w-full"
        />

        {/* Secrets list */}
        {filtered.length === 0 ? (
          <p className="text-sm text-gray-500 italic">{t('secrets.noSecrets')}</p>
        ) : (
          <div className="space-y-2">
            {filtered.map(secret => {
              const isEditing = editingId === secret.id;
              const isRevealed = revealedIds.has(secret.id);
              const form = editForms[secret.id];

              return (
                <div key={secret.id} className="card space-y-2">
                  {/* Top row: name + category + actions */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono font-bold text-sm text-gray-100">{secret.name}</span>
                    <span className={CATEGORY_BADGES[secret.category]}>
                      {CATEGORY_LABELS[secret.category]}
                    </span>
                    <div className="flex-1" />
                    {!isEditing && (
                      <>
                        <button
                          onClick={() => handleStartEdit(secret)}
                          className="text-xs text-blue-400 hover:text-blue-300"
                        >
                          {t('secrets.edit')}
                        </button>
                        <button
                          onClick={() => handleDelete(secret.id, secret.name)}
                          className="text-xs text-red-400 hover:text-red-300"
                        >
                          {t('secrets.delete')}
                        </button>
                      </>
                    )}
                  </div>

                  {/* Description */}
                  {secret.description && !isEditing && (
                    <p className="text-xs text-gray-500">{secret.description}</p>
                  )}

                  {/* Value row (view mode) */}
                  {!isEditing && (
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs text-gray-400 flex-1 truncate">
                        {isRevealed ? secret.value : '••••••••••••'}
                      </span>
                      <button
                        onClick={() => toggleReveal(secret.id)}
                        className="text-xs text-gray-500 hover:text-gray-300 flex-shrink-0"
                      >
                        {isRevealed ? t('secrets.hide') : t('secrets.show')}
                      </button>
                    </div>
                  )}

                  {/* Edit form (inline) */}
                  {isEditing && form && (
                    <div className="space-y-2 pt-1">
                      <input
                        type="password"
                        value={form.value}
                        onChange={e => setEditForms(prev => ({ ...prev, [secret.id]: { ...prev[secret.id], value: e.target.value } }))}
                        placeholder="New value (leave blank to keep existing)"
                        className="input-base w-full"
                      />
                      <input
                        value={form.description}
                        onChange={e => setEditForms(prev => ({ ...prev, [secret.id]: { ...prev[secret.id], description: e.target.value } }))}
                        placeholder={t('secrets.descPlaceholder')}
                        className="input-base w-full"
                      />
                      <select
                        value={form.category}
                        onChange={e => setEditForms(prev => ({ ...prev, [secret.id]: { ...prev[secret.id], category: e.target.value as Secret['category'] } }))}
                        className="input-base"
                      >
                        <option value="general">general</option>
                        <option value="social">social</option>
                        <option value="api">api</option>
                        <option value="mcp">mcp</option>
                      </select>
                      <div className="flex gap-2">
                        <button onClick={() => handleUpdate(secret.id)} className="btn-primary text-xs">
                          {t('secrets.save')}
                        </button>
                        <button onClick={() => setEditingId(null)} className="text-xs text-gray-400 hover:text-gray-200 px-3">
                          {t('secrets.cancel')}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Preset suggestions */}
        {availablePresets.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
              {t('secrets.presets')}
            </h3>
            <p className="text-xs text-gray-600 mb-3">{t('secrets.presetsHint')}</p>
            <div className="space-y-2">
              {availablePresets.map(preset => (
                <div
                  key={preset.name}
                  className="card flex items-center gap-4 opacity-60 hover:opacity-100 transition-opacity"
                >
                  <div className="flex-1 min-w-0">
                    <span className="font-mono font-medium text-sm text-gray-300">{preset.name}</span>
                    <p className="text-xs text-gray-500 mt-0.5">{preset.description}</p>
                  </div>
                  <button
                    onClick={() => handlePresetClick(preset)}
                    className="text-xs text-blue-400 hover:text-blue-300 px-3 py-1 border border-blue-600 rounded-lg flex-shrink-0"
                  >
                    {t('secrets.add').replace('+ ', '')}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="pb-8" />
      </div>
    </div>
  );
}
