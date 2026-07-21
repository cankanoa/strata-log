import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getPlatformApi } from "@/lib/platform";
import { loadFileSearchTree, type FileSearchNode } from "@/lib/file-search";
import { defaultGeneralSettings } from "@/lib/defaults";
import { getRunningEntry } from "@/lib/time";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";

function filePaths(nodes: FileSearchNode[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.kind === "file" && node.path ? [node.path] : []),
    ...filePaths(node.children ?? [])
  ]);
}

function expandableIds(nodes: FileSearchNode[]): string[] {
  return nodes.flatMap((node) => [
    ...(node.children?.length ? [node.id] : []),
    ...expandableIds(node.children ?? [])
  ]);
}

function compactPatternNodes(nodes: FileSearchNode[] = []): FileSearchNode[] {
  const compacted = nodes.map((node) => ({
    ...node,
    children: compactPatternNodes(node.children)
  }));
  return compacted.length === 1 && compacted[0]?.kind === "pattern"
    ? compacted[0].children ?? []
    : compacted;
}

function compactFileSearchNodes(nodes: FileSearchNode[]): FileSearchNode[] {
  const compacted = nodes.map((node) => ({
    ...node,
    children: compactPatternNodes(node.children)
  }));
  return compacted.length === 1 && compacted[0]?.kind === "field"
    ? compacted[0].children ?? []
    : compacted;
}

function FileTreeNode({
  node,
  depth,
  expandedIds,
  selectedPath,
  onToggle,
  onSelect
}: {
  node: FileSearchNode;
  depth: number;
  expandedIds: Set<string>;
  selectedPath: string;
  onToggle: (id: string) => void;
  onSelect: (path: string) => void;
}) {
  const expandable = Boolean(node.children?.length);
  const expanded = expandedIds.has(node.id);
  const selected = node.kind === "file" && node.path === selectedPath;
  const Icon = node.kind === "directory" ? Folder : FileText;
  const showIcon = node.kind === "directory" || node.kind === "file";

  return (
    <>
      <button
        type="button"
        className={`flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-sm transition-colors ${
          selected
            ? "bg-accent text-accent-foreground"
            : "text-foreground/85 hover:bg-accent/90 hover:text-accent-foreground"
        }`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
        onClick={() => {
          if (node.kind === "file" && node.path) {
            onSelect(node.path);
            return;
          }
          if (expandable) {
            onToggle(node.id);
          }
        }}
      >
        <span className="flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          {expandable ? (expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />) : null}
        </span>
        {showIcon ? <Icon className="size-4 shrink-0 text-muted-foreground" /> : null}
        <span className={node.kind === "file" ? "min-w-0 truncate" : "min-w-0 truncate font-medium"}>{node.name}</span>
      </button>
      {expandable && expanded ? (
        <div className="flex flex-col">
          {node.children?.map((child) => (
            <FileTreeNode
              key={child.id}
              node={child}
              depth={depth + 1}
              expandedIds={expandedIds}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

export function FileSidebarBrowser() {
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
  const refreshRateSeconds = file?.settings?.refreshRateSeconds ?? defaultGeneralSettings.refreshRateSeconds;
  const [nodes, setNodes] = useState<FileSearchNode[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState(true);
  const knownExpandableIds = useRef<Set<string>>(new Set());
  const hasFiles = filePaths(nodes).length > 0;

  useEffect(() => {
    let alive = true;
    let interval: number | undefined;

    async function refreshItems() {
      const nextNodes = compactFileSearchNodes(await loadFileSearchTree(getPlatformApi(), file, fileHandle, runningEntry));
      if (!alive) {
        return;
      }
      const paths = filePaths(nextNodes);
      const nextExpandableIds = new Set(expandableIds(nextNodes));
      setNodes(nextNodes);
      setExpandedIds((current) => {
        const next = new Set([...current].filter((id) => nextExpandableIds.has(id)));
        nextExpandableIds.forEach((id) => {
          if (!knownExpandableIds.current.has(id)) {
            next.add(id);
          }
        });
        knownExpandableIds.current = nextExpandableIds;
        return next;
      });
      if (paths.length === 0 || (selectedTaskPath && !paths.includes(selectedTaskPath))) {
        setSelectedTaskPath("");
      }
    }

    void refreshItems();
    if (refreshRateSeconds > 0) {
      interval = window.setInterval(refreshItems, refreshRateSeconds * 1000);
    }
    return () => {
      alive = false;
      if (interval !== undefined) {
        window.clearInterval(interval);
      }
    };
  }, [file, fileHandle, refreshRateSeconds, runningEntry, selectedTaskPath, setSelectedTaskPath]);

  function toggleNode(id: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  return (
    <div className="flex w-full flex-col gap-2">
      <div
        role="link"
        tabIndex={0}
        aria-current={location.pathname === "/files" ? "page" : undefined}
        className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
          location.pathname === "/files"
            ? "border-primary bg-primary text-primary-foreground"
            : "border-border/70 bg-background/70 hover:bg-background"
        }`}
        onClick={() => navigate("/files")}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) {
            return;
          }
          event.preventDefault();
          navigate("/files");
        }}
      >
        <span className="min-w-0 flex-1 text-sm font-medium">
          Files
        </span>
        {hasFiles ? (
          <Button
            type="button"
            size="icon"
            variant={location.pathname === "/files" ? "secondary" : "ghost"}
            className="shrink-0"
            onClick={(event) => {
              event.stopPropagation();
              setExpanded((current) => !current);
            }}
          >
            {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          </Button>
        ) : (
          <span className="size-8 shrink-0" aria-hidden />
        )}
      </div>
      {expanded && hasFiles ? (
        <div className="flex flex-col">
          {nodes.map((node) => (
            <FileTreeNode
              key={node.id}
              node={node}
              depth={0}
              expandedIds={expandedIds}
              selectedPath={selectedTaskPath}
              onToggle={toggleNode}
              onSelect={(path) => {
                setSelectedTaskPath(path);
                navigate("/files");
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
