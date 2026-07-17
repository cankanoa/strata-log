import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getPlatformApi } from "@/lib/platform";
import { loadTaskItems } from "@/lib/task-items";
import { getRunningEntry } from "@/lib/time";
import type { TaskItem } from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";

export function MarkdownSidebarBrowser() {
  const navigate = useNavigate();
  const location = useLocation();
  const { file, fileHandle, selectedTaskPath, setSelectedTaskPath } = useAppStore(
    useShallow((state) => ({
      file: state.file,
      fileHandle: state.fileHandle,
      selectedTaskPath: state.selectedTaskPath,
      setSelectedTaskPath: state.setSelectedTaskPath
    }))
  );
  const runningEntry = useMemo(() => getRunningEntry(file?.entries ?? []), [file]);
  const [items, setItems] = useState<TaskItem[]>([]);
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    let alive = true;

    async function refreshItems() {
      const nextItems = await loadTaskItems(getPlatformApi(), file, fileHandle, runningEntry);
      if (!alive) {
        return;
      }
      setItems(nextItems);
      if (nextItems.length === 0) {
        setSelectedTaskPath("");
        return;
      }
      if (!selectedTaskPath || !nextItems.some((item) => item.path === selectedTaskPath)) {
        setSelectedTaskPath(nextItems[0]?.path ?? "");
      }
    }

    void refreshItems();
    return () => {
      alive = false;
    };
  }, [file, fileHandle, runningEntry, selectedTaskPath, setSelectedTaskPath]);

  return (
    <div className="flex w-full flex-col gap-2">
      <div
        className={`flex items-center gap-2 rounded-xl px-1 py-1 ${location.pathname === "/markdown" ? "bg-primary text-primary-foreground" : ""}`}
      >
        <Link
          to="/markdown"
          className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            location.pathname === "/markdown" ? "text-primary-foreground" : "bg-background/90 hover:bg-background"
          }`}
        >
          Markdown
        </Link>
        <Button
          type="button"
          size="icon"
          variant={location.pathname === "/markdown" ? "secondary" : "ghost"}
          className="shrink-0"
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </Button>
      </div>
      {expanded && items.length > 0 ? (
        <div className="flex flex-col gap-1 pl-2">
          {items.map((item) => {
            const selected = item.path === selectedTaskPath;
            return (
              <button
                key={item.id}
                type="button"
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                  selected
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border/60 bg-background/50 hover:bg-background"
                }`}
                onClick={() => {
                  setSelectedTaskPath(item.path);
                  navigate("/markdown");
                }}
              >
                <FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{item.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{item.sourceLabel}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
