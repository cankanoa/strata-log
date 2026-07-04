import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("strata", {
    openFile: () => ipcRenderer.invoke("file:open"),
    createFileFromTemplate: (suggestedName, raw) => ipcRenderer.invoke("file:create-from-template", suggestedName, raw),
    choosePath: () => ipcRenderer.invoke("path:choose"),
    listMarkdownFiles: (pattern, baseDir) => ipcRenderer.invoke("path:list-markdown-files", pattern, baseDir),
    readTextFile: (path) => ipcRenderer.invoke("file:read", path),
    saveFile: (path, raw) => ipcRenderer.invoke("file:save", path, raw),
    watchFile: async (path, callback) => {
        const listener = (_event, payload) => {
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
    onTrayAction: (callback) => {
        const listener = (_event, action) => callback(action);
        ipcRenderer.on("tray-action", listener);
        return () => ipcRenderer.off("tray-action", listener);
    },
    updateTrayState: (payload) => ipcRenderer.invoke("tray:update-state", payload)
});
