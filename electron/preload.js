import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("strata", {
    openFile: () => ipcRenderer.invoke("file:open"),
    createFileFromTemplate: (suggestedName, raw) => ipcRenderer.invoke("file:create-from-template", suggestedName, raw),
    readDatabaseRegistry: () => ipcRenderer.invoke("database-registry:read"),
    saveDatabaseRegistry: (raw) => ipcRenderer.invoke("database-registry:save", raw),
    chooseDatabaseUrl: (suggestedName) => ipcRenderer.invoke("database-file:choose-url", suggestedName),
    getDatabaseFileInfo: (payload) => ipcRenderer.invoke("database-file:info", payload),
    loadDatabaseFile: (payload) => ipcRenderer.invoke("database-file:load", payload),
    importDatabaseFile: () => ipcRenderer.invoke("database-file:import"),
    referenceDatabaseFile: () => ipcRenderer.invoke("database-file:reference"),
    exportDatabaseFile: (payload) => ipcRenderer.invoke("database-file:export", payload),
    renameDatabaseFile: (payload) => ipcRenderer.invoke("database-file:rename", payload),
    createDatabaseFile: (payload) => ipcRenderer.invoke("database-file:create", payload),
    deleteDatabaseFile: (payload) => ipcRenderer.invoke("database-file:delete", payload),
    choosePath: () => ipcRenderer.invoke("path:choose"),
    listFiles: (pattern, baseDir) => ipcRenderer.invoke("path:list-files", pattern, baseDir),
    getTextFileInfo: (path) => ipcRenderer.invoke("file:info", path),
    readTextFile: (path) => ipcRenderer.invoke("file:read", path),
    readFileDataUrl: (path) => ipcRenderer.invoke("file:read-data-url", path),
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
