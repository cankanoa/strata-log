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
const appIconPath = app.isPackaged
  ? path.join(__dirname, "../dist/taskasaur_icon.png")
  : path.join(process.cwd(), "public/taskasaur_icon.png");

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayDisplayMode: "focus" | "track" = "focus";
let trayMenuSignature = "";
let trayState = {
  focus: { title: "15:00", isRunning: false, mode: "focus" as "focus" | "break" },
  track: { title: "00:00", isRunning: false },
  presets: [] as Array<{ id: string; name: string }>
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

function isTaskasaurRepositoryUrl(url: string): boolean {
  try {
    const target = new URL(url);
    return target.protocol === "https:"
      && target.hostname === "github.com"
      && (target.pathname === "/taskasaur/taskasaur" || target.pathname.startsWith("/taskasaur/taskasaur/"));
  } catch {
    return false;
  }
}

function renameDatabaseDocument(raw: string, name: string): string {
  const document = parseDocument(raw);
  document.metadata.name = name;
  return serializeDocument(document);
}

function sendTrayAction(action: string, revealWindow = false) {
  if (mainWindow) {
    mainWindow.webContents.send("tray-action", action);
    if (revealWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }
}

function updateTray() {
  if (process.platform !== "darwin") {
    return;
  }

  if (!tray) {
    tray = new Tray(nativeImage.createEmpty());
    tray.on("click", () => tray?.popUpContextMenu());
  }

  const displayedTimer = trayDisplayMode === "focus" ? trayState.focus : trayState.track;
  tray.setTitle(displayedTimer.title);
  tray.setToolTip(`${trayDisplayMode === "focus" ? "Focus" : "Track"}: ${displayedTimer.title}`);

  const nextSignature = JSON.stringify({
    trayDisplayMode,
    focusRunning: trayState.focus.isRunning,
    focusMode: trayState.focus.mode,
    trackRunning: trayState.track.isRunning,
    presets: trayState.presets
  });
  if (nextSignature === trayMenuSignature) {
    return;
  }
  trayMenuSignature = nextSignature;

  const menu = Menu.buildFromTemplate([
    {
      label: trayState.focus.isRunning
        ? `${trayState.focus.mode === "break" ? "Break" : "Focus"} timer running`
        : "Focus timer ready",
      enabled: false
    },
    {
      label: "Start Focus",
      submenu: [1, 5, 15, 25, 30, 45, 60].map((minutes) => ({
        label: `${minutes} minute${minutes === 1 ? "" : "s"}`,
        click: () => sendTrayAction(`focus-start:${minutes}`)
      }))
    },
    ...(trayState.focus.isRunning ? [{ label: "Pause Focus", click: () => sendTrayAction("focus-pause") }] : []),
    { label: "Reset Focus", click: () => sendTrayAction("focus-reset") },
    { type: "separator" as const },
    {
      label: "Start Track Preset",
      submenu: trayState.presets.length > 0
        ? trayState.presets.map((preset) => ({
            label: preset.name,
            click: () => sendTrayAction(`track-preset:${preset.id}`)
          }))
        : [{ label: "No presets configured", enabled: false }]
    },
    ...(trayState.track.isRunning ? [{ label: "Stop Tracking", click: () => sendTrayAction("track-stop") }] : []),
    { type: "separator" as const },
    {
      label: "Show Timer in Menu Bar",
      submenu: (["focus", "track"] as const).map((mode) => ({
        label: mode === "focus" ? "Focus" : "Track",
        type: "radio" as const,
        checked: trayDisplayMode === mode,
        click: () => {
          trayDisplayMode = mode;
          trayMenuSignature = "";
          updateTray();
        }
      }))
    },
    { type: "separator" },
    { label: "Open Focus", click: () => sendTrayAction("open-focus", true) },
    { label: "Open Track", click: () => sendTrayAction("open-timer", true) },
    { label: "Open Tasks", click: () => sendTrayAction("open-tasks", true) },
    { type: "separator" },
    {
      label: "Quit Taskasaur",
      click: () => app.quit()
    }
  ]);
  tray.setContextMenu(menu);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1420,
    height: 940,
    minWidth: 1100,
    minHeight: 760,
    title: "Taskasaur",
    backgroundColor: "#f7f2ea",
    icon: appIconPath,
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTaskasaurRepositoryUrl(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 1120,
          height: 780,
          title: "Taskasaur on GitHub",
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false
          }
        }
      };
    }
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (currentUrl && url !== currentUrl && /^https?:\/\//i.test(url)) {
      event.preventDefault();
      void shell.openExternal(url);
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
    defaultPath: `${suggestedName.trim() || "taskasaur"}.csdb`,
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

function hasGlobCharacters(pattern: string): boolean {
  return /[*?{}\[\]()+!@]/.test(pattern);
}

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

ipcMain.handle("path:list-files", async (_event, pattern: string, baseDir?: string): Promise<string[]> => {
  const trimmed = pattern.trim();
  if (!trimmed) {
    return [];
  }
  if (!hasGlobCharacters(trimmed)) {
    const resolvedPath = path.isAbsolute(trimmed) ? trimmed : path.resolve(baseDir ?? process.cwd(), trimmed);
    if (fs.existsSync(resolvedPath)) {
      const stats = fs.statSync(resolvedPath);
      if (stats.isFile()) {
        return [resolvedPath];
      }
      if (stats.isDirectory()) {
        return fg("**/*", {
          absolute: true,
          onlyFiles: true,
          cwd: resolvedPath,
          unique: true
        });
      }
    }
  }

  return fg(trimmed, {
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

ipcMain.handle("file:read-data-url", async (_event, filePath: string): Promise<string> => {
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return "";
  }
  const extension = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".apng": "image/apng",
    ".avif": "image/avif",
    ".gif": "image/gif",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".ogg": "audio/ogg",
    ".wav": "audio/wav",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm"
  };
  return `data:${mimeTypes[extension] ?? "application/octet-stream"};base64,${fs.readFileSync(filePath).toString("base64")}`;
});

ipcMain.handle("file:info", async (_event, filePath: string) => {
  const exists = fs.existsSync(filePath) && !fs.statSync(filePath).isDirectory();
  return {
    path: filePath,
    exists,
    updatedAt: exists ? fs.statSync(filePath).mtime.toISOString() : null
  };
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
