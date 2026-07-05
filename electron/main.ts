import { app, BrowserWindow, Menu, Tray, ipcMain, dialog, nativeImage, shell } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fg from "fast-glob";
import { parseDocument, serializeDocument } from "../node_modules/@csdb/javascript/dist/storage/document.js";

type DirectoryTreeNode = {
  id: string;
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: DirectoryTreeNode[];
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRootPath = app.isPackaged ? process.resourcesPath : process.cwd();
const registryPath = path.join(appRootPath, "databases.csdb");
const internalDataPath = path.join(appRootPath, "data");

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayState = {
  title: "00:00",
  isRunning: false,
  hasBreak: false
};
let isQuitting = false;

const watchers = new Map<string, fs.FSWatcher>();

function normalizeInternalDatabaseName(name: string): string {
  return name.trim().replace(/\.csdb$/i, "");
}

function internalDatabasePath(name: string): string {
  return path.join(internalDataPath, `${normalizeInternalDatabaseName(name)}.csdb`);
}

function databaseFilePath(payload: { location: "Internal" | "Path"; url: string }): string {
  return payload.location === "Internal" ? internalDatabasePath(payload.url) : payload.url.trim();
}

function databaseFileName(name: string): string {
  return `${normalizeInternalDatabaseName(name)}.csdb`;
}

function renameDatabaseDocument(raw: string, name: string): string {
  const document = parseDocument(raw);
  document.metadata.name = name;
  return serializeDocument(document);
}

function sendTrayAction(action: string) {
  if (mainWindow) {
    mainWindow.webContents.send("tray-action", action);
    if (!mainWindow.isVisible()) {
      mainWindow.show();
    }
  }
}

function updateTray() {
  if (!tray) {
    const iconSvg = encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20">
        <rect x="2" y="2" width="16" height="16" rx="5" fill="#C16032"/>
        <path d="M7 6h2v8H7zm4 0h2v8h-2z" fill="white"/>
      </svg>`
    );
    tray = new Tray(nativeImage.createFromDataURL(`data:image/svg+xml;charset=utf-8,${iconSvg}`));
  }

  if (process.platform === "darwin") {
    tray.setTitle(trayState.title);
  }

  tray.setToolTip(
    trayState.isRunning
      ? `${trayState.title}${trayState.hasBreak ? " · Break" : ""}`
      : "Strata Log"
  );

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
  } else {
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
    } else {
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

ipcMain.handle("file:create-from-template", async (_, suggestedName: string, raw: string) => {
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

ipcMain.handle("database-registry:read", async () => {
  return fs.readFileSync(registryPath, "utf8");
});

ipcMain.handle("database-registry:save", async (_, raw: string) => {
  const tempPath = `${registryPath}.tmp`;
  fs.writeFileSync(tempPath, raw, "utf8");
  fs.renameSync(tempPath, registryPath);
});

ipcMain.handle("database-file:choose-url", async (_, suggestedName: string) => {
  const result = await dialog.showSaveDialog({
    defaultPath: `${suggestedName.trim() || "strata-log"}.csdb`,
    filters: [{ name: "CSDB", extensions: ["csdb"] }]
  });
  return result.canceled || !result.filePath ? null : result.filePath;
});

ipcMain.handle("database-file:info", async (_, payload: { location: "Internal" | "Path"; url: string }) => {
  const targetPath = databaseFilePath(payload);
  if (!targetPath) {
    return null;
  }
  const exists = fs.existsSync(targetPath) && !fs.statSync(targetPath).isDirectory();
  return {
    path: targetPath,
    exists,
    updatedAt: exists ? fs.statSync(targetPath).mtime.toISOString() : null
  };
});

ipcMain.handle("database-file:load", async (_, payload: { location: "Internal" | "Path"; url: string }) => {
  const targetPath = databaseFilePath(payload);
  if (!targetPath || !fs.existsSync(targetPath) || fs.statSync(targetPath).isDirectory()) {
    return null;
  }
  return {
    handle: {
      path: targetPath,
      name: path.basename(targetPath)
    },
    raw: fs.readFileSync(targetPath, "utf8")
  };
});

ipcMain.handle("database-file:import", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "CSDB", extensions: ["csdb"] }]
  });
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  const sourcePath = result.filePaths[0];
  const registryUrl = normalizeInternalDatabaseName(path.basename(sourcePath));
  const targetPath = internalDatabasePath(registryUrl);
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  if (sourcePath !== targetPath) {
    fs.copyFileSync(sourcePath, targetPath);
  }
  return { registryUrl };
});

ipcMain.handle("database-file:reference", async () => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: [{ name: "CSDB", extensions: ["csdb"] }]
  });
  if (result.canceled || !result.filePaths[0]) {
    return null;
  }
  return { registryUrl: result.filePaths[0] };
});

ipcMain.handle("database-file:export", async (_, payload: { url: string }) => {
  const sourcePath = internalDatabasePath(payload.url);
  if (!sourcePath || !fs.existsSync(sourcePath) || fs.statSync(sourcePath).isDirectory()) {
    return false;
  }
  const result = await dialog.showSaveDialog({
    defaultPath: databaseFileName(payload.url),
    filters: [{ name: "CSDB", extensions: ["csdb"] }]
  });
  if (result.canceled || !result.filePath) {
    return false;
  }
  fs.copyFileSync(sourcePath, result.filePath);
  return true;
});

ipcMain.handle("database-file:rename", async (_, payload: { location: "Internal" | "Path"; url: string; name: string }) => {
  const nextName = normalizeInternalDatabaseName(payload.name);
  if (!nextName) {
    return null;
  }
  const currentPath = databaseFilePath(payload);
  if (!currentPath || !fs.existsSync(currentPath) || fs.statSync(currentPath).isDirectory()) {
    return null;
  }
  const nextPath = payload.location === "Internal"
    ? internalDatabasePath(nextName)
    : path.join(path.dirname(currentPath), databaseFileName(nextName));
  if (currentPath !== nextPath && fs.existsSync(nextPath)) {
    return null;
  }
  const registryUrl = payload.location === "Internal" ? nextName : nextPath;
  const raw = renameDatabaseDocument(fs.readFileSync(currentPath, "utf8"), nextName);
  fs.mkdirSync(path.dirname(nextPath), { recursive: true });
  fs.writeFileSync(`${nextPath}.tmp`, raw, "utf8");
  fs.renameSync(`${nextPath}.tmp`, nextPath);
  if (currentPath !== nextPath && fs.existsSync(currentPath)) {
    watchers.get(currentPath)?.close();
    watchers.delete(currentPath);
    fs.unlinkSync(currentPath);
  }
  return {
    handle: {
      path: nextPath,
      name: path.basename(nextPath)
    },
    registryUrl,
    raw
  };
});

ipcMain.handle("database-file:create", async (_, payload: { location: "Internal" | "Path"; url: string; raw: string }) => {
  const registryUrl = payload.location === "Internal" ? normalizeInternalDatabaseName(payload.url) : payload.url.trim();
  if (!registryUrl) {
    return null;
  }
  const targetPath = databaseFilePath({ location: payload.location, url: registryUrl });
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, payload.raw, "utf8");
  return {
    handle: {
      path: targetPath,
      name: path.basename(targetPath)
    },
    registryUrl,
    raw: payload.raw
  };
});

ipcMain.handle("database-file:delete", async (_, payload: { location: "Internal" | "Path"; url: string }) => {
  const targetPath = databaseFilePath(payload);
  watchers.get(targetPath)?.close();
  watchers.delete(targetPath);
  if (fs.existsSync(targetPath)) {
    await shell.trashItem(targetPath);
  }
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

function buildDirectoryTree(targetPath: string): DirectoryTreeNode[] {
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

ipcMain.handle("path:list-markdown-files", async (_event, pattern: string, baseDir?: string): Promise<string[]> => {
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

ipcMain.handle("file:read", async (_event, filePath: string): Promise<string> => {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
});

ipcMain.handle("file:save", async (_, filePath: string, raw: string) => {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, raw, "utf8");
  fs.renameSync(tempPath, filePath);
});

ipcMain.handle("file:watch", async (event, filePath: string) => {
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

ipcMain.handle("file:unwatch", async (_, filePath: string) => {
  watchers.get(filePath)?.close();
  watchers.delete(filePath);
});

ipcMain.handle("tray:update-state", async (_, payload) => {
  trayState = payload;
  updateTray();
});
