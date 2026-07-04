import { app, BrowserWindow, Menu, Tray, ipcMain, dialog, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
let mainWindow = null;
let tray = null;
let trayState = {
    title: "00:00",
    isRunning: false,
    hasBreak: false
};
let isQuitting = false;
const watchers = new Map();
function sendTrayAction(action) {
    if (mainWindow) {
        mainWindow.webContents.send("tray-action", action);
        if (!mainWindow.isVisible()) {
            mainWindow.show();
        }
    }
}
function updateTray() {
    if (!tray) {
        const iconSvg = encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
        <rect x="2" y="2" width="16" height="16" rx="5" fill="#C16032"/>
        <path d="M7 6h2v8H7zm4 0h2v8h-2z" fill="white"/>
      </svg>`);
        tray = new Tray(nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${iconSvg}`));
    }
    if (process.platform === "darwin") {
        tray.setTitle(trayState.title);
    }
    tray.setToolTip(trayState.isRunning
        ? `${trayState.title}${trayState.hasBreak ? " · Break" : ""}`
        : "Strata Log");
    const menu = Menu.buildFromTemplate([
        {
            label: trayState.isRunning ? `Running ${trayState.title}` : "No active session",
            enabled: false
        },
        {
            label: "Open Timer",
            click: () => sendTrayAction("open-timer")
        },
        {
            label: "Open Entries",
            click: () => sendTrayAction("open-entries")
        },
        {
            label: "Open Fields",
            click: () => sendTrayAction("open-fields")
        },
        { type: "separator" },
        {
            label: "Quit",
            click: () => app.quit()
        }
    ]);
    tray.setContextMenu(menu);
    tray.on("click", () => {
        if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
        }
    });
}
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1420,
        height: 940,
        minWidth: 1100,
        minHeight: 760,
        title: "Strata Log",
        backgroundColor: "#f7f2ea",
        webPreferences: {
            preload: path.join(__dirname, "preload.mjs"),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    if (process.env.VITE_DEV_SERVER_URL) {
        void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    }
    else {
        void mainWindow.loadFile(path.join(__dirname, "../dist/index.html"));
    }
    mainWindow.on("close", (event) => {
        if (!isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });
}
app.whenReady().then(() => {
    createWindow();
    updateTray();
    app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
        else {
            mainWindow?.show();
        }
    });
});
app.on("before-quit", () => {
    isQuitting = true;
    for (const watcher of Array.from(watchers.values())) {
        watcher.close();
    }
});
app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});
ipcMain.handle("file:open", async () => {
    const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        filters: [{ name: "CSDB", extensions: ["csdb"] }]
    });
    if (result.canceled || !result.filePaths[0]) {
        return null;
    }
    const targetPath = result.filePaths[0];
    return {
        handle: {
            path: targetPath,
            name: path.basename(targetPath)
        },
        raw: fs.readFileSync(targetPath, "utf8")
    };
});
ipcMain.handle("file:create-from-template", async (_, suggestedName, raw) => {
    const result = await dialog.showSaveDialog({
        defaultPath: `${suggestedName}.csdb`,
        filters: [{ name: "CSDB", extensions: ["csdb"] }]
    });
    if (result.canceled || !result.filePath) {
        return null;
    }
    fs.writeFileSync(result.filePath, raw, "utf8");
    return {
        handle: {
            path: result.filePath,
            name: path.basename(result.filePath)
        },
        raw
    };
});
ipcMain.handle("path:choose", async () => {
    const result = await dialog.showOpenDialog({
        properties: ["openFile", "openDirectory"]
    });
    if (result.canceled || !result.filePaths[0]) {
        return null;
    }
    return result.filePaths[0];
});
function buildDirectoryTree(targetPath) {
    if (!fs.existsSync(targetPath)) {
        return [];
    }
    const stats = fs.statSync(targetPath);
    if (stats.isFile()) {
        return [
            {
                id: targetPath,
                name: path.basename(targetPath),
                path: targetPath,
                kind: "file"
            }
        ];
    }
    const entries = fs.readdirSync(targetPath, { withFileTypes: true });
    return entries
        .sort((left, right) => {
        if (left.isDirectory() && !right.isDirectory()) {
            return -1;
        }
        if (!left.isDirectory() && right.isDirectory()) {
            return 1;
        }
        return left.name.localeCompare(right.name);
    })
        .map((entry) => {
        const entryPath = path.join(targetPath, entry.name);
        return {
            id: entryPath,
            name: entry.name,
            path: entryPath,
            kind: entry.isDirectory() ? "directory" : "file",
            children: entry.isDirectory() ? buildDirectoryTree(entryPath) : undefined
        };
    });
}
ipcMain.handle("path:list-markdown-files", async (_event, pattern, baseDir) => {
    if (!pattern || !/\.md(?:$|[\\/[*?{])/i.test(pattern)) {
        return [];
    }
    return fg(pattern, {
        absolute: true,
        onlyFiles: true,
        cwd: baseDir,
        unique: true
    });
});
ipcMain.handle("file:read", async (_event, filePath) => {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        return "";
    }
    return fs.readFileSync(filePath, "utf8");
});
ipcMain.handle("file:save", async (_, filePath, raw) => {
    const tempPath = `${filePath}.tmp`;
    fs.writeFileSync(tempPath, raw, "utf8");
    fs.renameSync(tempPath, filePath);
});
ipcMain.handle("file:watch", async (event, filePath) => {
    watchers.get(filePath)?.close();
    const watcher = fs.watch(filePath, { persistent: false }, () => {
        if (!fs.existsSync(filePath)) {
            return;
        }
        const raw = fs.readFileSync(filePath, "utf8");
        event.sender.send("file:changed", {
            path: filePath,
            raw
        });
    });
    watchers.set(filePath, watcher);
    return true;
});
ipcMain.handle("file:unwatch", async (_, filePath) => {
    watchers.get(filePath)?.close();
    watchers.delete(filePath);
});
ipcMain.handle("tray:update-state", async (_, payload) => {
    trayState = payload;
    updateTray();
});
