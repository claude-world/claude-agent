/// <reference types="vite/client" />

interface DesktopUpdateState {
  supported: boolean;
  checking: boolean;
  available: boolean;
  downloading: boolean;
  downloaded: boolean;
  currentVersion: string;
  latestVersion: string | null;
  progressPercent: number | null;
  error: string | null;
}

interface DesktopUpdaterAPI {
  getUpdateState: () => Promise<DesktopUpdateState>;
  checkForUpdates: () => Promise<DesktopUpdateState>;
  installUpdate: () => Promise<{ ok: boolean }>;
  openReleasePage: () => Promise<{ ok: boolean }>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
}

interface Window {
  claudeAgentDesktop?: DesktopUpdaterAPI;
}
