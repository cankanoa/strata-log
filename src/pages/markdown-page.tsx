import { useCallback, useEffect, useRef, useState } from "react";
import { Crepe } from "@milkdown/crepe";
import "@milkdown/crepe/theme/common/style.css";
import "@milkdown/crepe/theme/frame.css";
import { isMarkdownPath } from "@/lib/task-items";
import { getPlatformApi } from "@/lib/platform";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";

type LoadedMarkdown = {
  path: string;
  markdown: string;
};

export function MarkdownPage() {
  const { selectedTaskPath } = useAppStore(
    useShallow((state) => ({
      selectedTaskPath: state.selectedTaskPath
    }))
  );
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const crepeRef = useRef<Crepe | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const loadRequestRef = useRef(0);
  const [loaded, setLoaded] = useState<LoadedMarkdown | null>(null);

  const selectedMarkdownPath = selectedTaskPath && isMarkdownPath(selectedTaskPath) ? selectedTaskPath : "";

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

    if (!selectedMarkdownPath) {
      setLoaded(null);
      return;
    }

    async function loadMarkdown() {
      const markdown = await getPlatformApi().readTextFile(selectedMarkdownPath);
      if (requestId === loadRequestRef.current) {
        setLoaded({ path: selectedMarkdownPath, markdown });
      }
    }

    void loadMarkdown();
  }, [clearPendingSave, selectedMarkdownPath]);

  useEffect(() => {
    const root = editorRootRef.current;
    if (!root || !loaded) {
      return;
    }

    root.replaceChildren();
    const crepe = new Crepe({
      root,
      defaultValue: loaded.markdown,
      features: {
        [Crepe.Feature.TopBar]: true
      }
    });

    crepe.on((listener) => {
      listener.markdownUpdated((_, markdown) => {
        clearPendingSave();
        saveTimerRef.current = window.setTimeout(() => {
          void getPlatformApi().saveFile(loaded.path, markdown);
          saveTimerRef.current = null;
        }, 600);
      });
    });

    crepeRef.current = crepe;
    void crepe.create();

    return () => {
      clearPendingSave();
      crepeRef.current = null;
      void crepe.destroy();
    };
  }, [clearPendingSave, loaded]);

  useEffect(() => {
    function saveOnShortcut(event: KeyboardEvent) {
      if (!loaded || !(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") {
        return;
      }

      event.preventDefault();
      clearPendingSave();
      const markdown = crepeRef.current?.getMarkdown();
      if (markdown !== undefined) {
        void getPlatformApi().saveFile(loaded.path, markdown);
      }
    }

    window.addEventListener("keydown", saveOnShortcut);
    return () => window.removeEventListener("keydown", saveOnShortcut);
  }, [clearPendingSave, loaded]);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl p-5 xl:p-7">
      <div className="min-h-[720px] overflow-hidden rounded-lg border border-border/70 bg-background">
        {loaded ? <div ref={editorRootRef} className="min-h-[720px]" /> : null}
      </div>
    </main>
  );
}
