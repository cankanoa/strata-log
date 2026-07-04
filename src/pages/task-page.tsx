import { useEffect, useState } from "react";
import { CrepeBuilder } from "@milkdown/crepe";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import "@milkdown/crepe/theme/nord.css";
import { isMarkdownPath } from "@/lib/task-items";
import { getPlatformApi } from "@/lib/platform";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";

type MarkdownViewerProps = {
  markdown: string;
};

function MarkdownViewer({ markdown }: MarkdownViewerProps) {
  useEditor(
    (container) =>
      new CrepeBuilder({
        root: container,
        defaultValue: markdown
      }).setReadonly(true),
    [markdown]
  );

  return <Milkdown />;
}

function MarkdownSurface({ markdown }: MarkdownViewerProps) {
  return (
    <MilkdownProvider>
      <MarkdownViewer markdown={markdown} />
    </MilkdownProvider>
  );
}

export function TaskPage() {
  const { selectedTaskPath } = useAppStore(
    useShallow((state) => ({
      selectedTaskPath: state.selectedTaskPath
    }))
  );
  const [markdown, setMarkdown] = useState("");

  useEffect(() => {
    let alive = true;

    async function loadMarkdown() {
      if (!selectedTaskPath || !isMarkdownPath(selectedTaskPath)) {
        setMarkdown("");
        return;
      }
      const raw = await getPlatformApi().readTextFile(selectedTaskPath);
      if (alive) {
        setMarkdown(raw);
      }
    }

    void loadMarkdown();
    return () => {
      alive = false;
    };
  }, [selectedTaskPath]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-4 p-5 xl:p-7">
      <div className="min-h-[720px] rounded-xl border border-border/70 bg-background/70 p-3">
        {selectedTaskPath && isMarkdownPath(selectedTaskPath) ? (
          <div className="task-milkdown h-full min-h-[680px]">
            <MarkdownSurface markdown={markdown} />
          </div>
        ) : (
          <div className="h-full" />
        )}
      </div>
    </main>
  );
}
