import { useState, useEffect, useRef } from 'react';
import { t } from '../i18n';
import type { AgentExecution, AgentExecutionStep, ExecutionMode, ExecutionStatus, SpecialistType } from '../types';

// ── Helpers ──────────────────────────────────────────────────────────────────

const TERMINAL_STATUSES: AgentExecution['status'][] = ['done', 'error', 'cancelled'];

const STATUS_COLORS: Record<AgentExecution['status'], string> = {
  idle: 'bg-gray-700 text-gray-300',
  planning: 'bg-yellow-900/50 text-yellow-300',
  dispatching: 'bg-orange-900/50 text-orange-300',
  running: 'bg-blue-900/50 text-blue-300',
  aggregating: 'bg-purple-900/50 text-purple-300',
  reflecting: 'bg-violet-900/50 text-violet-300',
  done: 'bg-green-900/50 text-green-300',
  error: 'bg-red-900/50 text-red-400',
  cancelled: 'bg-gray-700 text-gray-400',
};

const STEP_STATUS_COLORS: Record<AgentExecutionStep['status'], string> = {
  pending: 'bg-gray-700 text-gray-400',
  running: 'bg-blue-900/50 text-blue-300',
  done: 'bg-green-900/50 text-green-300',
  error: 'bg-red-900/50 text-red-400',
};

const SPECIALIST_ICONS: Record<AgentExecutionStep['specialist_type'], string> = {
  researcher: '🔬',
  writer: '✍️',
  analyst: '📊',
  executor: '⚙️',
  critic: '📝',
};

function formatDuration(ms: number | null): string {
  if (ms == null) return '';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function formatDatetime(ts: string): string {
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

function truncate(str: string, max = 120): string {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

// ── Sub-components ────────────────────────────────────────────────────────────

interface StatusBadgeProps {
  status: AgentExecution['status'];
}

function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLORS[status]}`}>
      {status}
    </span>
  );
}

interface StepStatusBadgeProps {
  status: AgentExecutionStep['status'];
}

function StepStatusBadge({ status }: StepStatusBadgeProps) {
  return (
    <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${STEP_STATUS_COLORS[status]}`}>
      {status}
    </span>
  );
}

// ── Create Form ───────────────────────────────────────────────────────────────

interface CreateFormProps {
  onCreate: (execution: AgentExecution) => void;
}

function CreateForm({ onCreate }: CreateFormProps) {
  const [goal, setGoal] = useState('');
  const [mode, setMode] = useState<AgentExecution['mode']>('auto');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim()) {
      setError(t('executions.goalRequired') || 'Goal is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/executions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: goal.trim(), mode }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const created: AgentExecution = await res.json();
      onCreate(created);
      setGoal('');
    } catch (err) {
      setError(`${t('executions.createFailed') || 'Create failed'}: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card border-blue-700 space-y-3">
      <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
        {t('executions.newExecution') || 'New Execution'}
      </h3>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          {t('executions.goal') || 'Goal'}
        </label>
        <textarea
          value={goal}
          onChange={e => setGoal(e.target.value)}
          rows={3}
          placeholder="Research the latest AI trends and write a summary report..."
          className="input-base w-full resize-none"
        />
      </div>
      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          {t('executions.mode') || 'Mode'}
        </label>
        <select
          value={mode}
          onChange={e => setMode(e.target.value as AgentExecution['mode'])}
          className="input-base w-full"
        >
          <option value="auto">{t('executions.modeAuto') || 'Auto (recommended)'}</option>
          <option value="parallel">{t('executions.modeParallel') || 'Parallel'}</option>
          <option value="sequential">{t('executions.modeSequential') || 'Sequential'}</option>
          <option value="swarm">{t('executions.modeSwarm') || 'Swarm'}</option>
        </select>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button type="submit" disabled={saving} className="btn-primary text-xs py-1.5">
        {saving
          ? (t('executions.creating') || 'Creating...')
          : (t('executions.create') || 'Create Execution')}
      </button>
    </form>
  );
}

// ── Execution List Item ───────────────────────────────────────────────────────

interface ExecutionItemProps {
  execution: AgentExecution;
  selected: boolean;
  onSelect: () => void;
}

function ExecutionItem({ execution, selected, onSelect }: ExecutionItemProps) {
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left card transition-colors cursor-pointer ${
        selected ? 'border-blue-600 bg-gray-700/60' : 'hover:border-gray-600'
      }`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-100 truncate">{execution.title}</span>
            <StatusBadge status={execution.status} />
          </div>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{execution.goal}</p>
          <div className="flex items-center gap-2 mt-1">
            <span className="badge-gray text-xs capitalize">{execution.mode}</span>
            {execution.cost_usd != null && (
              <span className="text-xs text-gray-600">${execution.cost_usd.toFixed(4)}</span>
            )}
            {execution.duration_ms != null && (
              <span className="text-xs text-gray-600">{formatDuration(execution.duration_ms)}</span>
            )}
            <span className="text-xs text-gray-700 ml-auto">
              {formatDatetime(execution.created_at)}
            </span>
          </div>
        </div>
      </div>
    </button>
  );
}

// ── Step Row ──────────────────────────────────────────────────────────────────

interface StepRowProps {
  step: AgentExecutionStep;
}

function StepRow({ step }: StepRowProps) {
  const [expanded, setExpanded] = useState(false);
  const hasOutput = step.output != null && step.output.length > 0;

  return (
    <div
      className={`card space-y-2 ${hasOutput ? 'cursor-pointer hover:border-gray-600' : ''} transition-colors`}
      onClick={() => hasOutput && setExpanded(v => !v)}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-base leading-none" role="img" aria-label={step.specialist_type}>
          {SPECIALIST_ICONS[step.specialist_type]}
        </span>
        <span className="text-xs font-medium text-gray-300 capitalize">{step.specialist_type}</span>
        <span className="text-xs text-gray-600">#{step.step_index + 1}</span>
        <StepStatusBadge status={step.status} />
        {step.cost_usd != null && (
          <span className="text-xs text-gray-600">${step.cost_usd.toFixed(4)}</span>
        )}
        {step.duration_ms != null && (
          <span className="text-xs text-gray-600">{formatDuration(step.duration_ms)}</span>
        )}
        {hasOutput && (
          <span className="ml-auto text-gray-600 text-xs">{expanded ? '▲' : '▼'}</span>
        )}
      </div>
      <p className="text-xs text-gray-500">{truncate(step.input, 160)}</p>
      {expanded && hasOutput && step.output && (
        <div className="pt-2 border-t border-gray-700">
          <pre className="text-xs text-gray-300 bg-gray-900 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words font-mono">
            {step.output}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

interface DetailPanelProps {
  execution: AgentExecution;
  steps: AgentExecutionStep[];
  loadingSteps: boolean;
  onStart: (id: string) => void;
  onCancel: (id: string) => void;
}

function DetailPanel({ execution, steps, loadingSteps, onStart, onCancel }: DetailPanelProps) {
  const canStart = execution.status === 'idle';
  const canCancel = !TERMINAL_STATUSES.includes(execution.status);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Detail header */}
      <div className="px-4 py-3 border-b border-gray-700 flex-shrink-0">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-100">{execution.title}</h3>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <StatusBadge status={execution.status} />
              <span className="badge-gray text-xs capitalize">{execution.mode}</span>
              {execution.cost_usd != null && (
                <span className="text-xs text-gray-500">${execution.cost_usd.toFixed(4)}</span>
              )}
              {execution.duration_ms != null && (
                <span className="text-xs text-gray-500">{formatDuration(execution.duration_ms)}</span>
              )}
            </div>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            {canStart && (
              <button
                onClick={() => onStart(execution.id)}
                className="btn-primary text-xs py-1 px-3"
              >
                {t('executions.start') || 'Start'}
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => onCancel(execution.id)}
                className="btn-danger text-xs py-1 px-3"
              >
                {t('executions.cancel') || 'Cancel'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable detail body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {/* Goal */}
        <div>
          <p className="text-xs font-medium text-gray-400 mb-1">{t('executions.goal') || 'Goal'}</p>
          <p className="text-sm text-gray-200">{execution.goal}</p>
        </div>

        {/* Supervisor plan */}
        {execution.supervisor_plan && (
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1">
              {t('executions.plan') || 'Supervisor Plan'}
            </p>
            <pre className="text-xs text-gray-300 bg-gray-900 rounded p-2 whitespace-pre-wrap break-words font-mono overflow-x-auto">
              {execution.supervisor_plan}
            </pre>
          </div>
        )}

        {/* Result */}
        {execution.result && (
          <div>
            <p className="text-xs font-medium text-gray-400 mb-1">
              {t('executions.result') || 'Result'}
            </p>
            <pre className="text-xs text-green-300 bg-gray-900 rounded p-2 whitespace-pre-wrap break-words font-mono overflow-x-auto">
              {execution.result}
            </pre>
          </div>
        )}

        {/* Error */}
        {execution.error && (
          <div>
            <p className="text-xs font-medium text-red-400 mb-1">
              {t('executions.error') || 'Error'}
            </p>
            <pre className="text-xs text-red-400 bg-gray-900 rounded p-2 whitespace-pre-wrap break-words font-mono overflow-x-auto">
              {execution.error}
            </pre>
          </div>
        )}

        {/* Steps */}
        <div>
          <p className="text-xs font-medium text-gray-400 mb-2">
            {t('executions.steps') || 'Steps'}{' '}
            {steps.length > 0 && (
              <span className="text-gray-600">({steps.length})</span>
            )}
          </p>
          {loadingSteps ? (
            <div className="text-xs text-gray-500 py-2 text-center">
              {t('executions.loadingSteps') || 'Loading steps...'}
            </div>
          ) : steps.length === 0 ? (
            <div className="text-xs text-gray-600 italic py-2 text-center">
              {t('executions.noSteps') || 'No steps yet'}
            </div>
          ) : (
            <div className="space-y-2">
              {steps.map(step => (
                <StepRow key={step.id} step={step} />
              ))}
            </div>
          )}
        </div>

        <div className="pb-4" />
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ExecutionsPage() {
  const [executions, setExecutions] = useState<AgentExecution[]>([]);
  const executionsRef = useRef<AgentExecution[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [steps, setSteps] = useState<AgentExecutionStep[]>([]);
  const [loadingSteps, setLoadingSteps] = useState(false);
  const [error, setError] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep ref in sync so polling effect always reads latest executions
  useEffect(() => { executionsRef.current = executions; }, [executions]);

  // Fetch all executions on mount
  const fetchExecutions = () => {
    fetch('/api/executions')
      .then(r => r.json())
      .then((data: AgentExecution[]) => {
        if (Array.isArray(data)) setExecutions(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchExecutions();
  }, []);

  // Fetch steps when selection changes
  useEffect(() => {
    if (!selectedId) {
      setSteps([]);
      return;
    }
    setLoadingSteps(true);
    fetch(`/api/executions/${selectedId}`)
      .then(r => r.json())
      .then((data: AgentExecution & { steps?: AgentExecutionStep[] }) => {
        if (data.steps) setSteps(data.steps);
        // Update the execution in the list too
        setExecutions(prev => prev.map(e => e.id === data.id ? { ...e, ...data } : e));
      })
      .catch(console.error)
      .finally(() => setLoadingSteps(false));
  }, [selectedId]);

  // Poll when selected execution is active
  useEffect(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    if (!selectedId) return;

    // Use already-loaded status from ref — avoids stale closure over executions state
    const selected = executionsRef.current.find(e => e.id === selectedId);
    if (selected && TERMINAL_STATUSES.includes(selected.status)) return;

    // Start polling; it will stop itself once terminal status is detected
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`/api/executions/${selectedId}`);
        if (!res.ok) return;
        const data = await res.json();
        setExecutions(prev => prev.map(e => e.id === selectedId ? { ...e, ...data } : e));
        if (data.steps) setSteps(data.steps);
        if (TERMINAL_STATUSES.includes(data.status) && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch (err) {
        setError(`${t('executions.pollFailed') || 'Poll failed'}: ${(err as Error).message}`);
      }
    }, 3000);

    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [selectedId]); // intentionally exclude `executions` to avoid restarting poll on every update

  const handleCreate = (execution: AgentExecution) => {
    setExecutions(prev => [execution, ...prev]);
    setSelectedId(execution.id);
  };

  const handleStart = async (id: string) => {
    setError('');
    try {
      const res = await fetch(`/api/executions/${id}/start`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { executionId } = await res.json();
      const refetchRes = await fetch(`/api/executions/${executionId ?? id}`);
      if (refetchRes.ok) {
        const updated: AgentExecution = await refetchRes.json();
        setExecutions(prev => prev.map(e => e.id === updated.id ? updated : e));
      }
    } catch (err) {
      setError(`${t('executions.startFailed') || 'Start failed'}: ${(err as Error).message}`);
    }
  };

  const handleCancel = async (id: string) => {
    try {
      await fetch(`/api/executions/${id}`, { method: 'DELETE' });
      setExecutions(prev => prev.filter(e => e.id !== id));
      if (selectedId === id) setSelectedId(null);
    } catch (err) {
      setError(`Cancel failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }
  };

  const selectedExecution = executions.find(e => e.id === selectedId) ?? null;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <h2 className="text-lg font-semibold text-gray-100">
          {t('executions.title') || 'Executions'}
        </h2>
        <p className="text-xs text-gray-400 mt-0.5">
          {t('executions.subtitle') || 'Multi-agent agentic task runs'}
        </p>
        {error && <div className="text-red-400 text-xs mt-1">{error}</div>}
      </div>

      {/* Two-panel body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: list + create form */}
        <div className="w-80 flex-shrink-0 border-r border-gray-700 flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
            {/* Create form */}
            <CreateForm onCreate={handleCreate} />

            {/* Executions list */}
            {loading ? (
              <div className="flex items-center justify-center h-24 text-gray-500 text-xs">
                {t('executions.loading') || 'Loading...'}
              </div>
            ) : executions.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-32 text-gray-600 gap-2">
                <span className="text-3xl">⚡</span>
                <p className="text-xs">{t('executions.noExecutions') || 'No executions yet'}</p>
              </div>
            ) : (
              executions.map(execution => (
                <ExecutionItem
                  key={execution.id}
                  execution={execution}
                  selected={execution.id === selectedId}
                  onSelect={() => setSelectedId(execution.id)}
                />
              ))
            )}

            <div className="pb-4" />
          </div>
        </div>

        {/* Right: detail */}
        <div className="flex-1 overflow-hidden">
          {selectedExecution ? (
            <DetailPanel
              execution={selectedExecution}
              steps={steps}
              loadingSteps={loadingSteps}
              onStart={handleStart}
              onCancel={handleCancel}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
              <span className="text-4xl">⚡</span>
              <p className="text-sm">{t('executions.selectExecution') || 'Select an execution to view details'}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
