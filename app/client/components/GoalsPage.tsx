import { useState, useEffect } from 'react';
import { t } from '../i18n';
import type { GoalEntry, GoalMilestone, GoalLoopState } from '../types';

interface GoalLoopConfig {
  schedule: string;
  delivery_chat_id: string;
  delivery_platform: 'telegram' | 'discord';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PRIORITY_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Low',
  2: 'Medium',
  3: 'High',
};

const PRIORITY_COLORS: Record<1 | 2 | 3, string> = {
  1: 'bg-gray-700 text-gray-400',
  2: 'bg-blue-900/50 text-blue-300',
  3: 'bg-orange-900/50 text-orange-300',
};

const STATUS_COLORS: Record<GoalEntry['status'], string> = {
  active: 'bg-green-900/50 text-green-300',
  paused: 'bg-yellow-900/50 text-yellow-300',
  completed: 'bg-gray-700 text-gray-400',
};

function formatDatetime(ts: string | null): string {
  if (!ts) return '—';
  // Reject cron expressions or non-ISO strings (e.g. "0 8 * * *")
  if (!/^\d{4}-\d{2}-\d{2}/.test(ts)) return '—';
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

function MilestoneProgress({ milestones }: { milestones: GoalMilestone[] }) {
  if (milestones.length === 0) return null;
  const done = milestones.filter(m => m.done).length;
  const pct = Math.round((done / milestones.length) * 100);

  return (
    <div className="mt-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-500">
          {done}/{milestones.length} {t('goals.milestones') || 'milestones'}
        </span>
        <span className="text-xs text-gray-600">{pct}%</span>
      </div>
      <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ── Create Goal Form ──────────────────────────────────────────────────────────

interface CreateGoalFormProps {
  onSave: (goal: GoalEntry) => void;
  onCancel: () => void;
}

function CreateGoalForm({ onSave, onCancel }: CreateGoalFormProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<1 | 2 | 3>(2);
  const [tags, setTags] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError(t('goals.titleRequired') || 'Title is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/goals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          priority,
          tags: tags.split(',').map(s => s.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created: GoalEntry = await res.json();
      onSave(created);
    } catch (err) {
      setError(`${t('goals.saveFailed') || 'Save failed'}: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card border-blue-700 space-y-3">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
        {t('goals.createGoal') || 'New Goal'}
      </h3>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          {t('goals.goalTitle') || 'Title'}
        </label>
        <input
          type="text"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="Learn TypeScript deeply"
          className="input-base w-full"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          {t('goals.description') || 'Description'}
        </label>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          rows={2}
          placeholder="Optional details about this goal..."
          className="input-base w-full resize-none"
        />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            {t('goals.priority') || 'Priority'}
          </label>
          <select
            value={priority}
            onChange={e => setPriority(Number(e.target.value) as 1 | 2 | 3)}
            className="input-base w-full"
          >
            <option value={1}>1 — {PRIORITY_LABELS[1]}</option>
            <option value={2}>2 — {PRIORITY_LABELS[2]}</option>
            <option value={3}>3 — {PRIORITY_LABELS[3]}</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            {t('goals.tags') || 'Tags'}{' '}
            <span className="text-gray-600 font-normal">(comma-separated)</span>
          </label>
          <input
            type="text"
            value={tags}
            onChange={e => setTags(e.target.value)}
            placeholder="dev, learning, 2026"
            className="input-base w-full"
          />
        </div>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="btn-primary text-xs py-1.5">
          {saving ? (t('goals.saving') || 'Saving...') : (t('goals.save') || 'Save Goal')}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-1.5">
          {t('goals.cancel') || 'Cancel'}
        </button>
      </div>
    </form>
  );
}

// ── Goal Card ─────────────────────────────────────────────────────────────────

interface GoalCardProps {
  goal: GoalEntry;
  onUpdate: (goal: GoalEntry) => void;
  onDelete: (id: string) => void;
}

function GoalCard({ goal, onUpdate, onDelete }: GoalCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [newMilestone, setNewMilestone] = useState('');
  const [addingMilestone, setAddingMilestone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [localMilestones, setLocalMilestones] = useState(goal.milestones);
  // Keep in sync with prop changes (e.g. after parent refresh)
  useEffect(() => { setLocalMilestones(goal.milestones); }, [goal.milestones]);

  const patchGoal = async (body: Partial<GoalEntry>) => {
    const res = await fetch(`/api/goals/${goal.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const updated: GoalEntry = await res.json();
    onUpdate(updated);
    return updated;
  };

  const toggleMilestone = async (index: number) => {
    const snapshot = localMilestones; // capture before optimistic update
    setBusy(true);
    // Optimistic update
    const optimistic = localMilestones.map((m, i) =>
      i === index ? { ...m, done: !m.done } : m
    );
    setLocalMilestones(optimistic);
    try {
      // No body needed — server toggles server-side; no Content-Type to avoid malformed request
      const res = await fetch(`/api/goals/${goal.id}/milestones/${index}`, { method: 'PUT' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const updated: GoalEntry = await res.json();
      setLocalMilestones(updated.milestones);
      onUpdate(updated);
    } catch (err) {
      setLocalMilestones(snapshot); // rollback to pre-op snapshot, not stale prop
      setError(`${t('goals.saveFailed') || 'Save failed'}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const addMilestoneToGoal = async (title: string) => {
    const snapshot = localMilestones; // capture before optimistic update
    setBusy(true);
    const updated = [...localMilestones, { title, done: false }];
    setLocalMilestones(updated); // optimistic
    try {
      const res = await fetch(`/api/goals/${goal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ milestones: updated }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const serverGoal: GoalEntry = await res.json();
      setLocalMilestones(serverGoal.milestones); // confirm with server
      onUpdate(serverGoal);
    } catch (err) {
      setLocalMilestones(snapshot); // rollback to pre-op snapshot
      setError(`${t('goals.saveFailed') || 'Save failed'}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const deleteMilestone = async (index: number) => {
    const snapshot = localMilestones; // capture before optimistic update
    setBusy(true);
    const updated = localMilestones.filter((_, i) => i !== index);
    setLocalMilestones(updated); // optimistic
    try {
      const res = await fetch(`/api/goals/${goal.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ milestones: updated }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const serverGoal: GoalEntry = await res.json();
      setLocalMilestones(serverGoal.milestones); // confirm with server
      onUpdate(serverGoal);
    } catch (err) {
      setLocalMilestones(snapshot); // rollback to pre-op snapshot
      setError(`${t('goals.saveFailed') || 'Save failed'}: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleAddMilestone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMilestone.trim()) return;
    await addMilestoneToGoal(newMilestone.trim());
    setNewMilestone('');
    setAddingMilestone(false);
  };

  const handleStatusChange = async (status: GoalEntry['status']) => {
    try {
      await patchGoal({ status });
    } catch (err) {
      setError(`${t('goals.saveFailed') || 'Save failed'}: ${(err as Error).message}`);
    }
  };

  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/goals/${goal.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onDelete(goal.id); // only after success
    } catch (err) {
      setError(`Delete failed: ${(err as Error).message}`);
      setConfirmDelete(false);
    }
  };

  return (
    <div className="card space-y-2">
      {error && <p className="text-xs text-red-400">{error}</p>}
      {/* Card header row */}
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-medium text-gray-100">{goal.title}</h4>
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${PRIORITY_COLORS[goal.priority]}`}>
              P{goal.priority} {PRIORITY_LABELS[goal.priority]}
            </span>
            <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full capitalize ${STATUS_COLORS[goal.status]}`}>
              {goal.status}
            </span>
          </div>
          {goal.description && (
            <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{goal.description}</p>
          )}
          {goal.tags.length > 0 && (
            <div className="flex gap-1 flex-wrap mt-1">
              {goal.tags.map(tag => (
                <span key={tag} className="badge-gray text-xs">{tag}</span>
              ))}
            </div>
          )}
          <MilestoneProgress milestones={localMilestones} />
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs text-gray-500 hover:text-gray-300"
          >
            {expanded ? '▲' : '▼'}
          </button>
          {confirmDelete ? (
            <div className="flex gap-1">
              <button onClick={handleDelete} className="btn-danger text-xs py-1 px-2">
                {t('goals.confirm') || 'Confirm'}
              </button>
              <button onClick={() => setConfirmDelete(false)} className="btn-secondary text-xs py-1 px-2">
                {t('goals.cancel') || 'Cancel'}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-xs text-gray-600 hover:text-red-400 transition-colors"
            >
              {t('goals.delete') || 'Delete'}
            </button>
          )}
        </div>
      </div>

      {/* Expanded section */}
      {expanded && (
        <div className="pt-2 border-t border-gray-700 space-y-3">
          {/* Status controls */}
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1.5">
              {t('goals.changeStatus') || 'Status'}
            </p>
            <div className="flex gap-1.5">
              {(['active', 'paused', 'completed'] as GoalEntry['status'][]).map(s => {
                const STATUS_LABELS: Record<string, string> = {
                  active: t('goals.statusActive'),
                  paused: t('goals.statusPaused'),
                  completed: t('goals.statusCompleted'),
                };
                return (
                  <button
                    key={s}
                    onClick={() => handleStatusChange(s)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors capitalize ${
                      goal.status === s
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Milestones */}
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1.5">
              {t('goals.milestones') || 'Milestones'}
            </p>
            {localMilestones.length === 0 ? (
              <p className="text-xs text-gray-600 italic">
                {t('goals.noMilestones') || 'No milestones yet'}
              </p>
            ) : (
              <div className="space-y-1.5">
                {localMilestones.map((m, idx) => (
                  <div key={`milestone-${idx}`} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={m.done}
                      onChange={() => toggleMilestone(idx)}
                      disabled={busy}
                      className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-blue-500 cursor-pointer"
                    />
                    <span className={`text-xs flex-1 ${m.done ? 'line-through text-gray-600' : 'text-gray-300'}`}>
                      {m.title}
                    </span>
                    <button
                      onClick={() => deleteMilestone(idx)}
                      disabled={busy}
                      className="text-gray-700 hover:text-red-400 transition-colors text-xs"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add milestone */}
            {addingMilestone ? (
              <form onSubmit={handleAddMilestone} className="flex gap-2 mt-2">
                <input
                  type="text"
                  value={newMilestone}
                  onChange={e => setNewMilestone(e.target.value)}
                  placeholder="Milestone title..."
                  autoFocus
                  className="input-base flex-1 text-xs py-1"
                />
                <button type="submit" disabled={busy} className="btn-primary text-xs py-1 px-2">
                  {t('goals.add') || 'Add'}
                </button>
                <button
                  type="button"
                  onClick={() => { setAddingMilestone(false); setNewMilestone(''); }}
                  className="btn-secondary text-xs py-1 px-2"
                >
                  {t('goals.cancel') || 'Cancel'}
                </button>
              </form>
            ) : (
              <button
                onClick={() => setAddingMilestone(true)}
                className="text-xs text-blue-400 hover:text-blue-300 mt-2"
              >
                + {t('goals.addMilestone') || 'Add milestone'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Goal Loop Tab ─────────────────────────────────────────────────────────────

function GoalLoopTab() {
  const [loopState, setLoopState] = useState<GoalLoopState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [config, setConfig] = useState<GoalLoopConfig>({
    schedule: '0 8 * * *',
    delivery_chat_id: '',
    delivery_platform: 'telegram',
  });
  const [savingConfig, setSavingConfig] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    fetch('/api/goals/loop/status')
      .then(r => r.json())
      .then((data: { status: string; dbState: GoalLoopState | null }) => {
        setLoopState({
          status: data.status,
          last_run_at: data.dbState?.last_run_at || null,
          next_run_at: data.dbState?.next_run_at || null,
          reflection_notes: (() => {
            const raw = data.dbState?.reflection_notes;
            if (Array.isArray(raw)) return raw;
            try { return JSON.parse(raw || '[]'); } catch { return []; }
          })(),
          current_plan: data.dbState?.current_plan || {},
        });
      })
      .catch(() => { setFetchError(t('goals.fetchError') || 'Failed to load loop configuration'); })
      .finally(() => setLoading(false));

    // load saved config from settings
    fetch('/api/settings').then(r => r.json()).then((data: Record<string, string>) => {
      setConfig(prev => ({
        schedule: data.goal_loop_schedule || prev.schedule,
        delivery_chat_id: data.goal_loop_delivery_chat_id || prev.delivery_chat_id,
        delivery_platform: (data.goal_loop_delivery_platform as 'telegram' | 'discord') || prev.delivery_platform,
      }));
    }).catch(() => { setFetchError(t('goals.fetchError') || 'Failed to load loop configuration'); });
  }, []);

  const handleTrigger = async () => {
    setTriggering(true);
    setStatusMessage('');
    setIsError(false);
    try {
      const res = await fetch('/api/goals/loop/trigger', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setIsError(false);
      setStatusMessage(t('goals.loopTriggered') || 'Goal loop triggered successfully.');
    } catch (err) {
      setIsError(true);
      setStatusMessage(`${t('goals.loopError') || 'Error'}: ${(err as Error).message}`);
    } finally {
      setTriggering(false);
      setTimeout(() => setStatusMessage(''), 4000);
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingConfig(true);
    setStatusMessage('');
    setIsError(false);
    try {
      const res = await fetch('/api/goals/loop/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setIsError(false);
      setStatusMessage(t('goals.loopConfigSaved') || 'Loop config saved.');
    } catch (err) {
      setIsError(true);
      setStatusMessage(`${t('goals.saveFailed') || 'Save failed'}: ${(err as Error).message}`);
    } finally {
      setSavingConfig(false);
      setTimeout(() => setStatusMessage(''), 4000);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
        {t('goals.loading') || 'Loading...'}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {fetchError && (
        <div className="text-red-400 text-sm">{fetchError}</div>
      )}
      {/* Status card */}
      <div className="card space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            {t('goals.loopStatus') || 'Loop Status'}
          </h3>
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="btn-primary text-xs py-1.5 px-3"
          >
            {triggering
              ? (t('goals.triggering') || 'Triggering...')
              : (t('goals.triggerNow') || 'Trigger Now')}
          </button>
        </div>
        {loopState && (
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 flex-shrink-0">
                {t('goals.loopCurrentStatus') || 'Status'}:
              </span>
              <span className="text-xs font-medium text-gray-200 capitalize">
                {loopState.status || 'idle'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 flex-shrink-0">
                {t('goals.loopLastRun') || 'Last run'}:
              </span>
              <span className="text-xs text-gray-400">{formatDatetime(loopState.last_run_at)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-24 flex-shrink-0">
                {t('goals.loopNextRun') || 'Next run'}:
              </span>
              <span className="text-xs text-gray-400">{formatDatetime(loopState.next_run_at)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Reflection notes */}
      {loopState && loopState.reflection_notes.length > 0 && (
        <div className="card space-y-2">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            {t('goals.reflectionNotes') || 'Reflection Notes'}
          </h3>
          <div className="space-y-1.5">
            {loopState.reflection_notes.map((note, idx) => (
              <p key={idx} className="text-xs text-gray-300 leading-relaxed">
                {note}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Config form */}
      <form onSubmit={handleSaveConfig} className="card space-y-3">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
          {t('goals.loopConfig') || 'Loop Configuration'}
        </h3>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            {t('goals.schedule') || 'Schedule (cron)'}
          </label>
          <input
            type="text"
            value={config.schedule}
            onChange={e => setConfig(c => ({ ...c, schedule: e.target.value }))}
            placeholder="0 8 * * *"
            className="input-base w-full font-mono"
          />
          <p className="text-xs text-gray-600 mt-1">
            {t('goals.scheduleHint') || 'Daily at 8 AM by default. Cron syntax.'}
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            {t('goals.deliveryChatId') || 'Delivery Chat ID'}
          </label>
          <input
            type="text"
            value={config.delivery_chat_id}
            onChange={e => setConfig(c => ({ ...c, delivery_chat_id: e.target.value }))}
            placeholder="e.g. 123456789 or @channel"
            className="input-base w-full"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-400 mb-1">
            {t('goals.deliveryPlatform') || 'Delivery Platform'}
          </label>
          <select
            value={config.delivery_platform}
            onChange={e => setConfig(c => ({ ...c, delivery_platform: e.target.value as 'telegram' | 'discord' }))}
            className="input-base w-full"
          >
            <option value="telegram">Telegram</option>
            <option value="discord">Discord</option>
          </select>
        </div>
        {statusMessage && (
          <p className={`text-xs ${isError ? 'text-red-400' : 'text-green-400'}`}>
            {statusMessage}
          </p>
        )}
        <button type="submit" disabled={savingConfig} className="btn-primary text-xs py-1.5">
          {savingConfig
            ? (t('goals.saving') || 'Saving...')
            : (t('goals.saveConfig') || 'Save Config')}
        </button>
      </form>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function GoalsPage() {
  const [goals, setGoals] = useState<GoalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'goals' | 'loop'>('goals');
  const [showCreate, setShowCreate] = useState(false);

  useEffect(() => {
    fetch('/api/goals')
      .then(r => r.json())
      .then((data: GoalEntry[]) => {
        if (Array.isArray(data)) setGoals(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = (goal: GoalEntry) => {
    setGoals(prev => [goal, ...prev]);
    setShowCreate(false);
  };

  const handleUpdate = (updated: GoalEntry) => {
    setGoals(prev => prev.map(g => g.id === updated.id ? updated : g));
  };

  const handleDelete = (id: string) => {
    setGoals(prev => prev.filter(g => g.id !== id));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">
              {t('goals.title') || 'Goals'}
            </h2>
            <p className="text-xs text-gray-400 mt-0.5">
              {t('goals.subtitle') || 'Track goals and run daily reflection loops'}
            </p>
          </div>
          {activeTab === 'goals' && !showCreate && (
            <button onClick={() => setShowCreate(true)} className="btn-secondary text-xs py-1.5">
              {t('goals.createGoal') || '+ New Goal'}
            </button>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mt-4">
          {(['goals', 'loop'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors capitalize ${
                activeTab === tab
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {tab === 'goals'
                ? (t('goals.tabGoals') || 'Goals')
                : (t('goals.tabLoop') || 'Goal Loop')}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 max-w-2xl">
        {activeTab === 'goals' ? (
          <>
            {showCreate && (
              <CreateGoalForm
                onSave={handleCreate}
                onCancel={() => setShowCreate(false)}
              />
            )}

            {loading ? (
              <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
                {t('goals.loading') || 'Loading goals...'}
              </div>
            ) : goals.length === 0 && !showCreate ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-2">
                <span className="text-4xl">🎯</span>
                <p className="text-sm">{t('goals.noGoals') || 'No goals yet'}</p>
                <p className="text-xs text-gray-700">
                  {t('goals.noGoalsHint') || 'Create a goal to start tracking progress'}
                </p>
              </div>
            ) : (
              goals.map(goal => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  onUpdate={handleUpdate}
                  onDelete={handleDelete}
                />
              ))
            )}
          </>
        ) : (
          <GoalLoopTab />
        )}

        <div className="pb-8" />
      </div>
    </div>
  );
}
