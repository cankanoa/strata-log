import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("strata", {
  openFile: () => ipcRenderer.invoke("file:open"),
  createFileFromTemplate: (suggestedName: string, raw: string) =>
    ipcRenderer.invoke("file:create-from-template", suggestedName, raw),
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
