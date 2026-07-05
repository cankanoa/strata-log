import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { Pause, Play, Square } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatDuration, formatDurationWithSeconds, getRunningEntry, netDurationMs } from "@/lib/time";
import { TaskSidebarBrowser } from "@/components/task/task-sidebar-browser";
import { DatabaseReferenceSyncDialog } from "@/features/database/database-reference-sync-dialog";
import { getMissingDatabaseReferences, removeDatabaseReferences, type DatabaseReferenceStatus } from "@/lib/database-registry-sync";
import { getActiveDatabaseEntry, parseDatabaseRegistry } from "@/lib/database-registry";
import { getPlatformApi } from "@/lib/platform";
import { Toaster } from "@/components/ui/sonner";
import { FocusPage } from "@/pages/focus-page";
import { TrackPage } from "@/pages/track-page";
import { SettingsPage } from "@/pages/settings-page";
import { TaskPage } from "@/pages/task-page";
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
  const [missingDatabaseReferences, setMissingDatabaseReferences] = useState<DatabaseReferenceStatus[]>([]);
  const startupDatabaseSyncRan = useRef(false);
  const focusRemainingSeconds = focusEndsAt
    ? Math.max(0, Math.ceil((focusEndsAt - Date.now()) / 1000))
    : focusDurationSeconds;

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
        navigate("/task");
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
      <div className="md:grid md:min-h-screen md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="sticky top-0 z-10 border-b border-border/70 bg-[var(--app-shell-background)] md:h-screen md:border-b-0 md:border-r">
          <div className="flex min-h-0 flex-col gap-3 p-4 md:h-full md:justify-start">
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
                className={`rounded-xl border px-3 py-2 ${
                  location.pathname === "/track"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/70 bg-background/70"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Link
                    to="/track"
                    className={`min-w-0 flex-1 rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-ring ${
                      location.pathname === "/track" ? "text-primary-foreground" : "hover:opacity-80"
                    }`}
                  >
                    <div
                      className={`text-xs font-medium ${
                        location.pathname === "/track" ? "text-primary-foreground/80" : "text-muted-foreground"
                      }`}
                    >
                      Track
                    </div>
                    <div className="font-mono text-lg font-semibold">
                      {runningEntry ? formatDurationWithSeconds(netDurationMs(runningEntry)) : "00:00:00"}
                    </div>
                  </Link>
                  <Button
                    size="icon"
                    variant={location.pathname === "/track" ? "secondary" : "ghost"}
                    className={
                      location.pathname === "/track"
                        ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90"
                        : undefined
                    }
                    disabled={!file}
                    onClick={() => {
                      if (runningEntry) {
                        void stopLiveEntry();
                        return;
                      }
                      void startLiveEntry(trackDraftMetadata).then((started) => {
                        if (started) {
                          navigate("/focus");
                        }
                      });
                    }}
                  >
                    {runningEntry ? <Square className="size-4" /> : <Play className="size-4" />}
                  </Button>
                </div>
              </div>
              <div
                className={`rounded-xl border px-3 py-2 ${
                  location.pathname === "/focus"
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border/70 bg-background/70"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <Link
                    to="/focus"
                    className={`min-w-0 flex-1 rounded-md outline-none transition focus-visible:ring-2 focus-visible:ring-ring ${
                      location.pathname === "/focus" ? "text-primary-foreground" : "hover:opacity-80"
                    }`}
                  >
                    <div
                      className={`text-xs font-medium ${
                        location.pathname === "/focus" ? "text-primary-foreground/80" : "text-muted-foreground"
                      }`}
                    >
                      Focus
                    </div>
                    <div className="font-mono text-lg font-semibold">{formatFocusDuration(focusRemainingSeconds)}</div>
                  </Link>
                  <Button
                    size="icon"
                    variant={location.pathname === "/focus" ? "secondary" : "ghost"}
                    className={
                      location.pathname === "/focus"
                        ? "bg-primary-foreground text-primary hover:bg-primary-foreground/90"
                        : undefined
                    }
                    onClick={() => {
                      if (focusEndsAt) {
                        pauseFocusTimer();
                        return;
                      }
                      startFocusTimer();
                      navigate("/task");
                    }}
                  >
                    {focusEndsAt ? <Pause className="size-4" /> : <Play className="size-4" />}
                  </Button>
                </div>
              </div>
            </div>
            <TaskSidebarBrowser />
          </div>
        </aside>
        <div className="min-w-0">
          <Routes>
            <Route path="/" element={<Navigate to="/track" replace />} />
            <Route path="/track" element={<TrackPage />} />
            <Route path="/focus" element={<FocusPage />} />
            <Route path="/task" element={<TaskPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </div>
      </div>
      <Toaster richColors closeButton position="top-right" />
    </div>
  );
}
