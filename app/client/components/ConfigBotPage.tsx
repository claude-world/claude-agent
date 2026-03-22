import { useState, useEffect, useRef, useCallback } from 'react';
import useWebSocket, { ReadyState } from 'react-use-websocket';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Session, DbMessage } from '../types';
import { t } from '../i18n';
import ToolUseBlock from './ToolUseBlock';

const WS_URL = '/ws';

// Config bot uses a single fixed session title
const CONFIG_SESSION_TITLE = 'Config Bot';

interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool_use' | 'tool_result';
  content: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  timestamp: number;
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
    timestamp: new Date(m.created_at).getTime(),
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
              input: toolInput ?? {},
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
            <span className="break-all">
              {content.slice(0, 300)}
              {content.length > 300 ? '...' : ''}
            </span>
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
              ? 'bg-indigo-600 text-white rounded-br-md'
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

const QUICK_CHIPS = [
  { labelKey: 'config.chipSettings', value: 'Show me all current settings' },
  { labelKey: 'config.chipSkills', value: 'List all available skills' },
  { labelKey: 'config.chipSecrets', value: 'Help me add a new secret / API key' },
  { labelKey: 'config.chipMcp', value: 'Show and manage MCP servers' },
  { labelKey: 'config.chipChannels', value: 'Show and manage channel connections' },
  { labelKey: 'config.chipCli', value: 'Detect installed AI CLIs' },
];

export default function ConfigBotPage() {
  const [configSessionId, setConfigSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const sessionIdRef = useRef<string | null>(null);

  const { sendJsonMessage, lastJsonMessage, readyState } = useWebSocket(WS_URL, {
    shouldReconnect: () => true,
    reconnectInterval: 2000,
    reconnectAttempts: 20,
    onOpen: () => {
      if (sessionIdRef.current) {
        sendJsonMessage({ type: 'subscribe', sessionId: sessionIdRef.current });
      }
    },
  });

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isRunning]);

  // Find or create the single Config Bot session
  useEffect(() => {
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((data: Session[]) => {
        if (!Array.isArray(data)) return;
        const existing = data.find((s) => s.title === CONFIG_SESSION_TITLE);
        if (existing) {
          setConfigSessionId(existing.id);
          sessionIdRef.current = existing.id;
        } else {
          // Create it
          fetch('/api/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title: CONFIG_SESSION_TITLE }),
          })
            .then((r) => r.json())
            .then((s: Session) => {
              setConfigSessionId(s.id);
              sessionIdRef.current = s.id;
            })
            .catch(console.error);
        }
      })
      .catch(console.error);
  }, []);

  // Subscribe when session is ready and WS is open
  useEffect(() => {
    if (!configSessionId || readyState !== ReadyState.OPEN) return;
    sendJsonMessage({ type: 'subscribe', sessionId: configSessionId });
  }, [configSessionId, readyState, sendJsonMessage]);

  // Handle WS messages
  useEffect(() => {
    if (!lastJsonMessage) return;
    const msg = lastJsonMessage as any;

    switch (msg.type) {
      case 'connected':
        if (sessionIdRef.current) {
          sendJsonMessage({ type: 'subscribe', sessionId: sessionIdRef.current });
        }
        break;

      case 'history': {
        const displayed = (msg.messages as DbMessage[]).map(dbMessageToDisplay);
        setMessages(displayed);
        setIsRunning(msg.running);
        break;
      }

      case 'user_message':
        break;

      case 'assistant_message': {
        const assistantMsg: DisplayMessage = {
          id: `assistant-${Date.now()}-${Math.random()}`,
          role: 'assistant',
          content: msg.content,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        break;
      }

      case 'tool_use': {
        const toolMsg: DisplayMessage = {
          id: `tool-${Date.now()}-${Math.random()}`,
          role: 'tool_use',
          content: '',
          toolName: msg.toolName,
          toolInput: msg.toolInput,
          timestamp: Date.now(),
        };
        setMessages((prev) => [...prev, toolMsg]);
        break;
      }

      case 'tool_result': {
        const resultMsg: DisplayMessage = {
          id: `result-${Date.now()}-${Math.random()}`,
          role: 'tool_result',
          content: msg.content,
          timestamp: Date.now(),
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
        console.error('[ConfigBot WS error]:', msg.error);
        setIsRunning(false);
        break;
    }
  }, [lastJsonMessage, sendJsonMessage]);

  const sendMessage = useCallback(
    (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || readyState !== ReadyState.OPEN || isRunning || !configSessionId) return;

      const userMsg: DisplayMessage = {
        id: `local-${Date.now()}`,
        role: 'user',
        content,
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      if (!text) setInput('');
      setIsRunning(true);

      sendJsonMessage({
        type: 'chat',
        sessionId: configSessionId,
        content,
        cli: 'claude',
        configBot: true,
      });
    },
    [input, readyState, isRunning, configSessionId, sendJsonMessage]
  );

  const interruptSession = useCallback(() => {
    if (!configSessionId) return;
    sendJsonMessage({ type: 'interrupt', sessionId: configSessionId });
    setIsRunning(false);
  }, [configSessionId, sendJsonMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const wsOpen = readyState === ReadyState.OPEN;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 pt-8 pb-3 border-b border-gray-700 bg-gray-800 flex-shrink-0">
        <span className="text-2xl">🛠️</span>
        <div className="flex-1 min-w-0">
          <h2 className="text-base font-semibold text-gray-100 leading-tight">{t('config.title')}</h2>
          <p className="text-xs text-gray-500 truncate">{t('config.subtitle')}</p>
        </div>
        {isRunning && (
          <button onClick={interruptSession} className="btn-danger text-xs px-3 py-1.5 whitespace-nowrap">
            Stop
          </button>
        )}
        <div className="flex items-center gap-1.5">
          <span
            className={`w-2 h-2 rounded-full ${wsOpen ? 'bg-green-400' : 'bg-red-500'}`}
          />
          <span className={`text-xs ${wsOpen ? 'text-green-400' : 'text-red-400'}`}>
            {wsOpen ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>

      {/* Quick action chips */}
      <div className="flex-shrink-0 px-4 py-2 border-b border-gray-700 bg-gray-850 flex flex-wrap gap-2">
        {QUICK_CHIPS.map(({ labelKey, value }) => (
          <button
            key={labelKey}
            onClick={() => sendMessage(value)}
            disabled={isRunning || !wsOpen || !configSessionId}
            className="text-xs px-3 py-1.5 rounded-full bg-gray-700 hover:bg-indigo-700 text-gray-300 hover:text-white border border-gray-600 hover:border-indigo-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t(labelKey)}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && !isRunning && (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
            <span className="text-4xl">🛠️</span>
            <p className="text-sm text-gray-500">{t('config.subtitle')}</p>
            <p className="text-xs text-gray-600">Use the quick actions above or type a request below</p>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {isRunning && (
          <div className="flex justify-start mb-3">
            <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-gray-800 border border-gray-700">
              <div className="flex gap-1 items-center">
                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-gray-700 bg-gray-800">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !configSessionId
                ? 'Initializing...'
                : isRunning
                ? 'Config Bot is working...'
                : t('config.placeholder')
            }
            rows={1}
            className="input-base flex-1 resize-none min-h-[40px] max-h-32 py-2.5 leading-relaxed"
            onInput={(e) => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = Math.min(el.scrollHeight, 128) + 'px';
            }}
            disabled={isRunning || !wsOpen || !configSessionId}
          />
          <button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isRunning || !wsOpen || !configSessionId}
            className="btn-primary h-10 px-4 flex-shrink-0"
          >
            {t('chat.send')}
          </button>
        </div>
        <p className="text-xs text-gray-600 mt-1.5">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
