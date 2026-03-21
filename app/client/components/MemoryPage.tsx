import { useState, useEffect } from 'react';
import type { MemoryFile } from '../types';

const KNOWN_FILES = [
  { filename: 'MEMORY.md', description: 'Index of all memory files' },
  { filename: 'user-profile.md', description: 'Identity, preferences, style' },
  { filename: 'active-threads.md', description: 'Ongoing conversations by channel' },
  { filename: 'pending-tasks.md', description: 'Tasks, reminders, deadlines' },
  { filename: 'learned-today.md', description: 'Facts learned today' },
  { filename: 'contacts.md', description: 'People the user mentions' }
];

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleString();
}

export default function MemoryPage() {
  const [files, setFiles] = useState<MemoryFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  useEffect(() => {
    fetch('/api/memory')
      .then((r) => r.json())
      .then((data: MemoryFile[]) => {
        if (Array.isArray(data)) {
          setFiles(data);
        } else {
          // Fallback: use known files list with dummy metadata
          setFiles(
            KNOWN_FILES.map((f) => ({
              filename: f.filename,
              size: 0,
              modified_at: Date.now()
            }))
          );
        }
      })
      .catch(() => {
        setFiles(
          KNOWN_FILES.map((f) => ({
            filename: f.filename,
            size: 0,
            modified_at: Date.now()
          }))
        );
      });
  }, []);

  const loadFile = (filename: string) => {
    setActiveFile(filename);
    setIsEditing(false);
    setError(null);
    setLoadingContent(true);
    fetch(`/api/memory/${encodeURIComponent(filename)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: { filename: string; content: string }) => {
        setContent(data.content ?? '');
        setEditContent(data.content ?? '');
      })
      .catch((err) => {
        setContent('');
        setError(`Failed to load file: ${err.message}`);
      })
      .finally(() => setLoadingContent(false));
  };

  const startEdit = () => {
    setEditContent(content);
    setIsEditing(true);
    setSaveSuccess(false);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditContent(content);
  };

  const saveFile = async () => {
    if (!activeFile) return;
    setIsSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/memory/${encodeURIComponent(activeFile)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setContent(editContent);
      setIsEditing(false);
      setSaveSuccess(true);
      // Update file list size
      setFiles((prev) =>
        prev.map((f) =>
          f.filename === activeFile
            ? { ...f, size: new Blob([editContent]).size, modified_at: Date.now() }
            : f
        )
      );
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setError(`Save failed: ${(err as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const getFileDescription = (filename: string) =>
    KNOWN_FILES.find((f) => f.filename === filename)?.description ?? '';

  return (
    <div className="flex h-full">
      {/* File list */}
      <div className="w-64 flex-shrink-0 border-r border-gray-700 flex flex-col">
        <div className="px-4 pt-8 pb-4 border-b border-gray-700 bg-gray-800">
          <h2 className="text-lg font-semibold text-gray-100">Memory</h2>
          <p className="text-xs text-gray-400 mt-0.5">{files.length} files</p>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {files.map((file) => (
            <button
              key={file.filename}
              onClick={() => loadFile(file.filename)}
              className={`w-full text-left rounded-lg p-3 transition-colors ${
                activeFile === file.filename
                  ? 'bg-blue-600/20 border border-blue-600/40 text-blue-300'
                  : 'hover:bg-gray-700 text-gray-300 border border-transparent'
              }`}
            >
              <p className="text-sm font-medium truncate">{file.filename}</p>
              <p className="text-xs text-gray-500 mt-0.5">{getFileDescription(file.filename)}</p>
              <div className="flex items-center gap-2 mt-1">
                {file.size > 0 && (
                  <span className="text-xs text-gray-600">{formatFileSize(file.size)}</span>
                )}
                {file.modified_at > 0 && (
                  <span className="text-xs text-gray-600">{formatDate(file.modified_at)}</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {activeFile ? (
          <>
            {/* File header */}
            <div className="flex items-center justify-between px-6 pt-8 pb-3 border-b border-gray-700 bg-gray-800 flex-shrink-0">
              <div>
                <h3 className="text-sm font-semibold text-gray-100">{activeFile}</h3>
                {getFileDescription(activeFile) && (
                  <p className="text-xs text-gray-400">{getFileDescription(activeFile)}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {saveSuccess && (
                  <span className="text-xs text-green-400">Saved successfully</span>
                )}
                {error && <span className="text-xs text-red-400">{error}</span>}
                {isEditing ? (
                  <>
                    <button onClick={cancelEdit} className="btn-secondary text-xs py-1.5">
                      Cancel
                    </button>
                    <button
                      onClick={saveFile}
                      disabled={isSaving}
                      className="btn-primary text-xs py-1.5"
                    >
                      {isSaving ? 'Saving...' : 'Save'}
                    </button>
                  </>
                ) : (
                  <button onClick={startEdit} className="btn-secondary text-xs py-1.5">
                    Edit
                  </button>
                )}
              </div>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-hidden">
              {loadingContent ? (
                <div className="flex items-center justify-center h-full text-gray-500 text-sm">
                  Loading...
                </div>
              ) : isEditing ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-full bg-gray-900 text-gray-200 font-mono text-sm p-6 resize-none focus:outline-none border-0"
                  spellCheck={false}
                />
              ) : (
                <pre className="w-full h-full overflow-auto p-6 text-sm text-gray-300 font-mono whitespace-pre-wrap leading-relaxed">
                  {content || (
                    <span className="text-gray-600 italic">File is empty or could not be loaded.</span>
                  )}
                </pre>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-2">
            <span className="text-4xl">🧠</span>
            <p className="text-sm">Select a memory file to view or edit</p>
          </div>
        )}
      </div>
    </div>
  );
}
