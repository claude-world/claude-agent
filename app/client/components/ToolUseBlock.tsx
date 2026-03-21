import { useState } from 'react';
import type { ToolUseContent } from '../types';

interface ToolUseBlockProps {
  tool: ToolUseContent;
}

type ToolColor = {
  bg: string;
  border: string;
  badge: string;
  label: string;
};

const TOOL_COLORS: Record<string, ToolColor> = {
  Bash: {
    bg: 'bg-yellow-950',
    border: 'border-yellow-800',
    badge: 'bg-yellow-900 text-yellow-300',
    label: 'Bash'
  },
  Read: {
    bg: 'bg-blue-950',
    border: 'border-blue-800',
    badge: 'bg-blue-900 text-blue-300',
    label: 'Read'
  },
  Write: {
    bg: 'bg-green-950',
    border: 'border-green-800',
    badge: 'bg-green-900 text-green-300',
    label: 'Write'
  },
  Edit: {
    bg: 'bg-orange-950',
    border: 'border-orange-800',
    badge: 'bg-orange-900 text-orange-300',
    label: 'Edit'
  },
  WebSearch: {
    bg: 'bg-purple-950',
    border: 'border-purple-800',
    badge: 'bg-purple-900 text-purple-300',
    label: 'WebSearch'
  },
  Glob: {
    bg: 'bg-teal-950',
    border: 'border-teal-800',
    badge: 'bg-teal-900 text-teal-300',
    label: 'Glob'
  },
  Grep: {
    bg: 'bg-pink-950',
    border: 'border-pink-800',
    badge: 'bg-pink-900 text-pink-300',
    label: 'Grep'
  }
};

function getToolColor(name: string): ToolColor {
  return (
    TOOL_COLORS[name] ?? {
      bg: 'bg-gray-850',
      border: 'border-gray-600',
      badge: 'bg-gray-700 text-gray-300',
      label: name
    }
  );
}

function formatInput(input: Record<string, unknown>): string {
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return String(input);
  }
}

function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

export default function ToolUseBlock({ tool }: ToolUseBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const colors = getToolColor(tool.name);
  const formattedInput = formatInput(tool.input);
  const isLong = formattedInput.length > 200;
  const displayInput = expanded || !isLong ? formattedInput : truncate(formattedInput, 200);

  return (
    <div
      className={`rounded-lg border ${colors.bg} ${colors.border} text-xs font-mono my-1 overflow-hidden`}
    >
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/5 transition-colors text-left"
        aria-expanded={expanded}
      >
        <span className={`badge px-2 py-0.5 rounded text-xs font-bold ${colors.badge}`}>
          {colors.label}
        </span>
        <span className="text-gray-300 flex-1 truncate">{tool.name}</span>
        <span className="text-gray-500 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {/* Body */}
      <div className={`px-3 pb-2 ${expanded ? 'block' : 'block'}`}>
        <pre className="text-gray-400 whitespace-pre-wrap break-all leading-relaxed">
          {displayInput}
        </pre>
        {isLong && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-blue-400 hover:text-blue-300 text-xs"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </div>
  );
}
