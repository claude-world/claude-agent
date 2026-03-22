import { useState, useEffect } from 'react';
import type { ChannelAccount } from '../types';

function StatusDot({ enabled }: { enabled: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${enabled ? 'bg-green-400' : 'bg-gray-600'}`} />
      <span className="text-xs text-gray-400">{enabled ? 'Enabled' : 'Disabled'}</span>
    </div>
  );
}

function PlatformIcon({ platform }: { platform: ChannelAccount['platform'] }) {
  return <span className="text-xl">{platform === 'telegram' ? '✈️' : '🎮'}</span>;
}

interface AddChannelFormProps {
  onSave: (data: { platform: 'telegram' | 'discord'; bot_token: string; allowed_users: string[] }) => Promise<void>;
  onCancel: () => void;
}

function AddChannelForm({ onSave, onCancel }: AddChannelFormProps) {
  const [platform, setPlatform] = useState<'telegram' | 'discord'>('telegram');
  const [botToken, setBotToken] = useState('');
  const [allowedUsers, setAllowedUsers] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!botToken.trim()) {
      setError('Bot token is required');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave({
        platform,
        bot_token: botToken.trim(),
        allowed_users: allowedUsers
          .split(',')
          .map((u) => u.trim())
          .filter(Boolean)
      });
    } catch (err) {
      setError(`Save failed: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="card border-blue-700 space-y-4">
      <h3 className="text-sm font-semibold text-gray-100">Add Channel</h3>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Platform</label>
        <div className="flex gap-3">
          {(['telegram', 'discord'] as const).map((p) => (
            <label
              key={p}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg border cursor-pointer transition-colors ${
                platform === p ? 'border-blue-600 bg-blue-600/10' : 'border-gray-700 hover:border-gray-600'
              }`}
            >
              <input
                type="radio"
                name="platform"
                value={p}
                checked={platform === p}
                onChange={() => setPlatform(p)}
                className="accent-blue-500"
              />
              <span className="text-sm text-gray-200 capitalize">{p}</span>
              <span>{p === 'telegram' ? '✈️' : '🎮'}</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">Bot Token</label>
        <input
          type="password"
          value={botToken}
          onChange={(e) => setBotToken(e.target.value)}
          placeholder={
            platform === 'telegram'
              ? '1234567890:ABCDef...'
              : 'Bot token from Discord Developer Portal'
          }
          className="input-base w-full font-mono"
        />
        <p className="text-xs text-gray-600 mt-1">
          {platform === 'telegram'
            ? 'Get a token from @BotFather on Telegram'
            : 'Create an app at discord.com/developers, add a Bot'}
        </p>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-400 mb-1">
          Allowed Users{' '}
          <span className="text-gray-600 font-normal">(comma-separated usernames, optional)</span>
        </label>
        <input
          type="text"
          value={allowedUsers}
          onChange={(e) => setAllowedUsers(e.target.value)}
          placeholder="user1, user2"
          className="input-base w-full"
        />
      </div>

      {error && <p className="text-xs text-red-400">{error}</p>}

      <div className="flex gap-2 pt-1">
        <button type="submit" disabled={saving} className="btn-primary text-xs py-1.5">
          {saving ? 'Adding...' : 'Add Channel'}
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary text-xs py-1.5">
          Cancel
        </button>
      </div>
    </form>
  );
}

interface ChannelCardProps {
  account: ChannelAccount;
  bridgeStatus: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onStartStop: (id: string, action: 'start' | 'stop') => void;
  onUpdate: (id: string, allowed_users: string[]) => void;
}

function ChannelCard({ account, bridgeStatus, onToggle, onDelete, onStartStop, onUpdate }: ChannelCardProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editUsers, setEditUsers] = useState(account.allowed_users.join(', '));

  const handleSaveEdit = () => {
    const users = editUsers.split(',').map(s => s.trim()).filter(Boolean);
    onUpdate(account.id, users);
    setEditing(false);
  };

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <PlatformIcon platform={account.platform} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h4 className="text-sm font-medium text-gray-100 capitalize">{account.platform}</h4>
              <span className="badge-gray">{account.id.slice(0, 8)}</span>
              {bridgeStatus ? (
                <span className="badge-green">Connected</span>
              ) : account.enabled ? (
                <span className="badge-yellow">Disconnected</span>
              ) : null}
            </div>
            <div className="mt-1">
              <StatusDot enabled={account.enabled} />
            </div>

            {/* Allowed users — view or edit mode */}
            {editing ? (
              <div className="mt-2 space-y-2">
                <label className="text-xs text-gray-400">Allowed users (chat_id, username, or user_id — comma separated):</label>
                <input
                  type="text"
                  value={editUsers}
                  onChange={e => setEditUsers(e.target.value)}
                  className="input-base w-full text-xs"
                  placeholder="e.g. 123456789, username, chat_id"
                />
                <div className="flex gap-2">
                  <button onClick={handleSaveEdit} className="btn-primary text-xs py-1 px-3">Save</button>
                  <button onClick={() => { setEditing(false); setEditUsers(account.allowed_users.join(', ')); }} className="text-xs text-gray-400 hover:text-gray-200 px-2">Cancel</button>
                </div>
              </div>
            ) : (
              <div className="mt-1 flex items-center gap-2">
                {account.allowed_users.length > 0 ? (
                  <p className="text-xs text-gray-500">
                    Allowed: {account.allowed_users.join(', ')}
                  </p>
                ) : (
                  <p className="text-xs text-gray-600 italic">All users allowed (no filter)</p>
                )}
                <button onClick={() => setEditing(true)} className="text-xs text-blue-400 hover:text-blue-300">Edit</button>
              </div>
            )}

            <p className="text-xs text-gray-600 mt-1">
              Added: {new Date(account.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-shrink-0">
          {/* Start/Stop bridge */}
          {account.enabled && (
            bridgeStatus ? (
              <button onClick={() => onStartStop(account.id, 'stop')} className="text-xs px-2 py-1 rounded border border-red-700 text-red-400 hover:bg-red-900/30">
                Stop
              </button>
            ) : (
              <button onClick={() => onStartStop(account.id, 'start')} className="text-xs px-2 py-1 rounded border border-green-700 text-green-400 hover:bg-green-900/30">
                Start
              </button>
            )
          )}

          {/* Enable/disable toggle */}
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              checked={account.enabled}
              onChange={(e) => onToggle(account.id, e.target.checked)}
              className="sr-only peer"
            />
            <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-blue-600" />
          </label>

          {/* Delete */}
          {confirmDelete ? (
            <div className="flex gap-1">
              <button onClick={() => onDelete(account.id)} className="btn-danger text-xs py-1 px-2">
                Confirm
              </button>
              <button onClick={() => setConfirmDelete(false)} className="btn-secondary text-xs py-1 px-2">
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="text-gray-600 hover:text-red-400 transition-colors text-xs"
              title="Delete channel"
            >
              Delete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ChannelsPage() {
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [bridgeStatus, setBridgeStatus] = useState<Record<string, boolean>>({});

  const fetchStatus = () => {
    fetch('/api/channels/status')
      .then(r => r.json())
      .then((data: Record<string, { running: boolean }>) => {
        const s: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(data)) s[k] = v.running;
        setBridgeStatus(s);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetch('/api/channels')
      .then((r) => r.json())
      .then((data: ChannelAccount[]) => {
        if (Array.isArray(data)) setAccounts(data);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  const addAccount = async (data: {
    platform: 'telegram' | 'discord';
    bot_token: string;
    allowed_users: string[];
  }) => {
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const created: ChannelAccount = await res.json();
    setAccounts((prev) => [...prev, created]);
    setShowForm(false);
  };

  const toggleAccount = async (id: string, enabled: boolean) => {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, enabled } : a)));
    try {
      // The server doesn't have a PATCH endpoint — delete and re-add isn't viable here.
      // We optimistically update the UI. The server will need a PATCH endpoint.
      // For now, just send the update and handle gracefully.
      await fetch(`/api/channels/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled })
      });
    } catch {
      // Revert on error
      setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, enabled: !enabled } : a)));
    }
  };

  const handleStartStop = async (id: string, action: 'start' | 'stop') => {
    try {
      await fetch(`/api/channels/${id}/${action}`, { method: 'POST' });
      fetchStatus();
    } catch {}
  };

  const handleUpdateUsers = async (id: string, allowed_users: string[]) => {
    try {
      const res = await fetch(`/api/channels/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowed_users }),
      });
      if (res.ok) {
        setAccounts(prev => prev.map(a => a.id === id ? { ...a, allowed_users } : a));
      }
    } catch {}
  };

  const deleteAccount = async (id: string) => {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    try {
      await fetch(`/api/channels/${id}`, { method: 'DELETE' });
    } catch {
      // Silently ignore — optimistic removal already applied
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">Channels</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Connect Telegram and Discord bots to receive messages
            </p>
          </div>
          {!showForm && (
            <button onClick={() => setShowForm(true)} className="btn-secondary text-xs py-1.5">
              + Add Channel
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3 max-w-2xl">
        {/* Add form */}
        {showForm && (
          <AddChannelForm onSave={addAccount} onCancel={() => setShowForm(false)} />
        )}

        {/* Account list */}
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
            Loading channels...
          </div>
        ) : accounts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-600 gap-2">
            <span className="text-4xl">📡</span>
            <p className="text-sm">No channels configured yet</p>
            <p className="text-xs text-gray-700">Add a Telegram or Discord bot to receive messages</p>
          </div>
        ) : (
          accounts.map((account) => (
            <ChannelCard
              key={account.id}
              account={account}
              bridgeStatus={bridgeStatus[account.platform] ?? false}
              onToggle={toggleAccount}
              onDelete={deleteAccount}
              onStartStop={handleStartStop}
              onUpdate={handleUpdateUsers}
            />
          ))
        )}

        {/* Help */}
        {!loading && (
          <div className="card border-gray-700 mt-4">
            <h4 className="text-xs font-semibold text-gray-400 mb-2">Setup Guide</h4>
            <ul className="space-y-1.5 text-xs text-gray-500">
              <li>
                <span className="text-gray-400">Telegram:</span> Message @BotFather, use /newbot,
                copy the token
              </li>
              <li>
                <span className="text-gray-400">Discord:</span> Visit discord.com/developers,
                create an Application, add a Bot, copy the token
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
