import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("strata", {
  openFile: () => ipcRenderer.invoke("file:open"),
  createFileFromTemplate: (suggestedName: string, raw: string) =>
    ipcRenderer.invoke("file:create-from-template", suggestedName, raw),
  readDatabaseRegistry: () => ipcRenderer.invoke("database-registry:read"),
  saveDatabaseRegistry: (raw: string) => ipcRenderer.invoke("database-registry:save", raw),
  chooseDatabaseUrl: (suggestedName: string) => ipcRenderer.invoke("database-file:choose-url", suggestedName),
  getDatabaseFileInfo: (payload: { location: "Internal" | "Path"; url: string }) =>
    ipcRenderer.invoke("database-file:info", payload),
  loadDatabaseFile: (payload: { location: "Internal" | "Path"; url: string }) =>
    ipcRenderer.invoke("database-file:load", payload),
  importDatabaseFile: () => ipcRenderer.invoke("database-file:import"),
  referenceDatabaseFile: () => ipcRenderer.invoke("database-file:reference"),
  exportDatabaseFile: (payload: { url: string }) => ipcRenderer.invoke("database-file:export", payload),
  renameDatabaseFile: (payload: { location: "Internal" | "Path"; url: string; name: string }) =>
    ipcRenderer.invoke("database-file:rename", payload),
  createDatabaseFile: (payload: { location: "Internal" | "Path"; url: string; raw: string }) =>
    ipcRenderer.invoke("database-file:create", payload),
  deleteDatabaseFile: (payload: { location: "Internal" | "Path"; url: string }) =>
    ipcRenderer.invoke("database-file:delete", payload),
  choosePath: () => ipcRenderer.invoke("path:choose"),
  listMarkdownFiles: (pattern: string, baseDir?: string) => ipcRenderer.invoke("path:list-markdown-files", pattern, baseDir),
  readTextFile: (path: string) => ipcRenderer.invoke("file:read", path),
  saveFile: (path: string, raw: string) => ipcRenderer.invoke("file:save", path, raw),
  watchFile: async (path: string, callback: (raw: string) => void) => {
    const listener = (_event: unknown, payload: { path: string; raw: string }) => {
      if (payload.path === path) {
        callback(payload.raw);
      }
    };
    ipcRenderer.on("file:changed", listener);
    await ipcRenderer.invoke("file:watch", path);
    return async () => {
      ipcRenderer.off("file:changed", listener);
      await ipcRenderer.invoke("file:unwatch", path);
    };
  },
  onTrayAction: (callback: (action: string) => void) => {
    const listener = (_event: unknown, action: string) => callback(action);
    ipcRenderer.on("tray-action", listener);
    return () => ipcRenderer.off("tray-action", listener);
  },
  updateTrayState: (payload: { title: string; isRunning: boolean; hasBreak: boolean }) =>
    ipcRenderer.invoke("tray:update-state", payload)
});
