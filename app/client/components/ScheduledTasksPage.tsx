import { useState, useEffect } from 'react';
import type { ScheduledTask, TaskExecution, Agent } from '../types';
import { t } from '../i18n';

function useAvailableClis(): string[] {
  const [clis, setClis] = useState<string[]>(['claude']);
  useEffect(() => {
    fetch('/api/cli-available')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setClis(data); })
      .catch(() => {});
  }, []);
  return clis;
}

// Cron preset definitions
const SCHEDULE_PRESETS = [
  { labelKey: 'tasks.presetEvery6h', cron: '0 */6 * * *' },
  { labelKey: 'tasks.presetDaily9am', cron: '0 9 * * *' },
  { labelKey: 'tasks.presetDailyTwice', cron: '0 9,21 * * *' },
  { labelKey: 'tasks.presetWeekly', cron: '0 9 * * 1' },
  { labelKey: 'tasks.presetCustom', cron: '' },
];

function humanReadableCron(cron: string): string {
  for (const p of SCHEDULE_PRESETS) {
    if (p.cron && p.cron === cron) return t(p.labelKey);
  }
  return cron;
}

function StatusBadge({ status }: { status: TaskExecution['status'] }) {
  const cls =
    status === 'running'
      ? 'badge-yellow'
      : status === 'completed'
      ? 'badge-green'
      : 'text-xs font-medium px-1.5 py-0.5 rounded-full bg-red-900/40 text-red-400';
  return <span className={cls}>{status}</span>;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDatetime(ts: string | null): string {
  if (!ts) return '-';
  try {
    return new Date(ts).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return ts;
  }
}

// ---- Add Task Form ----

interface AddTaskFormProps {
  agents: Agent[];
  onSave: (data: Omit<ScheduledTask, 'id' | 'created_at' | 'updated_at'>) => Promise<void>;
  onCancel: () => void;
}

function AddTaskForm({ agents, onSave, onCancel }: AddTaskFormProps) {
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [agent, setAgent] = useState('claude');
  const [selectedPreset, setSelectedPreset] = useState(SCHEDULE_PRESETS[0].cron);
  const [customCron, setCustomCron] = useState('');
  const [timezone, setTimezone] = useState('Asia/Taipei');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const availableClis = useAvailableClis();

  const isCustom = selectedPreset === '';
  const finalCron = isCustom ? customCron : selectedPreset;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Task name is required'); return; }
    if (!prompt.trim()) { setError('Prompt is required'); return; }
    if (!finalCron.trim()) { setError('Schedule is required'); return; }
    setSaving(true);
    setError('');
    try {
      await onSave({
        name: name.trim(),
        prompt: prompt.trim(),
        agent,
        schedule: finalCron.trim(),
        timezone,
        enabled: true,
      });
    } catch (err) {
      setError(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card border-blue-700 space-y-4">
      <h3 className="text-sm font-semibold text-gray-100">{t('tasks.add')}</h3>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">{t('tasks.name')}</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Daily news summary"
          className="input-base w-full"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">{t('tasks.prompt')}</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Find today's top AI news and summarize in 3 bullet points."
          rows={3}
          className="input-base w-full resize-none"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">{t('tasks.agent') || 'CLI'}</label>
        <select
          value={agent}
          onChange={(e) => setAgent(e.target.value)}
          className="input-base w-full text-xs"
        >
          {availableClis.map((cli) => (
            <option key={cli} value={cli}>{cli}</option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">{t('tasks.schedule')}</label>
        <div className="flex flex-wrap gap-2 mb-2">
          {SCHEDULE_PRESETS.map((p) => (
            <button
              key={p.labelKey}
              type="button"
              onClick={() => setSelectedPreset(p.cron)}
              className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedPreset === p.cron
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
              }`}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
        {isCustom && (
          <input
            type="text"
            value={customCron}
            onChange={(e) => setCustomCron(e.target.value)}
            placeholder="0 9 * * *"
            className="input-base w-full font-mono"
          />
        )}
        {!isCustom && (
          <p className="text-xs text-gray-600 font-mono mt-1">{selectedPreset}</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">{t('tasks.timezone')}</label>
        <input
          type="text"
          value={timezone}
          onChange={(e) => setTimezone(e.target.value)}
          placeholder="Asia/Taipei"
          className="input-base w-full"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="btn-primary text-xs py-1.5">
          {saving ? 'Saving...' : t('tasks.save')}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-1.5">
          {t('tasks.cancel')}
        </button>
      </div>
    </form>
  );
}

// ---- Task Row ----

interface TaskRowProps {
  task: ScheduledTask;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onRun: (id: string) => void;
}

function TaskRow({ task, onToggle, onDelete, onRun }: TaskRowProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="card flex items-start gap-4">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h4 className="text-sm font-medium text-gray-100">{task.name}</h4>
          <span className="badge-gray font-mono">{humanReadableCron(task.schedule)}</span>
          <span className="text-xs text-gray-500">{task.agent}</span>
        </div>
        <p className="text-xs text-gray-400 mt-1 line-clamp-2">{task.prompt}</p>
        <p className="text-xs text-gray-600 mt-1">{task.timezone}</p>
      </div>

      <div className="flex items-center gap-3 flex-shrink-0">
        {/* Run now */}
        <button
          onClick={() => onRun(task.id)}
          title={t('tasks.run')}
          className="text-gray-500 hover:text-green-400 transition-colors text-base leading-none"
        >
          ▶
        </button>

        {/* Enable/disable toggle */}
        <label className="relative inline-flex items-center cursor-pointer">
          <input
            type="checkbox"
            checked={task.enabled}
            onChange={(e) => onToggle(task.id, e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
        </label>

        {/* Delete */}
        {confirmDelete ? (
          <div className="flex gap-1">
            <button
              onClick={() => onDelete(task.id)}
              className="btn-danger text-xs py-1 px-2"
            >
              Confirm
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="btn-secondary text-xs py-1 px-2"
            >
              {t('tasks.cancel')}
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-gray-600 hover:text-red-400 transition-colors text-xs"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Execution Row ----

interface ExecutionRowProps {
  execution: TaskExecution;
  taskName?: string;
}

function ExecutionRow({ execution, taskName }: ExecutionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasOutput = execution.output || execution.error;

  return (
    <div
      className={`card ${hasOutput ? 'cursor-pointer hover:border-gray-600' : ''} transition-colors`}
      onClick={() => hasOutput && setExpanded((v) => !v)}
    >
      <div className="flex items-center gap-3 flex-wrap">
        <StatusBadge status={execution.status} />
        <span className="text-sm text-gray-200 font-medium">{taskName ?? execution.task_id}</span>
        <span className="text-xs text-gray-500">{execution.triggered_by}</span>
        <span className="text-xs text-gray-500">{formatDuration(execution.duration_ms)}</span>
        <span className="text-xs text-gray-600">{formatDatetime(execution.started_at)}</span>
        {hasOutput && (
          <span className="ml-auto text-gray-600 text-xs">{expanded ? '▲' : '▼'}</span>
        )}
      </div>
      {expanded && hasOutput && (
        <div className="mt-3 pt-3 border-t border-gray-700">
          {execution.error && (
            <pre className="text-xs text-red-400 bg-gray-900 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words font-mono mb-2">
              {execution.error}
            </pre>
          )}
          {execution.output && (
            <pre className="text-xs text-gray-300 bg-gray-900 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words font-mono">
              {execution.output}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Main Page ----

export default function ScheduledTasksPage() {
  const [activeTab, setActiveTab] = useState<'tasks' | 'executions'>('tasks');
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [executions, setExecutions] = useState<TaskExecution[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingExec, setLoadingExec] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [runStatus, setRunStatus] = useState('');

  useEffect(() => {
    fetch('/api/agents')
      .then((r) => r.json())
      .then((data: Agent[]) => { if (Array.isArray(data)) setAgents(data); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetch('/api/scheduled-tasks')
      .then((r) => r.json())
      .then((data: ScheduledTask[]) => { if (Array.isArray(data)) setTasks(data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const loadExecutions = () => {
    setLoadingExec(true);
    fetch('/api/scheduled-tasks/executions')
      .then((r) => r.json())
      .then((data: TaskExecution[]) => { if (Array.isArray(data)) setExecutions(data); })
      .catch(() => {})
      .finally(() => setLoadingExec(false));
  };

  useEffect(() => {
    if (activeTab === 'executions') loadExecutions();
  }, [activeTab]);

  const handleSave = async (data: Omit<ScheduledTask, 'id' | 'created_at' | 'updated_at'>) => {
    const res = await fetch('/api/scheduled-tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const created: ScheduledTask = await res.json();
    setTasks((prev) => [...prev, created]);
    setShowForm(false);
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, enabled } : t)));
    try {
      await fetch(`/api/scheduled-tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
    } catch {
      setTasks((prev) => prev.map((t) => (t.id === id ? { ...t, enabled: !enabled } : t)));
    }
  };

  const handleDelete = async (id: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== id));
    try {
      await fetch(`/api/scheduled-tasks/${id}`, { method: 'DELETE' });
    } catch {
      // optimistic
    }
  };

  const handleRun = async (id: string) => {
    setRunStatus(`Running task ${id}...`);
    try {
      const res = await fetch(`/api/scheduled-tasks/${id}/run`, { method: 'POST' });
      if (res.ok) {
        setRunStatus('Task triggered successfully.');
        if (activeTab === 'executions') loadExecutions();
      } else {
        setRunStatus(`Failed: HTTP ${res.status}`);
      }
    } catch (err) {
      setRunStatus(`Error: ${(err as Error).message}`);
    }
    setTimeout(() => setRunStatus(''), 3000);
  };

  const taskMap = Object.fromEntries(tasks.map((t) => [t.id, t.name]));

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 border-b border-gray-700 bg-gray-800 flex-shrink-0 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">{t('tasks.title')}</h2>
          <p className="text-xs text-gray-400 mt-0.5">{t('tasks.subtitle')}</p>
        </div>
        {activeTab === 'tasks' && !showForm && (
          <button
            onClick={() => setShowForm(true)}
            className="px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
          >
            {t('tasks.add')}
          </button>
        )}
      </div>

      {/* Run status */}
      {runStatus && (
        <div className="px-6 py-2 border-b border-gray-700 bg-yellow-900/20 flex-shrink-0">
          <p className="text-xs text-yellow-400">{runStatus}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="px-6 border-b border-gray-700 bg-gray-800 flex-shrink-0 flex gap-4">
        <button
          onClick={() => setActiveTab('tasks')}
          className={`py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'tasks'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          {t('tasks.tabTasks')}
          {tasks.length > 0 && (
            <span className="ml-2 bg-gray-700 text-gray-400 text-xs rounded-full px-1.5 py-0.5">
              {tasks.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setActiveTab('executions')}
          className={`py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === 'executions'
              ? 'border-blue-500 text-blue-400'
              : 'border-transparent text-gray-500 hover:text-gray-300'
          }`}
        >
          {t('tasks.tabExecutions')}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 max-w-3xl">
        {activeTab === 'tasks' && (
          <>
            {showForm && (
              <AddTaskForm
                agents={agents}
                onSave={handleSave}
                onCancel={() => setShowForm(false)}
              />
            )}

            {loading ? (
              <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
                Loading tasks...
              </div>
            ) : tasks.length === 0 && !showForm ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-2">
                <span className="text-4xl">⏰</span>
                <p className="text-sm">{t('tasks.noTasks')}</p>
              </div>
            ) : (
              tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={handleToggle}
                  onDelete={handleDelete}
                  onRun={handleRun}
                />
              ))
            )}
          </>
        )}

        {activeTab === 'executions' && (
          <>
            {loadingExec ? (
              <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
                Loading executions...
              </div>
            ) : executions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-2">
                <span className="text-4xl">📄</span>
                <p className="text-sm">{t('tasks.noExecutions')}</p>
              </div>
            ) : (
              executions.map((exec) => (
                <ExecutionRow key={exec.id} execution={exec} taskName={taskMap[exec.task_id]} />
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}
