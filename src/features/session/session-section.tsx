import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Play, Square } from "lucide-react";
import { DateTimePicker } from "@/components/forms/date-time-picker";
import { MetadataFieldsForm } from "@/components/forms/metadata-fields-form";
import { AttributeReferenceOptionsDialog } from "@/features/database/attribute-reference-options-dialog";
import { FieldOptionValueResolutionDialog } from "@/features/database/field-option-value-resolution-dialog";
import { FieldOptionsDialog } from "@/features/database/field-options-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { SessionPresetsMenu } from "@/features/session/session-presets-menu";
import { EntryForm } from "@/features/timer/entry-form";
import { getFieldOptionsWithAttributeReferences } from "@/lib/attribute-references";
import {
  emptyMetadata,
  getIntervalMetadataFieldDefinitions,
  getSessionMetadataFieldDefinitions,
  parseFieldOption,
  serializeFieldOption
} from "@/lib/metadata";
import { TimeLogDatabase, type FieldOptionValueChange, type FieldOptionValueResolution } from "@/lib/time-log-database";
import { formatDurationWithSeconds, getRunningEntry, netDurationMs } from "@/lib/time";
import type { AttributeReferenceGroup, FieldDefinition, SessionMetadata } from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";

function scopeGroups(groups: AttributeReferenceGroup[], interval: boolean): AttributeReferenceGroup[] {
  return groups.map((group) => ({
    ...group,
    fields: Object.fromEntries(Object.entries(group.fields).filter(([, field]) => Boolean(field.interval) === interval))
  }));
}

export function SessionSection() {
  const navigate = useNavigate();
  const {
    file,
    fileHandle,
    trackDraftMetadata,
    setTrackDraftMetadata,
    addManualEntry,
    updateSessionPresets,
    updateField,
    updateFieldAttributeReferences,
    startLiveEntry,
    startLiveEntryAt,
    stopLiveEntry
  } = useAppStore(useShallow((state) => ({
    file: state.file,
    fileHandle: state.fileHandle,
    trackDraftMetadata: state.trackDraftMetadata,
    setTrackDraftMetadata: state.setTrackDraftMetadata,
    addManualEntry: state.addManualEntry,
    updateSessionPresets: state.updateSessionPresets,
    updateField: state.updateField,
    updateFieldAttributeReferences: state.updateFieldAttributeReferences,
    startLiveEntry: state.startLiveEntry,
    startLiveEntryAt: state.startLiveEntryAt,
    stopLiveEntry: state.stopLiveEntry
  })));
  const runningEntry = getRunningEntry(file?.entries ?? []);
  const metadataResetKey = file ? JSON.stringify([fileHandle?.path ?? "", file.fields, file.attributeReferenceGroups]) : "";
  const runningResetKey = runningEntry
    ? JSON.stringify([
        runningEntry.id,
        runningEntry.metadata ?? {},
        runningEntry.intervals?.at(-1)?.metadata ?? {}
      ])
    : "";
  const [startAtValue, setStartAtValue] = useState<string>();
  const [isStartAtOpen, setIsStartAtOpen] = useState(false);
  const [isManualOpen, setIsManualOpen] = useState(false);
  const [optionsEditor, setOptionsEditor] = useState<{
    name: string;
    field: FieldDefinition;
  } | null>(null);
  const [pendingOptionResolution, setPendingOptionResolution] = useState<{
    name: string;
    nextField: FieldDefinition;
    changes: FieldOptionValueChange[];
  } | null>(null);
  const [, setTick] = useState(0);
  const sessionFields = getSessionMetadataFieldDefinitions(file?.fields ?? {});
  const intervalFields = getIntervalMetadataFieldDefinitions(file?.fields ?? {});
  const sessionGroups = scopeGroups(file?.attributeReferenceGroups ?? [], false);
  const intervalGroups = scopeGroups(file?.attributeReferenceGroups ?? [], true);
  const hasSessionFields = Object.keys(sessionFields).length > 0 || sessionGroups.some((group) => Object.keys(group.fields).length > 0);
  const hasIntervalFields = Object.keys(intervalFields).length > 0 || intervalGroups.some((group) => Object.keys(group.fields).length > 0);

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
        {
          ...(file ? emptyMetadata(file.fields) : {}),
          ...(runningEntry.metadata ?? {}),
          ...(runningEntry.intervals?.at(-1)?.metadata ?? {})
        }
      );
      return;
    }
    if (file) {
      setTrackDraftMetadata(emptyMetadata(file.fields));
      return;
    }
    setTrackDraftMetadata({});
  }, [metadataResetKey, runningResetKey, setTrackDraftMetadata]);

  async function handleStartNow() {
    return startLiveEntry(trackDraftMetadata);
  }

  async function handleContinue() {
    const started = await handleStartNow();
    if (started) {
      navigate("/tasks");
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

  function openOptionsEditor(name: string) {
    const field = file?.fields[name];
    if (!field) {
      return;
    }
    setOptionsEditor({ name, field });
  }

  async function saveOptions(name: string, nextField: FieldDefinition) {
    const changes = file ? TimeLogDatabase.getFieldOptionValueChanges(file, name, nextField) : [];
    if (changes.length > 0) {
      setPendingOptionResolution({ name, nextField, changes });
      return false;
    }
    const saved = await updateField(name, nextField);
    if (saved) {
      setOptionsEditor(null);
    }
    return saved;
  }

  async function resolveOptionValues(resolution: FieldOptionValueResolution) {
    if (!pendingOptionResolution) {
      return;
    }
    const saved = await updateField(
      pendingOptionResolution.name,
      pendingOptionResolution.nextField,
      {
        changes: pendingOptionResolution.changes,
        resolution
      }
    );
    if (saved) {
      setPendingOptionResolution(null);
      setOptionsEditor(null);
    }
  }

  function updateDraftScope(fields: Record<string, FieldDefinition>, metadata: SessionMetadata) {
    setTrackDraftMetadata({
      ...trackDraftMetadata,
      ...Object.fromEntries(Object.keys(fields).map((key) => [key, metadata[key]]))
    });
  }

  return (
    <>
      <Card className="border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <CardTitle>Session</CardTitle>
          <div className="flex flex-wrap gap-2">
            <SessionPresetsMenu
              file={file}
              disabled={!file || Boolean(runningEntry)}
              currentMetadata={trackDraftMetadata}
              onApply={setTrackDraftMetadata}
              onSave={updateSessionPresets}
            />
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

          {hasSessionFields ? (
            <section className="grid gap-3">
              <h3 className="text-sm font-medium text-muted-foreground">Session Fields</h3>
              <MetadataFieldsForm
                fields={sessionFields}
                attributeReferenceGroups={sessionGroups}
                taskSources={file?.taskSources ?? []}
                value={trackDraftMetadata}
                onChange={(metadata) => updateDraftScope(sessionFields, metadata)}
                onEditOptions={openOptionsEditor}
              />
            </section>
          ) : null}

          {hasIntervalFields ? (
            <section className="grid gap-3">
              <h3 className="text-sm font-medium text-muted-foreground">Interval Fields</h3>
              <MetadataFieldsForm
                fields={intervalFields}
                attributeReferenceGroups={intervalGroups}
                taskSources={file?.taskSources ?? []}
                value={trackDraftMetadata}
                onChange={(metadata) => updateDraftScope(intervalFields, metadata)}
                onEditOptions={openOptionsEditor}
              />
            </section>
          ) : null}

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
            taskSources={file?.taskSources ?? []}
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

      {optionsEditor?.field.type === "attribute_reference" ? (
        <AttributeReferenceOptionsDialog
          open
          title={`Attribute References for ${optionsEditor.name}`}
          description="Enter the attribute reference group names this field should offer in Track. Existing names are reused, new ones are created automatically."
          initialLabels={getFieldOptionsWithAttributeReferences(optionsEditor.field, file).map((option) => option.value)}
          onOpenChange={(open) => !open && setOptionsEditor(null)}
          onSave={async (labels) => {
            const saved = await updateFieldAttributeReferences(optionsEditor.name, labels);
            if (saved) {
              setOptionsEditor(null);
            }
          }}
        />
      ) : optionsEditor ? (
        <FieldOptionsDialog
          open
          title={`Options for ${optionsEditor.name}`}
          description="Set the display label and saved value for each option."
          field={optionsEditor.field}
          initialOptions={(optionsEditor.field.options ?? []).map((option) =>
            serializeFieldOption(parseFieldOption(option))
          )}
          onOpenChange={(open) => !open && setOptionsEditor(null)}
          onSave={async (options) => {
            return saveOptions(optionsEditor.name, { ...optionsEditor.field, options });
          }}
        />
      ) : null}

      {pendingOptionResolution ? (
        <FieldOptionValueResolutionDialog
          open
          fieldName={pendingOptionResolution.name}
          changes={pendingOptionResolution.changes}
          onOpenChange={(open) => !open && setPendingOptionResolution(null)}
          onResolve={resolveOptionValues}
        />
      ) : null}
    </>
  );
}
