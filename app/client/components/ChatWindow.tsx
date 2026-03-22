import { useState, useEffect, useRef, useCallback } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Session, DbMessage, WsOutbound } from '../types';
import ToolUseBlock from './ToolUseBlock';

const WS_URL = '/ws';

// ---- display message types (client-side only) ----
interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  timestamp: number;
}

function getReadyStateLabel(state: ReadyState): { label: string; color: string } {
  switch (state) {
    case ReadyState.CONNECTING:
      return { label: 'Connecting', color: 'text-yellow-400' };
    case ReadyState.OPEN:
      return { label: 'Connected', color: 'text-green-400' };
    case ReadyState.CLOSING:
      return { label: 'Closing', color: 'text-orange-400' };
    case ReadyState.CLOSED:
      return { label: 'Disconnected', color: 'text-red-400' };
    default:
      return { label: 'Unknown', color: 'text-gray-400' };
  }
}

function dbMessageToDisplay(m: DbMessage): DisplayMessage {
  let toolInput: Record<string, unknown> | undefined;
  if (m.tool_input) {
    try {
      toolInput = JSON.parse(m.tool_input);
    } catch {
      toolInput = { raw: m.tool_input };
    }
  }
  return {
    id: String(m.id),
    role: m.role,
    content: m.content ?? '',
    toolName: m.tool_name ?? undefined,
    toolInput,
    timestamp: new Date(m.created_at).getTime()
  };
}

interface MessageBubbleProps {
  message: DisplayMessage;
}

function MessageBubble({ message }: MessageBubbleProps) {
  const { role, content, toolName, toolInput, timestamp } = message;

  if (role === 'tool_use' && toolName) {
    return (
      <div className="flex justify-start mb-2 px-1">
        <div className="max-w-2xl w-full">
          <ToolUseBlock
            tool={{
              type: 'tool_use',
              id: message.id,
              name: toolName,
              input: toolInput ?? {}
            }}
          />
          <span className="text-xs text-gray-600 px-1">
            {new Date(timestamp).toLocaleTimeString()}
          </span>
        </div>
      </div>
    );
  }

  if (role === 'tool_result') {
    return (
      <div className="flex justify-start mb-2">
        <div className="max-w-2xl flex flex-col gap-1 items-start">
          <div className="px-3 py-2 rounded-lg bg-gray-750 border border-gray-700 text-xs text-gray-500 font-mono">
            <span className="text-gray-600 font-semibold">result: </span>
            <span className="break-all">{content.slice(0, 300)}{content.length > 300 ? '...' : ''}</span>
          </div>
        </div>
      </div>
    );
  }

  const isUser = role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
      <div className={`max-w-2xl flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
        <div
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? 'bg-blue-600 text-white rounded-br-md'
              : 'bg-gray-800 text-gray-200 rounded-bl-md border border-gray-700'
          }`}
        >
          {isUser ? (
            <span className="whitespace-pre-wrap">{content}</span>
          ) : (
            <div className="prose-dark">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          )}
        </div>
        <span className="text-xs text-gray-600 px-1">
          {new Date(timestamp).toLocaleTimeString()}
        </span>
      </div>
    </div>
  );
}

interface SkillItem {
  id: string;
  name: string;
  command: string;
  description: string;
}

export default function ChatWindow() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [selectedCli, setSelectedCli] = useState<string>('claude');
  const [availableClis, setAvailableClis] = useState<string[]>(['claude']);

  // Slash command autocomplete
  const [allSkills, setAllSkills] = useState<SkillItem[]>([]);
  const [showAutocomplete, setShowAutocomplete] = useState(false);
  const [autocompleteItems, setAutocompleteItems] = useState<SkillItem[]>([]);
  const [autocompleteIndex, setAutocompleteIndex] = useState(0);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const activeSessionRef = useRef<string | null>(null);

  const { sendJsonMessage, lastJsonMessage, readyState } = useWebSocket(WS_URL, {
    shouldReconnect: () => true,
    reconnectInterval: 2000,
    reconnectAttempts: 20,
    onOpen: () => {
      // Re-subscribe to active session after reconnect
      if (activeSessionRef.current) {
        sendJsonMessage({ type: 'subscribe', sessionId: activeSessionRef.current });
      }
    }
  });

  const { label: wsLabel, color: wsColor } = getReadyStateLabel(readyState);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isRunning]);

  // Load available CLIs + default setting + skills on mount
  useEffect(() => {
    fetch('/api/cli-available')
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setAvailableClis(data); })
      .catch(() => {});
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        if (data.default_cli) setSelectedCli(data.default_cli);
      })
      .catch(() => {});
    fetch('/api/skills')
      .then((r) => r.json())
      .then((data: SkillItem[]) => { if (Array.isArray(data)) setAllSkills(data); })
      .catch(() => {});
  }, []);

  // Load sessions on mount
  useEffect(() => {
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((data: Session[]) => {
        if (Array.isArray(data)) {
          setSessions(data);
          if (data.length > 0) {
            setActiveSessionId(data[0].id);
          }
        }
      })
      .catch(console.error);
  }, []);

  // Subscribe to session when it changes
  useEffect(() => {
    if (!activeSessionId || readyState !== ReadyState.OPEN) return;
    activeSessionRef.current = activeSessionId;
    sendJsonMessage({ type: 'subscribe', sessionId: activeSessionId });
  }, [activeSessionId, readyState, sendJsonMessage]);

  // Handle WS messages
  useEffect(() => {
    if (!lastJsonMessage) return;
    const msg = lastJsonMessage as WsOutbound;

    switch (msg.type) {
      case 'connected':
        // Re-subscribe if we have a session
        if (activeSessionRef.current) {
          sendJsonMessage({ type: 'subscribe', sessionId: activeSessionRef.current });
        }
        break;

      case 'history': {
        const displayed = msg.messages.map(dbMessageToDisplay);
        setMessages(displayed);
        setIsRunning(msg.running);
        break;
      }

      case 'user_message':
        // Already added optimistically — skip if duplicate
        break;

      case 'assistant_message': {
        const assistantMsg: DisplayMessage = {
          id: `assistant-${Date.now()}-${Math.random()}`,
          role: 'assistant',
          content: msg.content,
          timestamp: Date.now()
        };
        setMessages((prev) => {
          // Merge with last assistant message if streaming continuation
          // (server sends individual assistant messages, not streaming chunks)
          return [...prev, assistantMsg];
        });
        break;
      }

      case 'tool_use': {
        const toolMsg: DisplayMessage = {
          id: `tool-${Date.now()}-${Math.random()}`,
          role: 'tool_use',
          content: '',
          toolName: msg.toolName,
          toolInput: msg.toolInput,
          timestamp: Date.now()
        };
        setMessages((prev) => [...prev, toolMsg]);
        break;
      }

      case 'tool_result': {
        const resultMsg: DisplayMessage = {
          id: `result-${Date.now()}-${Math.random()}`,
          role: 'tool_result',
          content: msg.content,
          timestamp: Date.now()
        };
        setMessages((prev) => [...prev, resultMsg]);
        break;
      }

      case 'result':
        setIsRunning(false);
        break;

      case 'interrupted':
        setIsRunning(false);
        break;

      case 'error':
        console.error('[WS error]:', msg.error);
        setIsRunning(false);
        break;
    }
  }, [lastJsonMessage, sendJsonMessage]);

  const createSession = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions', { method: 'POST' });
      const session: Session = await res.json();
      setSessions((prev) => [session, ...prev]);
      setActiveSessionId(session.id);
      setMessages([]);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, []);

  const handleSessionChange = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      setMessages([]);
      setIsRunning(false);
      if (readyState === ReadyState.OPEN) {
        sendJsonMessage({ type: 'subscribe', sessionId });
      }
    },
    [readyState, sendJsonMessage]
  );

  const sendMessage = useCallback(() => {
    const text = input.trim();
    if (!text || readyState !== ReadyState.OPEN || isRunning || !activeSessionId) return;

    // Optimistic user message
    const userMsg: DisplayMessage = {
      id: `local-${Date.now()}`,
      role: 'user',
      content: text,
      timestamp: Date.now()
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setIsRunning(true);

    sendJsonMessage({
      type: 'chat',
      sessionId: activeSessionId,
      content: text,
      cli: selectedCli
    });
  }, [input, readyState, isRunning, activeSessionId, sendJsonMessage]);

  const interruptSession = useCallback(() => {
    if (!activeSessionId) return;
    sendJsonMessage({ type: 'interrupt', sessionId: activeSessionId });
    setIsRunning(false);
  }, [activeSessionId, sendJsonMessage]);

  const selectAutocomplete = (skill: SkillItem) => {
    setInput(`/${skill.id} `);
    setShowAutocomplete(false);
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Autocomplete navigation
    if (showAutocomplete && autocompleteItems.length > 0) {
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        selectAutocomplete(autocompleteItems[autocompleteIndex]);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setAutocompleteIndex(i => Math.min(i + 1, autocompleteItems.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setAutocompleteIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Escape') {
        setShowAutocomplete(false);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 pt-8 pb-3 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <select
          value={activeSessionId ?? ''}
          onChange={(e) => handleSessionChange(e.target.value)}
          className="input-base flex-1 max-w-xs"
        >
          {sessions.length === 0 && <option value="">No sessions</option>}
          {sessions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title}
            </option>
          ))}
        </select>

        <button onClick={createSession} className="btn-secondary text-xs px-3 py-1.5 whitespace-nowrap">
          + New Session
        </button>

        <select
          value={selectedCli}
          onChange={(e) => setSelectedCli(e.target.value)}
          className="input-base text-xs py-1.5"
          title="Select AI CLI"
        >
          {availableClis.map((cli) => (
            <option key={cli} value={cli}>{cli}</option>
          ))}
        </select>

        {isRunning && (
          <button onClick={interruptSession} className="btn-danger text-xs px-3 py-1.5 whitespace-nowrap">
            Stop
          </button>
        )}

        {/* WS status */}
        <div className="flex items-center gap-1.5 ml-auto">
          <span
            className={`w-2 h-2 rounded-full ${
              readyState === ReadyState.OPEN ? 'bg-green-400' : 'bg-red-500'
            }`}
          />
          <span className={`text-xs ${wsColor}`}>{wsLabel}</span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !isRunning && (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
            <span className="text-4xl">🤖</span>
            <p className="text-sm">Start a conversation with Claude Agent</p>
            {sessions.length === 0 && (
              <button onClick={createSession} className="btn-primary text-xs mt-2">
                Create first session
              </button>
            )}
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Running indicator */}
        {isRunning && (
          <div className="flex justify-start mb-3">
            <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-gray-800 border border-gray-700">
              <div className="flex gap-1 items-center">
                <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-gray-700 bg-gray-800 relative">
        {/* Slash command autocomplete dropdown */}
        {showAutocomplete && autocompleteItems.length > 0 && (
          <div className="absolute bottom-full left-4 right-4 mb-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl overflow-hidden z-50 max-h-64 overflow-y-auto">
            {autocompleteItems.map((skill, i) => (
              <button
                key={skill.id}
                onClick={() => selectAutocomplete(skill)}
                className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
                  i === autocompleteIndex ? 'bg-blue-600/30 text-white' : 'text-gray-300 hover:bg-gray-700'
                }`}
              >
                <span className="text-blue-400 font-mono text-sm w-36 flex-shrink-0">/{skill.id}</span>
                <span className="text-xs text-gray-400 truncate">{skill.description}</span>
                <span className="text-xs text-gray-600 ml-auto flex-shrink-0">Tab</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              const val = e.target.value;
              setInput(val);

              // Slash command autocomplete
              if (val.startsWith('/')) {
                const query = val.slice(1).toLowerCase();
                const matches = allSkills.filter(s =>
                  s.id.includes(query) || s.name.toLowerCase().includes(query) || s.command.includes(query)
                ).slice(0, 8);
                setAutocompleteItems(matches);
                setShowAutocomplete(matches.length > 0);
                setAutocompleteIndex(0);
              } else {
                setShowAutocomplete(false);
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              !activeSessionId
                ? 'Create a session first...'
                : isRunning
                ? 'Claude is thinking...'
                : 'Message Claude Agent... (Enter to send, Shift+Enter for newline)'
            }
            rows={1}
            className="input-base flex-1 resize-none min-h-[40px] max-h-32 py-2.5 leading-relaxed"
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 128) + 'px';
            }}
            disabled={isRunning || readyState !== ReadyState.OPEN || !activeSessionId}
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || isRunning || readyState !== ReadyState.OPEN || !activeSessionId}
            className="btn-primary h-10 px-4 flex-shrink-0"
          >
            Send
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-1.5">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
