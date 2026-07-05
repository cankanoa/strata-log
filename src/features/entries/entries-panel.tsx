import { useMemo, useState, type ReactNode } from "react";
import { addDays, format, isSameMonth } from "date-fns";
import { CalendarDaysIcon, ListIcon, TablePropertiesIcon, Trash2Icon } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EntryForm } from "@/features/timer/entry-form";
import { formatMetadataFieldValue, getSessionMetadataFields } from "@/lib/metadata";
import { getResolvedMetadataFields, resolveEntryMetadata } from "@/lib/attribute-references";
import { buildDayDisplayLayout, formatDateTime, formatDuration, getSessionBounds, hourLabel, monthGrid, netDurationMs, weekdayRange } from "@/lib/time";
import { EntryQueryService } from "@/services/entry-query-service";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";

const HOUR_ROW_HEIGHT = 32;
const DAY_MINUTES = 24 * 60;
const WEEK_CAPSULE_RADIUS = "18px";
const WEEK_MINIMUM_MINUTES = 15;
const TIMELINE_BORDER_CLASS = "border-border/90";

function TimelineLabel({ children, align = "center" }: { children: ReactNode; align?: "center" | "right" }) {
  return (
    <div
      className={`text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground ${
        align === "right" ? "text-right" : "text-center"
      }`}
    >
      {children}
    </div>
  );
}

function WeekTimeline({
  days,
  layout,
  getLabel,
  onSelect
}: {
  days: Date[];
  layout: ReturnType<typeof buildDayDisplayLayout>;
  getLabel: (entryId: string) => string;
  onSelect: (entryId: string) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[960px]">
        <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] gap-3">
          <div />
          {days.map((day) => (
            <TimelineLabel key={day.toISOString()}>
              {format(day, "EEE")}
              <br />
              {format(day, "d")}
            </TimelineLabel>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-[56px_repeat(7,minmax(0,1fr))] gap-3">
          <div className="grid grid-rows-24 pr-2">
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={hour} className="border-b border-transparent" style={{ height: `${HOUR_ROW_HEIGHT}px` }}>
                <TimelineLabel align="right">{hourLabel(hour)}</TimelineLabel>
              </div>
            ))}
          </div>
          {days.map((day, dayIndex) => {
            const items = layout[format(day, "yyyy-MM-dd")] ?? [];
            return (
              <div
                key={day.toISOString()}
                className={`relative overflow-hidden border bg-background/70 ${TIMELINE_BORDER_CLASS}`}
                style={{
                  height: `${24 * HOUR_ROW_HEIGHT}px`,
                  borderRadius:
                    dayIndex === 0
                      ? `${WEEK_CAPSULE_RADIUS} 0 0 ${WEEK_CAPSULE_RADIUS}`
                      : dayIndex === days.length - 1
                        ? `0 ${WEEK_CAPSULE_RADIUS} ${WEEK_CAPSULE_RADIUS} 0`
                        : "0"
                }}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <div
                    key={hour}
                    className={`absolute inset-x-0 border-b ${TIMELINE_BORDER_CLASS}`}
                    style={{ top: `${hour * HOUR_ROW_HEIGHT}px`, height: `${HOUR_ROW_HEIGHT}px` }}
                  />
                ))}
                {items.map((item, index) => {
                  const startRatio = item.startMinute / DAY_MINUTES;
                  const minimumHeight = (WEEK_MINIMUM_MINUTES / 60) * HOUR_ROW_HEIGHT;
                  const renderedHeight = Math.max((item.sizeMinutes / 60) * HOUR_ROW_HEIGHT, minimumHeight);
                  return (
                    <button
                      key={`${item.entry.id}-${index}`}
                      type="button"
                      className="absolute overflow-hidden rounded-md bg-primary px-2 py-1 text-left text-primary-foreground shadow-sm"
                      style={{
                        top: `${startRatio * 24 * HOUR_ROW_HEIGHT + item.row * 8}px`,
                        left: `${5 + item.row * 6}px`,
                        right: "6px",
                        minHeight: `${minimumHeight}px`,
                        height: `${renderedHeight}px`
                      }}
                      onClick={() => onSelect(item.entry.id)}
                    >
                      <span className="block truncate text-[9px] font-medium">{getLabel(item.entry.id)}</span>
                      <span className="block truncate text-[9px]">{formatDuration(netDurationMs(item.entry))}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function MonthCalendar({
  days,
  layout,
  anchorDate,
  onSelect
}: {
  days: Date[];
  layout: ReturnType<typeof buildDayDisplayLayout>;
  anchorDate: Date;
  onSelect: (entryId: string) => void;
}) {
  const weeks = Array.from({ length: Math.ceil(days.length / 7) }, (_, index) =>
    days.slice(index * 7, index * 7 + 7)
  );

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-7 gap-0">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
          <TimelineLabel key={label}>{label}</TimelineLabel>
        ))}
      </div>
      <div className="grid gap-2">
        {weeks.map((week, weekIndex) => (
          <div key={`week-${weekIndex}`} className="grid gap-1">
            <div className="grid grid-cols-7 gap-0">
              {week.map((day) => (
                <TimelineLabel key={`label-${day.toISOString()}`}>{format(day, "d")}</TimelineLabel>
              ))}
            </div>
            <div
              className={`grid grid-cols-7 gap-0 overflow-hidden border ${TIMELINE_BORDER_CLASS}`}
              style={{
                borderRadius:
                  weekIndex === 0
                    ? `${WEEK_CAPSULE_RADIUS} ${WEEK_CAPSULE_RADIUS} 0 0`
                    : weekIndex === weeks.length - 1
                      ? `0 0 ${WEEK_CAPSULE_RADIUS} ${WEEK_CAPSULE_RADIUS}`
                      : "0"
              }}
            >
              {week.map((day, dayIndex) => {
                const items = layout[format(day, "yyyy-MM-dd")] ?? [];
                const rowCount = Math.max(
                  1,
                  items.reduce((max, current) => Math.max(max, current.row + 1), 1)
                );
                const gap = 2;
                const capsuleHeight = 72;
                const innerHeight = capsuleHeight - 8;
                const barHeight = Math.max(1, (innerHeight - (rowCount - 1) * gap) / rowCount);
                return (
                  <div
                    key={day.toISOString()}
                    className={`relative overflow-hidden ${dayIndex === 0 ? "" : `border-l ${TIMELINE_BORDER_CLASS}`} ${isSameMonth(day, anchorDate) ? "bg-background/70" : "bg-background/45"}`}
                    style={{
                      minHeight: `${capsuleHeight}px`
                    }}
                  >
                    <div className="relative h-full min-h-20 px-1 py-1">
                      {items.map((item, index) => {
                        const startRatio = item.startMinute / DAY_MINUTES;
                        const sizeRatio = Math.max(item.sizeMinutes, 1) / DAY_MINUTES;
                        return (
                          <button
                            key={`${item.entry.id}-${index}`}
                            type="button"
                            className="absolute rounded-sm bg-primary shadow-sm"
                            style={{
                              left: `${startRatio * 100}%`,
                              width: `${sizeRatio * 100}%`,
                              top: `${4 + item.row * (barHeight + gap)}px`,
                              minWidth: "1px",
                              height: `${barHeight}px`
                            }}
                            onClick={() => onSelect(item.entry.id)}
                          />
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EntriesPanel() {
  const {
    file,
    sort,
    filters,
    entriesView,
    setEntriesView,
    setSort,
    setFilters,
    selectedEntryId,
    setSelectedEntryId,
    updateEntry,
    deleteEntry
  } = useAppStore(useShallow((state) => ({
    file: state.file,
    sort: state.sort,
    filters: state.filters,
    entriesView: state.entriesView,
    setEntriesView: state.setEntriesView,
    setSort: state.setSort,
    setFilters: state.setFilters,
    selectedEntryId: state.selectedEntryId,
    setSelectedEntryId: state.setSelectedEntryId,
    updateEntry: state.updateEntry,
    deleteEntry: state.deleteEntry
  })));
  const [anchorDate, setAnchorDate] = useState(() => new Date());
  const resolvedFields = useMemo(() => getResolvedMetadataFields(file), [file]);
  const sessionFields = useMemo(() => getSessionMetadataFields(resolvedFields), [resolvedFields]);
  const displayEntries = useMemo(
    () =>
      file
        ? file.entries.map((entry) => ({
            ...entry,
            metadata: resolveEntryMetadata(file, entry)
          }))
        : [],
    [file]
  );

  const entries = useMemo(() => {
    if (!file) {
      return [];
    }
    return EntryQueryService.sortEntries(
      EntryQueryService.filterEntries(displayEntries, filters, resolvedFields),
      sort,
      resolvedFields
    );
  }, [displayEntries, file, filters, resolvedFields, sort]);

  const selectedEntry = file?.entries.find((entry) => entry.id === selectedEntryId) ?? null;
  const weekDays = weekdayRange(anchorDate);
  const monthDays = monthGrid(anchorDate);
  const weekLayout = useMemo(() => buildDayDisplayLayout(entries, weekDays, WEEK_MINIMUM_MINUTES), [entries, weekDays]);
  const monthLayout = useMemo(() => buildDayDisplayLayout(entries, monthDays, 1), [entries, monthDays]);

  function getEntryTitle(entryId: string) {
    const currentEntry = entries.find((entry) => entry.id === entryId);
    if (!currentEntry) {
      return "Entry";
    }
    const sourceFields = sessionFields
      .map(([key, field]) => formatMetadataFieldValue(field, currentEntry.metadata?.[key]))
      .find((value) => value !== "—");
    return sourceFields || "Entry";
  }

  return (
    <div className="grid gap-6">
      <Card className="border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
        <CardHeader className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <div className="min-w-0 space-y-1">
            <CardTitle>Entries</CardTitle>
            <CardDescription>Sort, filter, and review sessions in list, week, and month views.</CardDescription>
          </div>
          <Tabs className="shrink-0 justify-self-start md:justify-self-end" value={entriesView} onValueChange={(value) => setEntriesView(value as typeof entriesView)}>
            <TabsList>
              <TabsTrigger value="list"><ListIcon className="size-4" />List</TabsTrigger>
              <TabsTrigger value="week"><TablePropertiesIcon className="size-4" />Week</TabsTrigger>
              <TabsTrigger value="month"><CalendarDaysIcon className="size-4" />Month</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent className="grid gap-6">
          {file ? (
            <div className="grid gap-3 rounded-xl border border-border/70 bg-background/70 p-4 md:grid-cols-[220px_1fr]">
              <div className="grid gap-2">
                <Label>Filter field</Label>
                <Select
                  value={filters[0]?.field ?? "__none__"}
                  onValueChange={(nextField) =>
                    setFilters(nextField && nextField !== "__none__" ? [{ field: nextField, value: filters[0]?.value ?? "" }] : [])
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Filter field" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No filter</SelectItem>
                    {sessionFields.map(([key]) => (
                      <SelectItem key={key} value={key}>{key}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label>Filter value</Label>
                <Input
                  placeholder="Type to filter rows"
                  value={filters[0]?.value ?? ""}
                  onChange={(event) =>
                    setFilters(filters[0]?.field ? [{ field: filters[0].field, value: event.target.value }] : [])
                  }
                />
              </div>
            </div>
          ) : null}

          {file && entriesView === "list" ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead><Button variant="ghost" size="sm" onClick={() => setSort("start")}>Start</Button></TableHead>
                  <TableHead><Button variant="ghost" size="sm" onClick={() => setSort("end")}>End</Button></TableHead>
                  <TableHead><Button variant="ghost" size="sm" onClick={() => setSort("duration")}>Duration</Button></TableHead>
                  <TableHead>Interval Count</TableHead>
                  {sessionFields.map(([key]) => (
                    <TableHead key={key}>
                      <Button variant="ghost" size="sm" onClick={() => setSort(key)}>{key}</Button>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => {
                  const bounds = getSessionBounds(entry);
                  return (
                    <TableRow key={entry.id} onClick={() => setSelectedEntryId(entry.id)} className="cursor-pointer">
                      <TableCell>{bounds.start ? formatDateTime(bounds.start) : "—"}</TableCell>
                      <TableCell>{entry.type === "running" ? <Badge>Running</Badge> : bounds.end ? formatDateTime(bounds.end) : "—"}</TableCell>
                      <TableCell>{formatDuration(netDurationMs(entry))}</TableCell>
                      <TableCell>{entry.intervals?.length ?? 0}</TableCell>
                      {sessionFields.map(([key, field]) => (
                        <TableCell key={key}>{formatMetadataFieldValue(field, entry.metadata?.[key])}</TableCell>
                      ))}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : null}

          {file && entriesView === "week" ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between">
                <Button variant="outline" onClick={() => setAnchorDate((date) => addDays(date, -7))}>Previous</Button>
                <h4 className="text-sm font-medium">{format(anchorDate, "MMMM d, yyyy")}</h4>
                <Button variant="outline" onClick={() => setAnchorDate((date) => addDays(date, 7))}>Next</Button>
              </div>
              <WeekTimeline days={weekDays} layout={weekLayout} getLabel={getEntryTitle} onSelect={setSelectedEntryId} />
            </div>
          ) : null}

          {file && entriesView === "month" ? (
            <div className="grid gap-4">
              <div className="flex items-center justify-between">
                <Button variant="outline" onClick={() => setAnchorDate((date) => addDays(date, -28))}>Previous</Button>
                <h4 className="text-sm font-medium">{format(anchorDate, "MMMM yyyy")}</h4>
                <Button variant="outline" onClick={() => setAnchorDate((date) => addDays(date, 28))}>Next</Button>
              </div>
              <MonthCalendar days={monthDays} layout={monthLayout} anchorDate={anchorDate} onSelect={setSelectedEntryId} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={Boolean(file && selectedEntry)} onOpenChange={(open) => !open && setSelectedEntryId(null)}>
        {selectedEntry && file ? (
          <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden sm:max-w-4xl">
            <div className="overflow-y-auto pr-1">
              <EntryForm
                fields={file.fields}
                attributeReferenceGroups={file.attributeReferenceGroups}
                initialEntry={selectedEntry}
                submitLabel="Update Entry"
                chrome="plain"
                onSubmit={async (entry) => {
                  await updateEntry(selectedEntry.id, { ...selectedEntry, ...entry });
                  setSelectedEntryId(null);
                }}
                onCancel={() => setSelectedEntryId(null)}
                footerStart={
                  <AlertDialog>
                    <AlertDialogTrigger render={<Button variant="destructive" />}>
                      <Trash2Icon className="size-4" />
                      Delete Entry
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
                        <AlertDialogDescription>This removes the session and its intervals from the open CSDB file.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          variant="destructive"
                          onClick={() => {
                            void deleteEntry(selectedEntry.id);
                            setSelectedEntryId(null);
                          }}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                }
              />
            </div>
          </DialogContent>
        ) : null}
      </Dialog>
    </div>
  );
}
