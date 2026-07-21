import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDuration, formatDurationWithSeconds, getRunningEntry, netDurationMs } from "@/lib/time";
import { activeTaskDisplayRows } from "@/lib/task-query";
import { FileSidebarBrowser } from "@/components/task/task-sidebar-browser";
import { defaultGeneralSettings } from "@/lib/defaults";
import { DatabaseReferenceSyncDialog } from "@/features/database/database-reference-sync-dialog";
import { getMissingDatabaseReferences, removeDatabaseReferences, type DatabaseReferenceStatus } from "@/lib/database-registry-sync";
import { getActiveDatabaseEntry, parseDatabaseRegistry } from "@/lib/database-registry";
import { getPlatformApi } from "@/lib/platform";
import { Toaster } from "@/components/ui/sonner";
import { FocusPage } from "@/pages/focus-page";
import { TrackPage } from "@/pages/track-page";
import { SettingsPage } from "@/pages/settings-page";
import { FilesPage } from "@/pages/files-page";
import { TasksPage } from "@/pages/task-page";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";

function formatFocusDuration(totalSeconds: number) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(Math.max(0, totalSeconds % 60)).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function playFocusCompleteAlert(mode: "sound" | "vibrate" | "both") {
  if ((mode === "vibrate" || mode === "both") && typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate([200, 100, 200]);
  }

  if (mode === "sound" || mode === "both") {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.type = "sine";
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.12, context.currentTime);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.25);
  }
}

function SidebarStatusText({
  title,
  subtext,
  active,
  mono = false
}: {
  title: string;
  subtext?: string;
  active: boolean;
  mono?: boolean;
}) {
  return (
    <>
      <div
        className={
          subtext
            ? `text-xs font-medium ${active ? "text-primary-foreground/80" : "text-muted-foreground"}`
            : "text-sm font-medium"
        }
      >
        {title}
      </div>
      {subtext ? (
        <div className={`${mono ? "font-mono text-lg" : "truncate text-sm"} font-semibold`}>
          {subtext}
        </div>
      ) : null}
    </>
  );
}

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    file,
    errors,
    conflict,
    clearErrors,
    reloadFromDiskVersion,
    dismissConflict,
    trackDraftMetadata,
    startLiveEntry,
    stopLiveEntry,
    focusSoundMode,
    focusDurationSeconds,
    focusEndsAt,
    startFocusTimer,
    pauseFocusTimer,
    completeFocusTimer
  } = useAppStore(
    useShallow((state) => ({
      file: state.file,
      errors: state.errors,
      conflict: state.conflict,
      clearErrors: state.clearErrors,
      reloadFromDiskVersion: state.reloadFromDiskVersion,
      dismissConflict: state.dismissConflict,
      trackDraftMetadata: state.trackDraftMetadata,
      startLiveEntry: state.startLiveEntry,
      stopLiveEntry: state.stopLiveEntry,
      focusSoundMode: state.focusSoundMode,
      focusDurationSeconds: state.focusDurationSeconds,
      focusEndsAt: state.focusEndsAt,
      startFocusTimer: state.startFocusTimer,
      pauseFocusTimer: state.pauseFocusTimer,
      completeFocusTimer: state.completeFocusTimer
    }))
  );
  const runningEntry = getRunningEntry(file?.entries ?? []);
  const [trayTick, setTrayTick] = useState(0);
  const [activeTaskIndex, setActiveTaskIndex] = useState(0);
  const [missingDatabaseReferences, setMissingDatabaseReferences] = useState<DatabaseReferenceStatus[]>([]);
  const startupDatabaseSyncRan = useRef(false);
  const githubMetadataRefreshKey = useRef("");
  const focusRemainingSeconds = focusEndsAt
    ? Math.max(0, Math.ceil((focusEndsAt - Date.now()) / 1000))
    : focusDurationSeconds;
  const activeTasks = useMemo(() => file ? activeTaskDisplayRows(file) : [], [file]);
  const refreshableSourceIds = useMemo(
    () => (file?.taskSources ?? []).filter((source) => source.type !== "Internal Task").map((source) => source.id),
    [file?.taskSources]
  );
  const refreshRateSeconds = file?.settings?.refreshRateSeconds ?? defaultGeneralSettings.refreshRateSeconds;
  const githubSourceKey = useMemo(
    () => (file?.taskSources ?? [])
      .filter((source) => source.type === "Github")
      .map((source) => `${source.id}:${source.url}:${source.accountId ?? ""}`)
      .join("|"),
    [file?.taskSources]
  );
  const activeTaskKey = activeTasks.map((task) => `${task.taskTable}:${task.id}`).join("|");
  const activeTask = activeTasks.length > 0 ? activeTasks[activeTaskIndex % activeTasks.length] : undefined;
  const trackSubtext = runningEntry ? formatDurationWithSeconds(netDurationMs(runningEntry)) : undefined;
  const focusSubtext = focusEndsAt ? formatFocusDuration(focusRemainingSeconds) : undefined;
  const taskSubtext = activeTask?.contents;

  function handleSidebarNavKeyDown(event: KeyboardEvent<HTMLDivElement>, path: string) {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }
    event.preventDefault();
    navigate(path);
  }

  function scrollToSection(sectionId: string) {
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }

  useEffect(() => {
    const interval = window.setInterval(() => setTrayTick((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setActiveTaskIndex(0);
  }, [activeTaskKey]);

  useEffect(() => {
    if (refreshRateSeconds <= 0 || refreshableSourceIds.length === 0) {
      return;
    }
    const refresh = () => {
      refreshableSourceIds.forEach((sourceId) => {
        void useAppStore.getState().syncTaskSource(sourceId);
      });
    };
    const interval = window.setInterval(refresh, refreshRateSeconds * 1000);
    return () => window.clearInterval(interval);
  }, [refreshRateSeconds, refreshableSourceIds]);

  useEffect(() => {
    if (!file || !githubSourceKey || githubMetadataRefreshKey.current === githubSourceKey) {
      return;
    }
    githubMetadataRefreshKey.current = githubSourceKey;
    file.taskSources
      .filter((source) => source.type === "Github")
      .forEach((source) => {
        void useAppStore.getState().syncTaskSource(source.id);
      });
  }, [file, githubSourceKey]);

  useEffect(() => {
    if (startupDatabaseSyncRan.current) {
      return;
    }
    startupDatabaseSyncRan.current = true;
    void (async () => {
      const raw = await getPlatformApi().readDatabaseRegistry();
      const entries = raw.trim().length > 0 ? parseDatabaseRegistry(raw) : [];
      const activeDatabase = getActiveDatabaseEntry(entries);
      if (activeDatabase) {
        const loaded = await useAppStore.getState().loadDatabaseFile({
          location: activeDatabase.location,
          url: activeDatabase.url
        });
        if (!loaded) {
          toast.error("Couldn't load active database", {
            description: `The database "${activeDatabase.url}" could not be loaded.`
          });
        }
      }
      setMissingDatabaseReferences(await getMissingDatabaseReferences());
    })()
      .catch((error) => {
        toast.error("Couldn't sync databases", {
          description: error instanceof Error ? error.message : "The database registry could not be checked."
        });
      });
  }, []);

  async function removeMissingDatabaseReferences() {
    await removeDatabaseReferences(missingDatabaseReferences.map((status) => status.entry));
    setMissingDatabaseReferences([]);
    toast.success("Removed missing database references.");
  }

  useEffect(() => {
    void getPlatformApi().updateTrayState({
      title: runningEntry ? formatDuration(netDurationMs(runningEntry)) : "00:00",
      isRunning: Boolean(runningEntry),
      hasBreak: false
    });
  }, [runningEntry, trayTick]);

  useEffect(() => {
    if (!focusEndsAt || Date.now() < focusEndsAt) {
      return;
    }
    completeFocusTimer();
    playFocusCompleteAlert(focusSoundMode);
  }, [completeFocusTimer, focusEndsAt, focusSoundMode, trayTick]);

  useEffect(() => {
    return getPlatformApi().onTrayAction((action) => {
      if (action === "open-timer") {
        navigate("/track");
        window.setTimeout(() => scrollToSection("session-section"), 50);
      }
      if (action === "open-entries") {
        navigate("/track");
        window.setTimeout(() => scrollToSection("entries-section"), 50);
      }
      if (action === "open-fields") {
        navigate("/settings");
        window.setTimeout(() => scrollToSection("settings-section"), 50);
      }
      if (action === "open-task") {
        navigate("/files");
      }
    });
  }, [navigate]);

  useEffect(() => {
    if (errors.length === 0) {
      return;
    }

    errors.forEach((error) => {
      toast.error("Strata Log", {
        id: `error:${error}`,
        description: error
      });
    });

    clearErrors();
  }, [clearErrors, errors]);

  useEffect(() => {
    if (conflict.status !== "conflict") {
      toast.dismiss("file-conflict");
      return;
    }

    toast.warning("File conflict detected", {
      id: "file-conflict",
      description: conflict.message,
      duration: Infinity,
      action: {
        label: "Reload",
        onClick: () => {
          reloadFromDiskVersion();
          toast.success("Reloaded disk version.");
        }
      },
      cancel: {
        label: "Dismiss",
        onClick: dismissConflict
      }
    });
  }, [conflict, dismissConflict, reloadFromDiskVersion]);

  return (
    <div className="min-h-screen bg-[var(--app-shell-background)]">
      <DatabaseReferenceSyncDialog
        open={missingDatabaseReferences.length > 0}
        missingReferences={missingDatabaseReferences}
        onKeep={() => setMissingDatabaseReferences([])}
        onRemove={removeMissingDatabaseReferences}
      />
      <div className="md:grid md:h-screen md:overflow-hidden md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="sticky top-0 z-10 border-b border-border/70 bg-[var(--app-shell-background)] md:h-screen md:overflow-hidden md:border-b-0 md:border-r">
          <div className="flex min-h-0 flex-col gap-3 p-4 md:h-full md:overflow-y-auto md:overscroll-contain">
            <nav className="flex w-full flex-col gap-3 md:items-stretch">
              <Link
                to="/settings"
                className={`rounded-xl px-4 py-3 text-sm font-medium transition-colors ${location.pathname === "/settings" ? "bg-primary text-primary-foreground" : "bg-background/90 hover:bg-background"}`}
              >
                Settings
              </Link>
            </nav>
            <div className="flex flex-col gap-2">
              <div
                role="link"
                tabIndex={0}
                aria-current={location.pathname === "/track" ? "page" : undefined}
                className={`h-16 cursor-pointer rounded-xl border px-3 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                  location.pathname === "/track"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/70 bg-background/70 hover:bg-background"
                }`}
                onClick={() => navigate("/track")}
                onKeyDown={(event) => handleSidebarNavKeyDown(event, "/track")}
              >
                <div className="flex h-full items-center justify-between gap-2">
                  <div className="flex h-full min-w-0 flex-1 flex-col justify-center">
                    <SidebarStatusText title="Track" subtext={trackSubtext} active={location.pathname === "/track"} mono />
                  </div>
                  <Button
                    size="icon"
                    variant={location.pathname === "/track" ? "secondary" : "ghost"}
                    className={
                      location.pathname === "/track"
                        ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90"
                        : undefined
                    }
                    disabled={!file}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (runningEntry) {
                        void stopLiveEntry();
                        return;
                      }
                      void startLiveEntry(trackDraftMetadata);
                    }}
                  >
                    {runningEntry ? <Square className="size-4" /> : <Play className="size-4" />}
                  </Button>
                </div>
              </div>
              <div
                role="link"
                tabIndex={0}
                aria-current={location.pathname === "/tasks" ? "page" : undefined}
                className={`h-16 cursor-pointer rounded-xl border px-3 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                  location.pathname === "/tasks"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/70 bg-background/70 hover:bg-background"
                }`}
                onClick={() => navigate("/tasks")}
                onKeyDown={(event) => handleSidebarNavKeyDown(event, "/tasks")}
              >
                <div className="flex h-full items-center justify-between gap-2">
                  <div className="flex h-full min-w-0 flex-1 flex-col justify-center">
                    <SidebarStatusText title="Tasks" subtext={taskSubtext} active={location.pathname === "/tasks"} />
                  </div>
                  {taskSubtext && activeTasks.length > 1 ? (
                    <Button
                      size="icon"
                      variant={location.pathname === "/tasks" ? "secondary" : "ghost"}
                      className={
                        location.pathname === "/tasks"
                          ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90"
                          : undefined
                      }
                      onClick={(event) => {
                        event.stopPropagation();
                        setActiveTaskIndex((index) => (index + 1) % activeTasks.length);
                      }}
                    >
                      <ChevronRight className="size-4" />
                    </Button>
                  ) : null}
                </div>
              </div>
              <div
                role="link"
                tabIndex={0}
                aria-current={location.pathname === "/focus" ? "page" : undefined}
                className={`h-16 cursor-pointer rounded-xl border px-3 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
                  location.pathname === "/focus"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/70 bg-background/70 hover:bg-background"
                }`}
                onClick={() => navigate("/focus")}
                onKeyDown={(event) => handleSidebarNavKeyDown(event, "/focus")}
              >
                <div className="flex h-full items-center justify-between gap-2">
                  <div className="flex h-full min-w-0 flex-1 flex-col justify-center">
                    <SidebarStatusText title="Focus" subtext={focusSubtext} active={location.pathname === "/focus"} mono />
                  </div>
                  <Button
                    size="icon"
                    variant={location.pathname === "/focus" ? "secondary" : "ghost"}
                    className={
                      location.pathname === "/focus"
                        ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90"
                        : undefined
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      if (focusEndsAt) {
                        pauseFocusTimer();
                        return;
                      }
                      startFocusTimer();
                    }}
                  >
                    {focusEndsAt ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </Button>
                </div>
              </div>
            </div>
            <FileSidebarBrowser />
          </div>
        </aside>
        <div className="min-w-0 md:h-screen md:overflow-y-auto md:overscroll-contain">
          <Routes>
            <Route path="/" element={<Navigate to="/track" replace />} />
            <Route path="/track" element={<TrackPage />} />
            <Route path="/focus" element={<FocusPage />} />
            <Route path="/files" element={<FilesPage />} />
            <Route path="/task" element={<Navigate to="/tasks" replace />} />
            <Route path="/tasks" element={<TasksPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </div>
      <Toaster richColors closeButton position="top-right" />
    </div>
  );
}
