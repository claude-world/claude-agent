import { useState, useEffect } from 'react';
import type { Role, RoleAssignment, RoleMemory } from '../types';
import { t } from '../i18n';

const LANGUAGE_OPTIONS = [
  { value: 'en', label: 'English' },
  { value: 'zh-TW', label: '繁體中文' },
  { value: 'ja', label: '日本語' },
];

const REPLY_STYLE_OPTIONS = [
  { value: 'concise', labelKey: 'roles.concise' },
  { value: 'detailed', labelKey: 'roles.detailed' },
  { value: 'casual', labelKey: 'roles.casual' },
  { value: 'formal', labelKey: 'roles.formal' },
];

const PLATFORM_OPTIONS = ['telegram', 'discord'] as const;

interface RoleFormData {
  name: string;
  personality: string;
  language: string;
  reply_style: string;
  reply_mode: string;
  reply_keywords: string[];
  allowed_skills: string;
  knowledge_context: string;
}

const emptyForm = (): RoleFormData => ({
  name: '',
  personality: '',
  language: 'en',
  reply_style: 'concise',
  reply_mode: 'smart',
  reply_keywords: [] as string[],
  allowed_skills: '',
  knowledge_context: '',
});

interface RoleFormProps {
  initial?: RoleFormData;
  onSave: (data: RoleFormData) => Promise<void>;
  onCancel: () => void;
  submitLabel: string;
}

function RoleForm({ initial, onSave, onCancel, submitLabel }: RoleFormProps) {
  const [form, setForm] = useState<RoleFormData>(initial ?? emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      setError(t('roles.name') + ' is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(form);
    } catch (err) {
      setError(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const set = (field: keyof RoleFormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(prev => ({ ...prev, [field]: e.target.value }));

  return (
    <form onSubmit={handleSubmit} className="card border-blue-700 space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-400 mb-1">{t('roles.name')}</label>
          <input
            type="text"
            value={form.name}
            onChange={set('name')}
            placeholder="e.g. Support Bot, Sales Assistant"
            className="input-base w-full"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">{t('roles.language')}</label>
          <select value={form.language} onChange={set('language')} className="input-base w-full">
            {LANGUAGE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">{t('roles.replyStyle')}</label>
          <select value={form.reply_style} onChange={set('reply_style')} className="input-base w-full">
            {REPLY_STYLE_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">{t('roles.replyMode')}</label>
          <select
            value={form.reply_mode || 'smart'}
            onChange={e => setForm(prev => ({ ...prev, reply_mode: e.target.value }))}
            className="input-base w-full"
          >
            <option value="always">{t('roles.replyAlways')}</option>
            <option value="mention">{t('roles.replyMention')}</option>
            <option value="smart">{t('roles.replySmart')}</option>
            <option value="keywords">{t('roles.replyKeywords')}</option>
            <option value="never">{t('roles.replyNever')}</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">{t('roles.replyModeHint')}</p>
        </div>

        {form.reply_mode === 'keywords' && (
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-400 mb-1">{t('roles.replyKeywordsList')}</label>
            <input
              type="text"
              value={(form.reply_keywords || []).join(', ')}
              onChange={e => setForm(prev => ({ ...prev, reply_keywords: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
              className="input-base w-full"
              placeholder="help, weather, remind, 幫忙, 天氣"
            />
          </div>
        )}

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-400 mb-1">{t('roles.personality')}</label>
          <textarea
            value={form.personality}
            onChange={set('personality')}
            rows={4}
            placeholder="Describe the personality, tone, and behavior of this role..."
            className="input-base w-full resize-none"
          />
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-400 mb-1">
            {t('roles.skills')}{' '}
            <span className="text-gray-600 font-normal">(comma-separated, optional)</span>
          </label>
          <input
            type="text"
            value={form.allowed_skills}
            onChange={set('allowed_skills')}
            placeholder="e.g. weather, places, quick-research"
            className="input-base w-full"
          />
        </div>

        <div className="col-span-2">
          <label className="block text-xs font-medium text-gray-400 mb-1">{t('roles.knowledge')}</label>
          <textarea
            value={form.knowledge_context}
            onChange={set('knowledge_context')}
            rows={4}
            placeholder="Markdown — background knowledge, FAQs, product info..."
            className="input-base w-full resize-none font-mono text-xs"
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="btn-primary text-xs py-1.5">
          {saving ? 'Saving...' : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-1.5">
          {t('roles.cancel') || 'Cancel'}
        </button>
      </div>
    </form>
  );
}

interface RoleCardProps {
  role: Role;
  onEdit: (role: Role) => void;
  onDelete: (id: string) => void;
}

function RoleCard({ role, onEdit, onDelete }: RoleCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  const langLabel = LANGUAGE_OPTIONS.find(l => l.value === role.language)?.label ?? role.language;

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-medium text-gray-100">{role.name}</h4>
            <span className="badge-blue text-xs">{langLabel}</span>
            <span className="badge-gray text-xs capitalize">{role.reply_style}</span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              (role as any).reply_mode === 'smart' || !(role as any).reply_mode ? 'bg-green-900 text-green-300' :
              (role as any).reply_mode === 'always' ? 'bg-yellow-900 text-yellow-300' :
              (role as any).reply_mode === 'never' ? 'bg-red-900 text-red-300' :
              'bg-blue-900 text-blue-300'
            }`}>
              {(role as any).reply_mode || 'smart'}
            </span>
            {role.allowed_skills.length > 0 && (
              <span className="text-xs text-gray-500">
                {role.allowed_skills.length} skill{role.allowed_skills.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          {role.personality && (
            <p className="text-xs text-gray-500 mt-1 line-clamp-2">{role.personality}</p>
          )}
          <p className="text-xs text-gray-600 mt-1">
            Updated: {new Date(role.updated_at).toLocaleDateString()}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => onEdit(role)}
            className="text-xs text-blue-400 hover:text-blue-300"
          >
            {t('roles.edit')}
          </button>
          {confirmDelete ? (
            <div className="flex gap-1">
              <button
                onClick={() => onDelete(role.id)}
                className="btn-danger text-xs py-1 px-2"
              >
                Confirm
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="btn-secondary text-xs py-1 px-2"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-gray-600 hover:text-red-400 transition-colors"
            >
              {t('roles.delete')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface AssignmentSectionProps {
  roles: Role[];
}

function AssignmentSection({ roles }: AssignmentSectionProps) {
  const [assignments, setAssignments] = useState<RoleAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [chatId, setChatId] = useState('');
  const [selectedRoleId, setSelectedRoleId] = useState('');
  const [platform, setPlatform] = useState<'telegram' | 'discord'>('telegram');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expandedMemory, setExpandedMemory] = useState<string | null>(null);
  const [memoryData, setMemoryData] = useState<Record<string, RoleMemory[]>>({});

  useEffect(() => {
    fetch('/api/roles/assignments')
      .then(r => r.json())
      .then((data: RoleAssignment[]) => {
        if (Array.isArray(data)) setAssignments(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleAssign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatId.trim() || !selectedRoleId) {
      setError('Chat ID and role are required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch(`/api/roles/${selectedRoleId}/assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId.trim(), platform }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const assignment: RoleAssignment = await res.json();
      setAssignments(prev => [...prev.filter(a => a.chat_id !== assignment.chat_id), assignment]);
      setChatId('');
    } catch (err) {
      setError(`Assign failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUnassign = async (roleId: string, chatId: string) => {
    try {
      await fetch(`/api/roles/${roleId}/assign/${chatId}`, { method: 'DELETE' });
      setAssignments(prev => prev.filter(a => a.chat_id !== chatId));
    } catch {}
  };

  const loadMemory = async (chatId: string) => {
    if (expandedMemory === chatId) {
      setExpandedMemory(null);
      return;
    }
    setExpandedMemory(chatId);
    if (!memoryData[chatId]) {
      try {
        const res = await fetch(`/api/roles/memory/${chatId}`);
        const data: RoleMemory[] = await res.json();
        setMemoryData(prev => ({ ...prev, [chatId]: Array.isArray(data) ? data : [] }));
      } catch {
        setMemoryData(prev => ({ ...prev, [chatId]: [] }));
      }
    }
  };

  return (
    <div className="space-y-4">
      {/* Assign form */}
      <div className="card border-gray-700">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          {t('roles.assign')}
        </h3>
        <form onSubmit={handleAssign} className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <input
              type="text"
              value={chatId}
              onChange={e => setChatId(e.target.value)}
              placeholder="chat_id or @username"
              className="input-base col-span-1"
            />
            <select
              value={selectedRoleId}
              onChange={e => setSelectedRoleId(e.target.value)}
              className="input-base col-span-1"
            >
              <option value="">Select role...</option>
              {roles.map(r => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
            <select
              value={platform}
              onChange={e => setPlatform(e.target.value as 'telegram' | 'discord')}
              className="input-base col-span-1"
            >
              {PLATFORM_OPTIONS.map(p => (
                <option key={p} value={p} className="capitalize">{p}</option>
              ))}
            </select>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button type="submit" disabled={saving} className="btn-primary text-xs py-1.5">
            {saving ? 'Assigning...' : t('roles.assign')}
          </button>
        </form>
      </div>

      {/* Assignment list */}
      {loading ? (
        <div className="text-xs text-gray-500 py-4 text-center">Loading assignments...</div>
      ) : assignments.length === 0 ? (
        <div className="text-xs text-gray-600 italic py-4 text-center">No assignments yet</div>
      ) : (
        <div className="space-y-2">
          {assignments.map(assignment => (
            <div key={assignment.chat_id} className="card space-y-2">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-sm text-gray-200">{assignment.chat_id}</span>
                  <span className="badge-gray text-xs capitalize">{assignment.platform}</span>
                  {assignment.role_name && (
                    <span className="badge-blue text-xs">{assignment.role_name}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={() => loadMemory(assignment.chat_id)}
                    className="text-xs text-gray-500 hover:text-gray-300"
                  >
                    {expandedMemory === assignment.chat_id ? '▲' : '▼'} {t('roles.memory')}
                  </button>
                  <button
                    onClick={() => handleUnassign(assignment.role_id, assignment.chat_id)}
                    className="text-xs text-red-400 hover:text-red-300"
                  >
                    {t('roles.unassign')}
                  </button>
                </div>
              </div>

              {/* Memory viewer */}
              {expandedMemory === assignment.chat_id && (
                <div className="mt-2 border-t border-gray-700 pt-2">
                  {!memoryData[assignment.chat_id] ? (
                    <p className="text-xs text-gray-500">Loading memory...</p>
                  ) : memoryData[assignment.chat_id].length === 0 ? (
                    <p className="text-xs text-gray-600 italic">No memory entries</p>
                  ) : (
                    <div className="space-y-1">
                      {memoryData[assignment.chat_id].map(entry => (
                        <div key={entry.id} className="flex gap-3 text-xs">
                          <span className="font-mono text-blue-400 flex-shrink-0">{entry.key}</span>
                          <span className="text-gray-400 truncate">{entry.value}</span>
                          <span className="text-gray-600 flex-shrink-0">
                            {new Date(entry.updated_at).toLocaleDateString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [activeTab, setActiveTab] = useState<'roles' | 'assignments'>('roles');

  const fetchRoles = () => {
    fetch('/api/roles')
      .then(r => r.json())
      .then((data: Role[]) => {
        if (Array.isArray(data)) setRoles(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchRoles();
  }, []);

  const roleToForm = (role: Role): RoleFormData => ({
    name: role.name,
    personality: role.personality,
    language: role.language,
    reply_style: role.reply_style,
    reply_mode: (role as any).reply_mode || 'smart',
    reply_keywords: (role as any).reply_keywords || [],
    allowed_skills: role.allowed_skills.join(', '),
    knowledge_context: role.knowledge_context,
  });

  const handleCreate = async (data: RoleFormData) => {
    const res = await fetch('/api/roles', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...data,
        allowed_skills: data.allowed_skills.split(',').map(s => s.trim()).filter(Boolean),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const created: Role = await res.json();
    setRoles(prev => [...prev, created]);
    setShowCreate(false);
  };

  const handleUpdate = async (data: RoleFormData) => {
    if (!editingRole) return;
    const res = await fetch(`/api/roles/${editingRole.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...data,
        allowed_skills: data.allowed_skills.split(',').map(s => s.trim()).filter(Boolean),
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const updated: Role = await res.json();
    setRoles(prev => prev.map(r => r.id === updated.id ? updated : r));
    setEditingRole(null);
  };

  const handleDelete = async (id: string) => {
    setRoles(prev => prev.filter(r => r.id !== id));
    try {
      await fetch(`/api/roles/${id}`, { method: 'DELETE' });
    } catch {}
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">{t('roles.title')}</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Create personas for different channels and chat groups
            </p>
          </div>
          {activeTab === 'roles' && !showCreate && !editingRole && (
            <button
              onClick={() => setShowCreate(true)}
              className="btn-secondary text-xs py-1.5"
            >
              {t('roles.create')}
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          <button
            onClick={() => setActiveTab('roles')}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              activeTab === 'roles'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t('roles.title')}
          </button>
          <button
            onClick={() => setActiveTab('assignments')}
            className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
              activeTab === 'assignments'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {t('roles.assignments')}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 max-w-2xl">
        {activeTab === 'roles' ? (
          <>
            {/* Create form */}
            {showCreate && (
              <RoleForm
                onSave={handleCreate}
                onCancel={() => setShowCreate(false)}
                submitLabel={t('roles.create')}
              />
            )}

            {/* Edit form */}
            {editingRole && (
              <RoleForm
                initial={roleToForm(editingRole)}
                onSave={handleUpdate}
                onCancel={() => setEditingRole(null)}
                submitLabel={t('roles.edit')}
              />
            )}

            {/* Roles list */}
            {loading ? (
              <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
                Loading roles...
              </div>
            ) : roles.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-2">
                <span className="text-4xl">🎭</span>
                <p className="text-sm">{t('roles.noRoles')}</p>
                <p className="text-xs text-gray-700">
                  Create a role to customize behavior for specific channels
                </p>
              </div>
            ) : (
              roles.map(role => (
                <RoleCard
                  key={role.id}
                  role={role}
                  onEdit={r => { setEditingRole(r); setShowCreate(false); }}
                  onDelete={handleDelete}
                />
              ))
            )}
          </>
        ) : (
          <AssignmentSection roles={roles} />
        )}

        <div className="pb-8" />
      </div>
    </div>
  );
}
