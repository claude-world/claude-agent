import type { Page } from '../types';
import { t } from '../i18n';

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
  sessionCount: number;
}

interface NavItem {
  page: Page;
  labelKey: string;
  icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { page: 'chat', labelKey: 'nav.chat', icon: '💬' },
  { page: 'history', labelKey: 'nav.history', icon: '📋' },
  { page: 'projects', labelKey: 'nav.projects', icon: '🏛️' },
  { page: 'skills', labelKey: 'nav.skills', icon: '⚡' },
  { page: 'memory', labelKey: 'nav.memory', icon: '🧠' },
  { page: 'agents', labelKey: 'nav.agents', icon: '🤖' },
  { page: 'mcp', labelKey: 'nav.mcp', icon: '🔌' },
  { page: 'secrets', labelKey: 'nav.secrets', icon: '🔑' },
  { page: 'tasks', labelKey: 'nav.tasks', icon: '⏰' },
  { page: 'config', labelKey: 'nav.config', icon: '🛠️' },
  { page: 'settings', labelKey: 'nav.settings', icon: '⚙️' },
  { page: 'channels', labelKey: 'nav.channels', icon: '📡' }
];

export default function Sidebar({ activePage, onNavigate, sessionCount }: SidebarProps) {
  return (
    <aside className="w-56 flex-shrink-0 bg-gray-800 border-r border-gray-700 flex flex-col h-full">
      {/* App title */}
      <div className="px-4 pt-10 pb-4 border-b border-gray-700">
        <h1 className="text-lg font-bold text-gray-100 flex items-center gap-2">
          <span className="text-xl">🤖</span>
          {t('app.title')}
        </h1>
        <p className="text-xs text-gray-500 mt-0.5">{t('app.subtitle')}</p>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        {NAV_ITEMS.map(({ page, labelKey, icon }) => (
          <button
            key={page}
            onClick={() => onNavigate(page)}
            className={`sidebar-link w-full text-left ${activePage === page ? 'active' : ''}`}
          >
            <span className="text-base leading-none">{icon}</span>
            <span className="flex-1">{t(labelKey)}</span>
            {page === 'chat' && sessionCount > 0 && (
              <span className="bg-blue-600 text-white text-xs rounded-full px-1.5 py-0.5 leading-none min-w-[20px] text-center">
                {sessionCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-gray-700">
        <p className="text-xs text-gray-600">v1.0.0 · claude-agent</p>
      </div>
    </aside>
  );
}
