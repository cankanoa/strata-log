import { format } from "date-fns";
import { parseDate } from "@/lib/time";

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
