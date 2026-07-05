import { useEffect, useMemo, useState, type ReactNode } from "react";
import { v4 as uuidv4 } from "uuid";
import { PlayIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { DateTimePicker } from "@/components/forms/date-time-picker";
import { MetadataFieldsForm } from "@/components/forms/metadata-fields-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  emptyMetadata,
  getIntervalMetadataFieldDefinitions,
  getSessionMetadataFieldDefinitions
} from "@/lib/metadata";
import { toIsoWithOffset } from "@/lib/time";
import type { AttributeReferenceGroup, EntryInterval, FieldDefinition, SessionMetadata, TimeInterval } from "@/lib/types";

type EntryFormProps = {
  fields: Record<string, FieldDefinition>;
  attributeReferenceGroups?: AttributeReferenceGroup[];
  initialEntry?: EntryInterval | null;
  title?: string;
  submitLabel: string;
  onSubmit: (entry: Omit<EntryInterval, "id">) => Promise<void> | void;
  onCancel?: () => void;
  chrome?: "card" | "plain";
  footerStart?: ReactNode;
};

type EntryFormState = {
  type: string;
  metadata: SessionMetadata;
  intervals: TimeInterval[];
};

function scopeGroups(groups: AttributeReferenceGroup[], interval: boolean): AttributeReferenceGroup[] {
  return groups.map((group) => ({
    ...group,
    fields: Object.fromEntries(Object.entries(group.fields).filter(([, field]) => Boolean(field.interval) === interval))
  }));
}

function emptyInterval(fields: Record<string, FieldDefinition>, seed?: SessionMetadata): TimeInterval {
  return {
    id: uuidv4(),
    start: "",
    end: "",
    metadata: { ...emptyMetadata(fields), ...(seed ?? {}) }
  };
}

function buildInitialIntervals(
  intervalFields: Record<string, FieldDefinition>,
  initialEntry?: EntryInterval | null
): TimeInterval[] {
  if (!initialEntry?.intervals?.length) {
    return [emptyInterval(intervalFields)];
  }

  return initialEntry.intervals.map((interval) => ({
    ...interval,
    id: interval.id ?? uuidv4(),
    metadata: {
      ...emptyMetadata(intervalFields),
      ...(interval.metadata ?? {})
    }
  }));
}

function buildInitialState(
  sessionFields: Record<string, FieldDefinition>,
  intervalFields: Record<string, FieldDefinition>,
  initialEntry?: EntryInterval | null
): EntryFormState {
  return {
    type: initialEntry?.type ?? "interval",
    metadata: { ...emptyMetadata(sessionFields), ...(initialEntry?.metadata ?? {}) },
    intervals: buildInitialIntervals(intervalFields, initialEntry)
  };
}

function submittedEntry(state: EntryFormState): Omit<EntryInterval, "id"> {
  return {
    type: state.type,
    metadata: state.metadata,
    intervals: state.intervals.map((interval) => ({
      ...interval,
      metadata: interval.metadata ?? {}
    }))
  };
}

export function EntryForm({
  fields,
  attributeReferenceGroups = [],
  initialEntry,
  title = "Manual Entry",
  submitLabel,
  onSubmit,
  onCancel,
  chrome = "card",
  footerStart
}: EntryFormProps) {
  const sessionFields = useMemo(() => getSessionMetadataFieldDefinitions(fields), [fields]);
  const intervalFields = useMemo(() => getIntervalMetadataFieldDefinitions(fields), [fields]);
  const sessionGroups = useMemo(() => scopeGroups(attributeReferenceGroups, false), [attributeReferenceGroups]);
  const intervalGroups = useMemo(() => scopeGroups(attributeReferenceGroups, true), [attributeReferenceGroups]);
  const [state, setState] = useState<EntryFormState>(() => buildInitialState(sessionFields, intervalFields, initialEntry));

  useEffect(() => {
    setState(buildInitialState(sessionFields, intervalFields, initialEntry));
  }, [intervalFields, initialEntry, sessionFields]);

  function updateInterval(index: number, nextInterval: Partial<TimeInterval>) {
    setState((current) => ({
      ...current,
      intervals: current.intervals.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...nextInterval } : item
      )
    }));
  }

  function addManualInterval() {
    setState((current) => ({
      ...current,
      type: "interval",
      intervals: [
        ...current.intervals,
        emptyInterval(intervalFields, current.intervals.at(-1)?.metadata)
      ]
    }));
  }

  function continueInterval() {
    setState((current) => {
      const intervals =
        current.intervals.length > 0
          ? [...current.intervals]
          : [emptyInterval(intervalFields)];
      const lastIndex = intervals.length - 1;
      intervals[lastIndex] = {
        ...intervals[lastIndex],
        end: undefined
      };
      return {
        ...current,
        type: "running",
        intervals
      };
    });
  }

  function startNewIntervalNow() {
    const now = toIsoWithOffset(new Date());
    setState((current) => ({
      ...current,
      type: "running",
      intervals: [
        ...current.intervals.map((interval) => ({
          ...interval,
          end: interval.end ?? interval.start
        })),
        {
          id: uuidv4(),
          start: now,
          end: undefined,
          metadata: { ...emptyMetadata(intervalFields), ...(current.intervals.at(-1)?.metadata ?? {}) }
        }
      ]
    }));
  }

  const content = (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" onClick={addManualInterval}>
            <PlusIcon className="size-4" />
            Add manual interval
          </Button>
          <Button variant="outline" size="sm" onClick={continueInterval}>
            Continue interval
          </Button>
          <Button variant="outline" size="sm" onClick={startNewIntervalNow}>
            <PlayIcon className="size-4" />
            Start new interval now
          </Button>
        </div>

        <section className="grid gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">Session Fields</h3>
          <div className="grid gap-4 rounded-xl border border-border/70 bg-background/70 p-4">
            <MetadataFieldsForm
              fields={sessionFields}
              attributeReferenceGroups={sessionGroups}
              value={state.metadata}
              onChange={(metadata) => setState((current) => ({ ...current, metadata }))}
            />
          </div>
        </section>

        <section className="grid gap-3">
          <h3 className="text-sm font-medium text-muted-foreground">Interval Fields</h3>
          {state.intervals.map((interval, index) => (
            <div className="grid gap-4 rounded-xl border border-border/70 bg-background/70 p-4" key={interval.id ?? index}>
              <div className="grid gap-4 md:grid-cols-[1fr_1fr_auto]">
                <DateTimePicker
                  label="Start"
                  value={interval.start}
                  onChange={(start) => updateInterval(index, { start })}
                />
                <DateTimePicker
                  label="End"
                  value={interval.end}
                  allowClear
                  onChange={(end) => updateInterval(index, { end })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-end"
                  onClick={() =>
                    setState((current) => ({
                      ...current,
                      intervals: current.intervals.filter((_, itemIndex) => itemIndex !== index)
                    }))
                  }
                  disabled={state.intervals.length === 1}
                >
                  <Trash2Icon className="size-4" />
                  Remove
                </Button>
              </div>

              <MetadataFieldsForm
                fields={intervalFields}
                attributeReferenceGroups={intervalGroups}
                value={interval.metadata ?? {}}
                onChange={(metadata) => updateInterval(index, { metadata: metadata as SessionMetadata })}
              />
            </div>
          ))}
        </section>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        {footerStart}
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button onClick={() => onSubmit(submittedEntry(state))}>
          {submitLabel}
        </Button>
      </div>
    </div>
  );

  if (chrome === "plain") {
    return content;
  }

  return (
    <Card className="border-white/60 bg-card/85 shadow-xl shadow-amber-950/5 backdrop-blur">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6">{content}</CardContent>
    </Card>
  );
}
