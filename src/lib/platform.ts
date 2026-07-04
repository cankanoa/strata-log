import { defaultTimeLogFile } from "@/lib/defaults";
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
  choosePath: () => Promise<string | null>;
  listMarkdownFiles: (pattern: string, baseDir?: string) => Promise<string[]>;
  readTextFile: (path: string) => Promise<string>;
  saveFile: (path: string, raw: string) => Promise<void>;
  watchFile: (path: string, callback: WatchCallback) => Promise<() => void>;
  onTrayAction: (callback: (action: string) => void) => () => void;
  updateTrayState: (payload: {
    title: string;
    isRunning: boolean;
    hasBreak: boolean;
  }) => Promise<void>;
};

declare global {
  interface Window {
    strata?: NativeApi;
  }
}

const memoryStore = new Map<string, string>();

export function getPlatformApi(): NativeApi {
  if (window.strata) {
    return window.strata;
  }

  return {
    async openFile() {
      const raw = memoryStore.get("strata-log-demo.csdb") ?? serializeTimeLogYaml(defaultTimeLogFile);
      return {
        handle: { path: "strata-log-demo.csdb", name: "strata-log-demo.csdb" },
        raw
      };
    },
    async createFileFromTemplate(suggestedName, raw) {
      const path = `${suggestedName}.csdb`;
      memoryStore.set(path, raw);
      return {
        handle: { path, name: path },
        raw
      };
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
    async listMarkdownFiles(pattern) {
      return pattern && /\.md$/i.test(pattern) ? [pattern] : [];
    },
    async readTextFile(path) {
      return memoryStore.get(path) ?? "";
    },
    async saveFile(path, raw) {
      memoryStore.set(path, raw);
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
