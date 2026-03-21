import { useState, useEffect, useMemo } from 'react';
import type { Session, DbMessage } from '../types';
import { t } from '../i18n';

const ROLE_BADGE: Record<string, string> = {
  user: 'badge-blue',
  assistant: 'badge-gray',
  tool_use: 'badge-yellow',
  tool_result: 'badge-green',
};

function roleBadgeClass(role: string): string {
  return ROLE_BADGE[role] ?? 'badge-gray';
}

function formatTime(ts: string): string {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return ts;
  }
}

function formatDate(ts: string): string {
  try {
    return new Date(ts).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return ts;
  }
}

interface MessageBubbleProps {
  msg: DbMessage;
}

function MessageBubble({ msg }: MessageBubbleProps) {
  const isToolUse = msg.role === 'tool_use';
  const isToolResult = msg.role === 'tool_result';
  const useCodeBlock = isToolUse || isToolResult;

  const bodyText = isToolUse
    ? (msg.tool_input ?? msg.content ?? '')
    : (msg.content ?? '');

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">{formatTime(msg.created_at)}</span>
        <span className={roleBadgeClass(msg.role)}>{msg.role}</span>
        {isToolUse && msg.tool_name && (
          <span className="text-xs text-yellow-400 font-mono">{msg.tool_name}</span>
        )}
      </div>
      {bodyText && (
        useCodeBlock ? (
          <pre className="text-xs text-gray-300 bg-gray-900 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words font-mono">
            {typeof bodyText === 'object' ? JSON.stringify(bodyText, null, 2) : String(bodyText)}
          </pre>
        ) : (
          <p className="text-sm text-gray-200 whitespace-pre-wrap break-words leading-relaxed">
            {String(bodyText)}
          </p>
        )
      )}
    </div>
  );
}

interface SessionWithCount extends Session {
  message_count?: number;
}

export default function HistoryPage() {
  const [sessions, setSessions] = useState<SessionWithCount[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DbMessage[]>([]);
  const [search, setSearch] = useState('');
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);

  useEffect(() => {
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((data: SessionWithCount[]) => {
        if (Array.isArray(data)) {
          const sorted = [...data].sort(
            (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
          );
          setSessions(sorted);
        }
      })
      .catch(() => {})
      .finally(() => setLoadingSessions(false));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    setLoadingMessages(true);
    fetch(`/api/history?session_id=${encodeURIComponent(selectedId)}`)
      .then((r) => r.json())
      .then((data: DbMessage[]) => {
        if (Array.isArray(data)) setMessages(data);
        else setMessages([]);
      })
      .catch(() => setMessages([]))
      .finally(() => setLoadingMessages(false));
  }, [selectedId]);

  const filteredMessages = useMemo(() => {
    if (!search.trim()) return messages;
    const q = search.toLowerCase();
    return messages.filter(
      (m) =>
        m.content?.toLowerCase().includes(q) ||
        m.tool_name?.toLowerCase().includes(q) ||
        m.tool_input?.toLowerCase().includes(q)
    );
  }, [messages, search]);

  const selectedSession = sessions.find((s) => s.id === selectedId);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-8 pb-4 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <h2 className="text-lg font-semibold text-gray-100">{t('history.title')}</h2>
        <p className="text-xs text-gray-400 mt-0.5">{t('history.subtitle')}</p>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Session list — left panel */}
        <div className="w-72 flex-shrink-0 border-r border-gray-700 bg-gray-800 flex flex-col">
          {loadingSessions ? (
            <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
              Loading...
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-gray-600 text-sm">
              {t('history.noSessions')}
            </div>
          ) : (
            <div className="flex-1 overflow-y-auto divide-y divide-gray-700">
              {sessions.map((session) => (
                <button
                  key={session.id}
                  onClick={() => setSelectedId(session.id)}
                  className={`w-full text-left px-4 py-3 transition-colors hover:bg-gray-700 ${
                    selectedId === session.id ? 'bg-gray-700 border-l-2 border-blue-500' : ''
                  }`}
                >
                  <p className="text-sm font-medium text-gray-200 truncate">{session.title || 'Untitled'}</p>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs text-gray-500">{formatDate(session.updated_at)}</span>
                    {session.message_count != null && (
                      <span className="text-xs text-gray-500">
                        {session.message_count} {t('history.messages')}
                      </span>
                    )}
                  </div>
                  <span className={`text-xs mt-0.5 inline-block ${session.status === 'active' ? 'text-green-500' : 'text-gray-600'}`}>
                    {session.status}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Message timeline — right panel */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {!selectedId ? (
            <div className="flex items-center justify-center h-full text-gray-600 text-sm">
              {t('history.selectSession')}
            </div>
          ) : (
            <>
              {/* Search bar */}
              <div className="px-4 py-3 border-b border-gray-700 bg-gray-800 flex-shrink-0">
                <div className="flex items-center gap-3">
                  <p className="text-sm font-medium text-gray-200 truncate flex-1">
                    {selectedSession?.title || 'Untitled'}
                  </p>
                  <input
                    type="text"
                    placeholder={t('history.search')}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="input-base w-56"
                  />
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {loadingMessages ? (
                  <div className="flex items-center justify-center h-32 text-gray-500 text-sm">
                    Loading...
                  </div>
                ) : filteredMessages.length === 0 ? (
                  <div className="flex items-center justify-center h-32 text-gray-600 text-sm">
                    {search ? 'No messages match your search.' : 'No messages in this session.'}
                  </div>
                ) : (
                  filteredMessages.map((msg) => (
                    <div key={msg.id} className="card">
                      <MessageBubble msg={msg} />
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
