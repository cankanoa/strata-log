import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor, { loader } from "@monaco-editor/react";
import { Crepe } from "@milkdown/crepe";
import * as monaco from "monaco-editor";
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker";
import cssWorker from "monaco-editor/esm/vs/language/css/css.worker?worker";
import htmlWorker from "monaco-editor/esm/vs/language/html/html.worker?worker";
import jsonWorker from "monaco-editor/esm/vs/language/json/json.worker?worker";
import tsWorker from "monaco-editor/esm/vs/language/typescript/ts.worker?worker";
import { FileWarning } from "lucide-react";
import { MarkdownEditor } from "@/components/forms/markdown-editor";
import { getPlatformApi } from "@/lib/platform";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";

type LoadedFile = {
  path: string;
  mode: "markdown" | "text" | "preview" | "unsupported";
  value: string;
  language?: string;
  mimeType?: string;
};

const browserPreviewTypes: Record<string, string> = {
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

const textExtensions = new Set([
  ".astro",
  ".bash",
  ".bat",
  ".c",
  ".cfg",
  ".clj",
  ".cpp",
  ".cs",
  ".css",
  ".csv",
  ".dart",
  ".diff",
  ".dockerfile",
  ".env",
  ".go",
  ".graphql",
  ".h",
  ".hpp",
  ".html",
  ".ini",
  ".java",
  ".js",
  ".json",
  ".jsx",
  ".kt",
  ".less",
  ".lua",
  ".mjs",
  ".php",
  ".ps1",
  ".py",
  ".r",
  ".rb",
  ".rs",
  ".sass",
  ".scss",
  ".sh",
  ".sql",
  ".svelte",
  ".swift",
  ".toml",
  ".ts",
  ".tsx",
  ".txt",
  ".vue",
  ".xml",
  ".yaml",
  ".yml",
  ".zig"
]);

const filenameLanguages: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "makefile"
};

type MonacoWithEnvironment = typeof self & {
  MonacoEnvironment?: {
    getWorker: (_workerId: string, label: string) => Worker;
  };
};

(self as MonacoWithEnvironment).MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === "json") {
      return new jsonWorker();
    }
    if (label === "css" || label === "scss" || label === "less") {
      return new cssWorker();
    }
    if (label === "html" || label === "handlebars" || label === "razor") {
      return new htmlWorker();
    }
    if (label === "typescript" || label === "javascript") {
      return new tsWorker();
    }
    return new editorWorker();
  }
};

loader.config({ monaco });

function extensionOf(filePath: string): string {
  const fileName = filePath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(dotIndex) : "";
}

function fileNameOf(filePath: string): string {
  return filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
}

function languageForPath(filePath: string): string {
  const fileName = fileNameOf(filePath).toLowerCase();
  const directLanguage = filenameLanguages[fileName];
  if (directLanguage) {
    return directLanguage;
  }

  const extension = extensionOf(filePath);
  return monaco.languages.getLanguages().find((language) => language.extensions?.includes(extension))?.id ?? "plaintext";
}

function canUseMonaco(filePath: string): boolean {
  const extension = extensionOf(filePath);
  return extension.length === 0 || textExtensions.has(extension) || Boolean(languageForPath(filePath) !== "plaintext");
}

function isReadableText(value: string): boolean {
  const sample = value.slice(0, 4096);
  if (sample.includes("\u0000")) {
    return false;
  }
  const controlCharacters = sample.match(/[\u0001-\u0008\u000e-\u001f]/g)?.length ?? 0;
  return sample.length === 0 || controlCharacters / sample.length < 0.02;
}

function isMarkdown(filePath: string): boolean {
  return [".md", ".mdown", ".markdown"].includes(extensionOf(filePath));
}

function browserPreviewType(filePath: string): string | undefined {
  return browserPreviewTypes[extensionOf(filePath)];
}

function FilePreview({ file }: { file: LoadedFile }) {
  if (!file.mimeType) {
    return null;
  }
  if (file.mimeType.startsWith("image/")) {
    return <img src={file.value} alt={fileNameOf(file.path)} className="h-full w-full object-contain" />;
  }
  if (file.mimeType.startsWith("audio/")) {
    return <audio src={file.value} controls className="w-full max-w-3xl" />;
  }
  if (file.mimeType.startsWith("video/")) {
    return <video src={file.value} controls className="h-full w-full object-contain" />;
  }
  return <iframe title={fileNameOf(file.path)} src={file.value} className="h-full w-full border-0" />;
}

export function FilesPage() {
  const { selectedTaskPath } = useAppStore(
    useShallow((state) => ({
      selectedTaskPath: state.selectedTaskPath
    }))
  );
  const crepeRef = useRef<Crepe | null>(null);
  const monacoRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const loadRequestRef = useRef(0);
  const valueRef = useRef("");
  const [loaded, setLoaded] = useState<LoadedFile | null>(null);
  const [error, setError] = useState("");
  const monacoTheme = useMemo(
    () => (document.documentElement.classList.contains("dark") ? "vs-dark" : "vs"),
    []
  );

  const clearPendingSave = useCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    clearPendingSave();
    setError("");

    if (!selectedTaskPath) {
      setLoaded(null);
      return;
    }

    async function loadFile() {
      const api = getPlatformApi();
      const markdown = isMarkdown(selectedTaskPath);
      const previewType = browserPreviewType(selectedTaskPath);

      try {
        let nextFile: LoadedFile;
        if (markdown || canUseMonaco(selectedTaskPath)) {
          const value = await api.readTextFile(selectedTaskPath);
          nextFile = !markdown && !isReadableText(value) && previewType
            ? {
                path: selectedTaskPath,
                mode: "preview",
                value: await api.readFileDataUrl(selectedTaskPath),
                mimeType: previewType
              }
            : {
                path: selectedTaskPath,
                mode: markdown ? "markdown" : "text",
                value,
                language: markdown ? "markdown" : languageForPath(selectedTaskPath)
              };
        } else {
          nextFile = previewType
            ? {
                path: selectedTaskPath,
                mode: "preview",
                value: await api.readFileDataUrl(selectedTaskPath),
                mimeType: previewType
              }
            : {
                path: selectedTaskPath,
                mode: "unsupported",
                value: ""
              };
        }

        if (requestId === loadRequestRef.current) {
          valueRef.current = nextFile.value;
          setLoaded(nextFile);
        }
      } catch (loadError) {
        if (requestId === loadRequestRef.current) {
          setLoaded(null);
          setError(loadError instanceof Error ? loadError.message : "This file could not be opened.");
        }
      }
    }

    void loadFile();
  }, [clearPendingSave, selectedTaskPath]);

  const saveNow = useCallback(() => {
    if (!loaded || (loaded.mode !== "markdown" && loaded.mode !== "text")) {
      return;
    }
    clearPendingSave();
    const value = loaded.mode === "markdown"
      ? crepeRef.current?.getMarkdown() ?? valueRef.current
      : monacoRef.current?.getValue() ?? valueRef.current;
    void getPlatformApi().saveFile(loaded.path, value);
  }, [clearPendingSave, loaded]);

  const scheduleSave = useCallback((value: string | undefined) => {
    if (value === undefined) {
      return;
    }
    valueRef.current = value;
    if (!loaded || (loaded.mode !== "markdown" && loaded.mode !== "text")) {
      return;
    }

    clearPendingSave();
    saveTimerRef.current = window.setTimeout(() => {
      void getPlatformApi().saveFile(loaded.path, value);
      saveTimerRef.current = null;
    }, 600);
  }, [clearPendingSave, loaded]);

  useEffect(() => {
    function saveOnShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") {
        return;
      }
      event.preventDefault();
      saveNow();
    }

    window.addEventListener("keydown", saveOnShortcut);
    return () => window.removeEventListener("keydown", saveOnShortcut);
  }, [saveNow]);

  const empty = !loaded && !selectedTaskPath;

  return (
    <main className={cn("flex h-screen min-h-0 w-full min-w-0 flex-col", empty ? "bg-[var(--app-shell-background)]" : "bg-background")}>
      <div className={cn("flex min-h-0 flex-1 flex-col overflow-hidden", empty ? "bg-[var(--app-shell-background)]" : "bg-background")}>
        {loaded ? (
          <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border/70 px-4">
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{fileNameOf(loaded.path)}</div>
              <div className="truncate text-xs text-muted-foreground">{loaded.path}</div>
            </div>
          </div>
        ) : null}
        {loaded?.mode === "markdown" ? (
          <MarkdownEditor
            key={loaded.path}
            value={loaded.value}
            onChange={scheduleSave}
            onReady={(editor) => {
              crepeRef.current = editor;
            }}
            className="min-h-0 flex-1 overflow-y-auto"
          />
        ) : loaded?.mode === "text" ? (
          <Editor
            key={loaded.path}
            className="min-h-0 flex-1"
            defaultLanguage={loaded.language}
            defaultValue={loaded.value}
            language={loaded.language}
            onChange={scheduleSave}
            onMount={(editor) => {
              monacoRef.current = editor;
            }}
            options={{
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: "on"
            }}
            theme={monacoTheme}
          />
        ) : loaded?.mode === "preview" ? (
          <div className="flex min-h-0 flex-1 items-center justify-center bg-muted/20">
            <FilePreview file={loaded} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-muted-foreground">
            <div className={cn("flex max-w-md flex-col items-center gap-3", error ? "text-destructive" : undefined)}>
              <FileWarning className="size-8" />
              <div className="text-sm">
                {error || (selectedTaskPath ? "This file type is not supported yet." : "Select a file from the Files menu.")}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
