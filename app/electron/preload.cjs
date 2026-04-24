const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("claudeAgentDesktop", {
  getUpdateState: () => ipcRenderer.invoke("updater:get-state"),
  checkForUpdates: () => ipcRenderer.invoke("updater:check"),
  installUpdate: () => ipcRenderer.invoke("updater:install"),
  openReleasePage: () => ipcRenderer.invoke("updater:open-release-page"),
  onUpdateState: (listener) => {
    if (typeof listener !== "function") return () => {};
    const wrapped = (_event, state) => listener(state);
    ipcRenderer.on("updater:state", wrapped);
    return () => ipcRenderer.removeListener("updater:state", wrapped);
  },
});
