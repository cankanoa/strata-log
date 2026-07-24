import { defaultTimeLogFile } from "@/lib/defaults";
import type { DatabaseLocation } from "@/lib/database-registry";
import type { FileHandleInfo, TimeLogFile } from "@/lib/types";
import { parseTimeLogYaml, serializeTimeLogYaml } from "@/lib/yaml";

type WatchCallback = (raw: string) => void;

export type DirectoryTreeNode = {
  id: string;
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: DirectoryTreeNode[];
};

export type NativeApi = {
  openFile: () => Promise<{ handle: FileHandleInfo; raw: string } | null>;
  createFileFromTemplate: (suggestedName: string, raw: string) => Promise<{ handle: FileHandleInfo; raw: string } | null>;
  readDatabaseRegistry: () => Promise<string>;
  saveDatabaseRegistry: (raw: string) => Promise<void>;
  chooseDatabaseUrl: (suggestedName: string) => Promise<string | null>;
  getDatabaseFileInfo: (payload: { location: DatabaseLocation; url: string }) => Promise<{ path: string; exists: boolean; updatedAt: string | null } | null>;
  loadDatabaseFile: (payload: { location: DatabaseLocation; url: string }) => Promise<{ handle: FileHandleInfo; raw: string } | null>;
  importDatabaseFile: () => Promise<{ registryUrl: string } | null>;
  referenceDatabaseFile: () => Promise<{ registryUrl: string } | null>;
  exportDatabaseFile: (payload: { url: string }) => Promise<boolean>;
  renameDatabaseFile: (payload: {
    location: DatabaseLocation;
    url: string;
    name: string;
  }) => Promise<{ handle: FileHandleInfo; registryUrl: string; raw: string } | null>;
  createDatabaseFile: (payload: {
    location: DatabaseLocation;
    url: string;
    raw: string;
  }) => Promise<{ handle: FileHandleInfo; registryUrl: string; raw: string } | null>;
  deleteDatabaseFile: (payload: { location: DatabaseLocation; url: string }) => Promise<void>;
  choosePath: () => Promise<string | null>;
  listFiles: (pattern: string, baseDir?: string) => Promise<string[]>;
  getTextFileInfo: (path: string) => Promise<{ path: string; exists: boolean; updatedAt: string | null }>;
  readTextFile: (path: string) => Promise<string>;
  readFileDataUrl: (path: string) => Promise<string>;
  saveFile: (path: string, raw: string) => Promise<void>;
  watchFile: (path: string, callback: WatchCallback) => Promise<() => void>;
  onTrayAction: (callback: (action: string) => void) => () => void;
  updateTrayState: (payload: {
    focus: { title: string; isRunning: boolean; mode: "focus" | "break" };
    track: { title: string; isRunning: boolean };
    presets: Array<{ id: string; name: string }>;
  }) => Promise<void>;
};

declare global {
  interface Window {
    taskasaur?: NativeApi;
  }
}

const memoryStore = new Map<string, string>();
const memoryUpdatedAt = new Map<string, string>();

function globToRegex(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    const next = pattern[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += ".";
    } else {
      source += char?.replace(/[\\^$+?.()|{}[\]]/g, "\\$&") ?? "";
    }
  }
  return new RegExp(`${source}$`);
}

function internalDatabasePath(name: string): string {
  return `data/${name.trim().replace(/\.csdb$/i, "")}.csdb`;
}

export function getPlatformApi(): NativeApi {
  if (window.taskasaur) {
    return window.taskasaur;
  }

  return {
    async openFile() {
      const raw = memoryStore.get("taskasaur-demo.csdb") ?? serializeTimeLogYaml(defaultTimeLogFile);
      return {
        handle: { path: "taskasaur-demo.csdb", name: "taskasaur-demo.csdb" },
        raw
      };
    },
    async createFileFromTemplate(suggestedName, raw) {
      const path = `${suggestedName}.csdb`;
      memoryStore.set(path, raw);
      memoryUpdatedAt.set(path, new Date().toISOString());
      return {
        handle: { path, name: path },
        raw
      };
    },
    async readDatabaseRegistry() {
      return memoryStore.get("databases.csdb") ?? "";
    },
    async saveDatabaseRegistry(raw) {
      memoryStore.set("databases.csdb", raw);
    },
    async chooseDatabaseUrl(suggestedName) {
      const value = window.prompt("Database URL", `${suggestedName || "taskasaur"}.csdb`) ?? "";
      return value.trim().length > 0 ? value.trim() : null;
    },
    async getDatabaseFileInfo({ location, url }) {
      const trimmedUrl = url.trim();
      if (!trimmedUrl) {
        return null;
      }
      const path = location === "Internal" ? internalDatabasePath(trimmedUrl) : trimmedUrl;
      const exists = memoryStore.has(path);
      return {
        path,
        exists,
        updatedAt: exists ? memoryUpdatedAt.get(path) ?? null : null
      };
    },
    async loadDatabaseFile({ location, url }) {
      const filePath = location === "Internal" ? internalDatabasePath(url) : url.trim();
      const raw = memoryStore.get(filePath);
      return raw
        ? {
            handle: { path: filePath, name: filePath.split("/").pop() ?? filePath },
            raw
          }
        : null;
    },
    async importDatabaseFile() {
      const sourcePath = window.prompt("Database file to import")?.trim();
      if (!sourcePath) {
        return null;
      }
      const registryUrl = sourcePath.split(/[\\/]/).pop()?.replace(/\.csdb$/i, "") ?? sourcePath;
      const filePath = internalDatabasePath(registryUrl);
      memoryStore.set(filePath, memoryStore.get(sourcePath) ?? serializeTimeLogYaml(defaultTimeLogFile));
      memoryUpdatedAt.set(filePath, new Date().toISOString());
      return { registryUrl };
    },
    async referenceDatabaseFile() {
      const registryUrl = window.prompt("Database file to reference")?.trim();
      return registryUrl ? { registryUrl } : null;
    },
    async exportDatabaseFile({ url }) {
      const sourcePath = internalDatabasePath(url);
      const raw = memoryStore.get(sourcePath);
      if (!raw) {
        return false;
      }
      const exportPath = window.prompt("Export database to", `${url.replace(/\.csdb$/i, "")}.csdb`)?.trim();
      if (!exportPath) {
        return false;
      }
      memoryStore.set(exportPath, raw);
      memoryUpdatedAt.set(exportPath, new Date().toISOString());
      return true;
    },
    async renameDatabaseFile({ location, url, name }) {
      const nextName = name.trim().replace(/\.csdb$/i, "");
      if (!nextName) {
        return null;
      }
      const currentPath = location === "Internal" ? internalDatabasePath(url) : url.trim();
      const nextPath = location === "Internal"
        ? internalDatabasePath(nextName)
        : `${currentPath.split(/[\\/]/).slice(0, -1).join("/")}/${nextName}.csdb`;
      const raw = memoryStore.get(currentPath);
      if (!raw) {
        return null;
      }
      const nextRaw = raw.replace(/(^|\n)name:\s*.*(?=\n)/, `$1name: ${nextName}`);
      memoryStore.delete(currentPath);
      memoryUpdatedAt.delete(currentPath);
      memoryStore.set(nextPath, nextRaw);
      memoryUpdatedAt.set(nextPath, new Date().toISOString());
      return {
        handle: { path: nextPath, name: nextPath.split("/").pop() ?? nextPath },
        registryUrl: location === "Internal" ? nextName : nextPath,
        raw: nextRaw
      };
    },
    async createDatabaseFile({ location, url, raw }) {
      const registryUrl = location === "Internal" ? url.trim().replace(/\.csdb$/i, "") : url.trim();
      if (!registryUrl) {
        return null;
      }
      const filePath = location === "Internal" ? internalDatabasePath(registryUrl) : registryUrl;
      memoryStore.set(filePath, raw);
      memoryUpdatedAt.set(filePath, new Date().toISOString());
      return {
        handle: { path: filePath, name: filePath.split("/").pop() ?? filePath },
        registryUrl,
        raw
      };
    },
    async deleteDatabaseFile({ location, url }) {
      const filePath = location === "Internal" ? internalDatabasePath(url) : url;
      memoryStore.delete(filePath);
      memoryUpdatedAt.delete(filePath);
    },
    async choosePath() {
      const picker = (window as Window & {
        showOpenFilePicker?: (options: { multiple: boolean }) => Promise<Array<{ name: string }>>;
      }).showOpenFilePicker;
      if (typeof picker === "function") {
        try {
          const [handle] = await picker({ multiple: false });
          return handle?.name ?? null;
        } catch {
          return null;
        }
      }
      const value = window.prompt("Choose a path") ?? "";
      return value.trim().length > 0 ? value.trim() : null;
    },
    async listFiles(pattern, baseDir) {
      const trimmed = pattern.trim();
      if (!trimmed) {
        return [];
      }
      const rooted = /^([a-z]+:)?[\\/]/i.test(trimmed) || !baseDir
        ? trimmed
        : `${baseDir.replace(/[\\/]$/, "")}/${trimmed}`;
      if (!/[*?{}\[\]()+!@]/.test(trimmed)) {
        const root = rooted.replace(/[\\/]$/, "");
        const matches = [...memoryStore.keys()].filter((path) => path === root || path.startsWith(`${root}/`));
        return matches.length > 0 || root.includes(".") ? (matches.length > 0 ? matches : [root]) : [];
      }
      const matcher = globToRegex(rooted);
      return [...memoryStore.keys()].filter((path) => matcher.test(path));
    },
    async getTextFileInfo(path) {
      return {
        path,
        exists: memoryStore.has(path),
        updatedAt: memoryUpdatedAt.get(path) ?? null
      };
    },
    async readTextFile(path) {
      return memoryStore.get(path) ?? "";
    },
    async readFileDataUrl(path) {
      return `data:text/plain;charset=utf-8,${encodeURIComponent(memoryStore.get(path) ?? "")}`;
    },
    async saveFile(path, raw) {
      memoryStore.set(path, raw);
      memoryUpdatedAt.set(path, new Date().toISOString());
    },
    async watchFile(path, callback) {
      const interval = window.setInterval(() => {
        const current = memoryStore.get(path);
        if (current) {
          callback(current);
        }
      }, 10_000);
      return () => window.clearInterval(interval);
    },
    onTrayAction() {
      return () => undefined;
    },
    async updateTrayState() {
      return undefined;
    }
  };
}

export async function loadRawIntoFile(raw: string): Promise<TimeLogFile> {
  const parsed = parseTimeLogYaml(raw);
  if (!parsed.file || parsed.errors.length > 0) {
    throw new Error(parsed.errors.join(" "));
  }
  return parsed.file;
}
