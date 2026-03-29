import { useState, useEffect, useCallback } from 'react';
import type { Page, Session } from './types';
import type { Locale } from './i18n';
import { setLocale, getLocale } from './i18n';
import Sidebar from './components/Sidebar';
import ChatWindow from './components/ChatWindow';
import SkillsPage from './components/SkillsPage';
import MemoryPage from './components/MemoryPage';
import SettingsPage from './components/SettingsPage';
import ChannelsPage from './components/ChannelsPage';
import McpPage from './components/McpPage';
import HistoryPage from './components/HistoryPage';
import AgentsPage from './components/AgentsPage';
import ScheduledTasksPage from './components/ScheduledTasksPage';
import SecretsPage from './components/SecretsPage';
import ConfigBotPage from './components/ConfigBotPage';
import ProjectsPage from './components/ProjectsPage';
import RolesPage from './components/RolesPage';

export default function App() {
  const [activePage, setActivePage] = useState<Page>('chat');
  const [sessionCount, setSessionCount] = useState(0);
  const [locale, setLocaleState] = useState<Locale>(getLocale());

  const handleLocaleChange = useCallback((newLocale: Locale) => {
    setLocale(newLocale);
    setLocaleState(newLocale);
  }, []);

  // Fetch session count for the sidebar badge
  useEffect(() => {
    fetch('/api/sessions')
      .then((r) => r.json())
      .then((data: Session[]) => {
        if (Array.isArray(data)) setSessionCount(data.length);
      })
      .catch(() => {});
  }, []);

  // Load saved locale from settings
  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        if (data.language) handleLocaleChange(data.language as Locale);
      })
      .catch(() => {});
  }, [handleLocaleChange]);

  const renderPage = () => {
    switch (activePage) {
      case 'chat':
        return <ChatWindow />;
      case 'history':
        return <HistoryPage />;
      case 'skills':
        return <SkillsPage key={locale} />;
      case 'agents':
        return <AgentsPage key={locale} />;
      case 'memory':
        return <MemoryPage />;
      case 'mcp':
        return <McpPage key={locale} />;
      case 'tasks':
        return <ScheduledTasksPage key={locale} />;
      case 'secrets':
        return <SecretsPage key={locale} />;
      case 'settings':
        return <SettingsPage onLocaleChange={handleLocaleChange} />;
      case 'channels':
        return <ChannelsPage />;
      case 'config':
        return <ConfigBotPage key={locale} />;
      case 'projects':
        return <ProjectsPage key={locale} />;
      case 'roles':
        return <RolesPage key={locale} />;
      default:
        return <ChatWindow />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-gray-900 relative">
      {/* macOS draggable titlebar region */}
      <div className="absolute top-0 left-0 right-0 h-8 z-50" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties} />
      <Sidebar
        key={locale}
        activePage={activePage}
        onNavigate={setActivePage}
        sessionCount={sessionCount}
      />
      <main className="flex-1 overflow-hidden flex flex-col">
        {renderPage()}
      </main>
    </div>
  );
}
