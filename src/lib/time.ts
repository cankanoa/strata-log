import {
  addDays,
  eachDayOfInterval,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  parse,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek
} from "date-fns";
import type { EntryInterval, TimeInterval } from "@/lib/types";

export type NormalizedSessionInterval = {
  start: Date;
  end: Date;
  metadata: Record<string, unknown>;
};

export type SessionDisplaySlice = {
  entry: EntryInterval;
  day: Date;
  start: Date;
  end: Date;
  row: number;
  depth: number;
  startMinute: number;
  endMinute: number;
  sizeMinutes: number;
};

export function parseDate(value: string): Date {
  const parsedIso = parseISO(value);
  if (!Number.isNaN(parsedIso.getTime())) {
    return parsedIso;
  }

  const parsedDisplay = parse(value, "yyyy-MM-dd HH:mm:ss", new Date());
  return parsedDisplay;
}

export function formatDateTime(date: Date | string | undefined): string {
  if (!date) {
    return "—";
  }

  const resolved = typeof date === "string" ? parseDate(date) : date;
  return Number.isNaN(resolved.getTime()) ? "—" : format(resolved, "yyyy-MM-dd HH:mm:ss");
}

export function toIsoWithOffset(date: Date): string {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absolute / 60)).padStart(2, "0");
  const minutes = String(absolute % 60).padStart(2, "0");
  const iso = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 19);
  return `${iso}${sign}${hours}:${minutes}`;
}

export function formatDuration(ms: number): string {
  const totalMinutes = Math.max(0, Math.floor(ms / 60_000));
  const hours = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function formatDurationWithSeconds(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1_000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function normalizeIntervals(entry: EntryInterval): NormalizedSessionInterval[] {
  return (entry.intervals ?? [])
    .filter((interval) => interval.start)
    .map((interval, index, intervals) => {
      const isRunningInterval =
        entry.type === "running" &&
        index === intervals.length - 1 &&
        interval.start &&
        (!interval.end || interval.end === interval.start);

      return {
        start: parseDate(interval.start!),
        end: parseDate(isRunningInterval ? toIsoWithOffset(new Date()) : interval.end ?? interval.start!),
        metadata: interval.metadata ?? {}
      };
    })
    .filter((interval) => !Number.isNaN(interval.start.getTime()) && !Number.isNaN(interval.end.getTime()))
    .sort((left, right) => left.start.getTime() - right.start.getTime());
}

export function getSessionBounds(entry: EntryInterval): { start?: Date; end?: Date } {
  const intervals = normalizeIntervals(entry);
  if (intervals.length === 0) {
    return {};
  }
  return {
    start: intervals[0]?.start,
    end: intervals[intervals.length - 1]?.end
  };
}

export function sessionDurationMs(entry: EntryInterval): number {
  return normalizeIntervals(entry).reduce(
    (total, interval) => total + Math.max(0, interval.end.getTime() - interval.start.getTime()),
    0
  );
}

export function netDurationMs(entry: EntryInterval): number {
  return sessionDurationMs(entry);
}

export function getRunningEntry(entries: EntryInterval[]): EntryInterval | undefined {
  return entries.find((entry) => entry.type === "running");
}

export function weekdayRange(date: Date): Date[] {
  const start = startOfWeek(date, { weekStartsOn: 1 });
  const end = endOfWeek(date, { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end });
}

export function monthGrid(date: Date): Date[] {
  const monthStart = startOfMonth(date);
  const monthEnd = endOfMonth(date);
  const start = startOfWeek(monthStart, { weekStartsOn: 1 });
  const end = endOfWeek(monthEnd, { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end });
}

export function hourLabel(hour: number): string {
  return String(hour + 1).padStart(2, "0");
}

export function splitIntervalAcrossDays(entry: EntryInterval, interval: NormalizedSessionInterval): SessionDisplaySlice[] {
  const slices: SessionDisplaySlice[] = [];
  let cursor = new Date(interval.start);

  while (cursor <= interval.end) {
    const dayStart = startOfDay(cursor);
    const dayEnd = endOfDay(cursor);
    const start = cursor.getTime() === interval.start.getTime() ? interval.start : dayStart;
    const end = interval.end < dayEnd ? interval.end : dayEnd;
    const startMinute = start.getHours() * 60 + start.getMinutes();
    const rawEndMinute = end.getHours() * 60 + end.getMinutes();
    const endMinute = end.getTime() === dayEnd.getTime() ? 24 * 60 : rawEndMinute;
    slices.push({
      entry,
      day: dayStart,
      start,
      end,
      row: 0,
      depth: 1,
      startMinute,
      endMinute,
      sizeMinutes: Math.max(0, endMinute - startMinute)
    });
    cursor = addDays(dayStart, 1);
    if (cursor > interval.end) {
      break;
    }
  }

  return slices;
}

export function buildDayDisplayLayout(
  entries: EntryInterval[],
  days: Date[],
  minimumMinutes: number
): Record<string, SessionDisplaySlice[]> {
  const byDay = Object.fromEntries(days.map((day) => [format(day, "yyyy-MM-dd"), [] as SessionDisplaySlice[]]));

  entries.forEach((entry) => {
    normalizeIntervals(entry).forEach((interval) => {
      splitIntervalAcrossDays(entry, interval).forEach((slice) => {
        const key = format(slice.day, "yyyy-MM-dd");
        if (byDay[key]) {
          byDay[key].push({
            ...slice,
            sizeMinutes: Math.max(slice.sizeMinutes, minimumMinutes)
          });
        }
      });
    });
  });

  Object.keys(byDay).forEach((key) => {
    const items = byDay[key] ?? [];
    items.sort((left, right) => {
      if (left.startMinute !== right.startMinute) {
        return left.startMinute - right.startMinute;
      }
      return left.endMinute - right.endMinute;
    });

    const rows: number[] = [];
    items.forEach((item) => {
      const rowIndex = rows.findIndex((rowEnd) => item.startMinute >= rowEnd);
      if (rowIndex === -1) {
        rows.push(item.startMinute + item.sizeMinutes);
        item.row = rows.length - 1;
      } else {
        rows[rowIndex] = item.startMinute + item.sizeMinutes;
        item.row = rowIndex;
      }
      item.depth = Math.max(rows.length, 1);
    });
  });

  return byDay;
}
