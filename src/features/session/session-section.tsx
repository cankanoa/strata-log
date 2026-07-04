import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Square } from "lucide-react";
import { DateTimePicker } from "@/components/forms/date-time-picker";
import { MetadataFieldsForm } from "@/components/forms/metadata-fields-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { EntryForm } from "@/features/timer/entry-form";
import { emptyMetadata } from "@/lib/metadata";
import { formatDurationWithSeconds, getRunningEntry, netDurationMs } from "@/lib/time";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";

export function SessionSection() {
  const navigate = useNavigate();
  const {
    file,
    trackDraftMetadata,
    setTrackDraftMetadata,
    addManualEntry,
    startLiveEntry,
    startLiveEntryAt,
    stopLiveEntry
  } = useAppStore(useShallow((state) => ({
    file: state.file,
    trackDraftMetadata: state.trackDraftMetadata,
    setTrackDraftMetadata: state.setTrackDraftMetadata,
    addManualEntry: state.addManualEntry,
    startLiveEntry: state.startLiveEntry,
    startLiveEntryAt: state.startLiveEntryAt,
    stopLiveEntry: state.stopLiveEntry
  })));
  const runningEntry = getRunningEntry(file?.entries ?? []);
  const [startAtValue, setStartAtValue] = useState<string>();
  const [isStartAtOpen, setIsStartAtOpen] = useState(false);
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!runningEntry) {
      return;
    }
    const interval = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [runningEntry]);

  useEffect(() => {
    if (runningEntry) {
      setTrackDraftMetadata(
        runningEntry.intervalMetadata
          ? {
              ...(file ? emptyMetadata(file.fields) : {}),
              ...(runningEntry.intervals?.at(-1)?.metadata ?? {})
            }
          : {
              ...(file ? emptyMetadata(file.fields) : {}),
              ...(runningEntry.metadata ?? {})
            }
      );
      return;
    }
    if (file) {
      setTrackDraftMetadata(emptyMetadata(file.fields));
      return;
    }
    setTrackDraftMetadata({});
  }, [file, runningEntry, setTrackDraftMetadata]);

  async function handleStartNow() {
    return startLiveEntry(trackDraftMetadata);
  }

  async function handleContinue() {
    const started = await handleStartNow();
    if (started) {
      navigate("/focus");
    }
  }

  async function handleStartAt() {
    if (!startAtValue) {
      return;
    }
    const started = await startLiveEntryAt(trackDraftMetadata, startAtValue);
    if (started) {
      setIsStartAtOpen(false);
      setStartAtValue(undefined);
    }
  }

  return (
    <>
      <Card className="border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <CardTitle>Session</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setIsStartAtOpen(true)} disabled={!file || Boolean(runningEntry)}>
              Start At
            </Button>
            <Button variant="outline" onClick={() => setIsManualOpen(true)} disabled={!file || Boolean(runningEntry)}>
              Manual
            </Button>
            {runningEntry ? (
              <Button onClick={() => void stopLiveEntry()} disabled={!file} variant="outline">
                <Square className="size-4" />
                Stop Session
              </Button>
            ) : (
              <>
                <Button onClick={() => void handleStartNow()} disabled={!file} variant="secondary">
                  Start
                </Button>
                <Button onClick={() => void handleContinue()} disabled={!file} variant="default">
                  Continue
                </Button>
              </>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="flex items-center gap-4">
            <div className="text-5xl font-semibold tracking-tight md:text-6xl">
              {runningEntry ? formatDurationWithSeconds(netDurationMs(runningEntry)) : "00:00:00"}
            </div>
            <div className="flex items-center self-center rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground">
              {runningEntry ? "Running" : "Stopped"}
              <span
                className={`ml-2 inline-flex size-2.5 rounded-full ${runningEntry ? "animate-pulse bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.6)]" : "bg-muted-foreground/40"}`}
                aria-hidden="true"
              />
            </div>
          </div>

          <MetadataFieldsForm
            fields={file?.fields ?? {}}
            attributeReferenceGroups={file?.attributeReferenceGroups ?? []}
            value={trackDraftMetadata}
            onChange={setTrackDraftMetadata}
          />

          {!file ? (
            <p className="text-sm text-muted-foreground">
              Load a database to enable session metadata and start controls.
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={isStartAtOpen} onOpenChange={setIsStartAtOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start At</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <DateTimePicker label="Start Time" value={startAtValue} onChange={setStartAtValue} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setIsStartAtOpen(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleStartAt()} disabled={!startAtValue}>
                <Play className="size-4" />
                Start
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={isManualOpen} onOpenChange={setIsManualOpen}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Manual Entry</DialogTitle>
          </DialogHeader>
          <EntryForm
            fields={file?.fields ?? {}}
            attributeReferenceGroups={file?.attributeReferenceGroups ?? []}
            title="Manual Entry"
            submitLabel="Save Entry"
            onSubmit={async (entry) => {
              const saved = await addManualEntry(entry);
              if (saved) {
                setIsManualOpen(false);
              }
            }}
            onCancel={() => setIsManualOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
