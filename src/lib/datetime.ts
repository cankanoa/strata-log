import { format, getDaysInMonth } from "date-fns";
import { parseDate, toIsoWithOffset } from "@/lib/time";

export type DateTimePartKey = "year" | "month" | "day" | "hour" | "minute" | "second";

export type DateTimeParts = Record<DateTimePartKey, string>;

export const DATE_TIME_PART_ORDER: DateTimePartKey[] = ["year", "month", "day", "hour", "minute", "second"];

const PART_LENGTHS: Record<DateTimePartKey, number> = {
  year: 4,
  month: 2,
  day: 2,
  hour: 2,
  minute: 2,
  second: 2
};

const PART_RANGES: Record<Exclude<DateTimePartKey, "year">, [number, number]> = {
  month: [1, 12],
  day: [1, 31],
  hour: [0, 23],
  minute: [0, 59],
  second: [0, 59]
};

function padPart(key: DateTimePartKey, value: number): string {
  return String(value).padStart(PART_LENGTHS[key], "0");
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function parseDateTimeValue(value?: string): Date | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = parseDate(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

export function formatDateTimeValue(value?: string | Date): string {
  const resolved = typeof value === "string" ? parseDateTimeValue(value) : value;
  return resolved ? format(resolved, "yyyy-MM-dd HH:mm:ss") : "—";
}

export function createDateTimeParts(value?: string | Date): DateTimeParts {
  const resolved = typeof value === "string" ? parseDateTimeValue(value) : value;
  const date = resolved ?? new Date();

  return {
    year: padPart("year", date.getFullYear()),
    month: padPart("month", date.getMonth() + 1),
    day: padPart("day", date.getDate()),
    hour: padPart("hour", date.getHours()),
    minute: padPart("minute", date.getMinutes()),
    second: padPart("second", date.getSeconds())
  };
}

export function sanitizeDateTimePart(key: DateTimePartKey, raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, PART_LENGTHS[key]);
  return digits;
}

function getNormalizedNumericPart(key: Exclude<DateTimePartKey, "year">, raw: string): number {
  const [min, max] = PART_RANGES[key];
  const parsed = Number.parseInt(raw || String(min), 10);
  return clamp(Number.isNaN(parsed) ? min : parsed, min, max);
}

export function normalizeDateTimeParts(parts: DateTimeParts): DateTimeParts {
  const yearDigits = sanitizeDateTimePart("year", parts.year);
  const year = Number.parseInt(yearDigits || "0", 10) || new Date().getFullYear();
  const month = getNormalizedNumericPart("month", parts.month);
  const dayMax = getDaysInMonth(new Date(year, month - 1, 1));
  const day = clamp(Number.parseInt(parts.day || "1", 10) || 1, 1, dayMax);

  return {
    year: yearDigits || String(year),
    month: padPart("month", month),
    day: padPart("day", day),
    hour: padPart("hour", getNormalizedNumericPart("hour", parts.hour)),
    minute: padPart("minute", getNormalizedNumericPart("minute", parts.minute)),
    second: padPart("second", getNormalizedNumericPart("second", parts.second))
  };
}

export function buildDateTimeValue(parts: DateTimeParts): Date | undefined {
  const normalized = normalizeDateTimeParts(parts);
  if (normalized.year.length < 4) {
    return undefined;
  }

  const year = Number.parseInt(normalized.year, 10);
  const month = Number.parseInt(normalized.month, 10) - 1;
  const day = Number.parseInt(normalized.day, 10);
  const hour = Number.parseInt(normalized.hour, 10);
  const minute = Number.parseInt(normalized.minute, 10);
  const second = Number.parseInt(normalized.second, 10);

  const date = new Date(year, month, day, hour, minute, second, 0);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function serializeDateTimeParts(parts: DateTimeParts): string | undefined {
  const date = buildDateTimeValue(parts);
  return date ? toIsoWithOffset(date) : undefined;
}

export function getWheelStep(deltaY: number, elapsedMs?: number): number {
  const magnitude = Math.abs(deltaY);
  const base = magnitude > 240 ? 4 : magnitude > 120 ? 3 : magnitude > 45 ? 2 : 1;
  const accelerated = elapsedMs !== undefined && elapsedMs < 80 ? base + 1 : base;
  return Math.min(5, Math.max(1, accelerated));
}
