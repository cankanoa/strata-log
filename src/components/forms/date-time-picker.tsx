import { useEffect, useMemo, useRef, useState } from "react";
import { Clock3Icon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  createDateTimeParts,
  DATE_TIME_PART_ORDER,
  formatDateTimeValue,
  getWheelStep,
  normalizeDateTimeParts,
  sanitizeDateTimePart,
  serializeDateTimeParts,
  type DateTimePartKey,
  type DateTimeParts
} from "@/lib/datetime";

type DateTimePickerProps = {
  label: string;
  value?: string;
  onChange: (value?: string) => void;
  allowClear?: boolean;
  placeholder?: string;
  disabled?: boolean;
};

const PART_LABELS: Record<DateTimePartKey, string> = {
  year: "Year",
  month: "Month",
  day: "Day",
  hour: "Hour",
  minute: "Minute",
  second: "Second"
};

const PART_PLACEHOLDERS: Record<DateTimePartKey, string> = {
  year: "2026",
  month: "01",
  day: "01",
  hour: "00",
  minute: "00",
  second: "00"
};

function adjustPartValue(parts: DateTimeParts, key: Exclude<DateTimePartKey, "year"> | "year", direction: 1 | -1): DateTimeParts {
  const next = { ...parts };
  if (key === "year") {
    const current = Number.parseInt(next.year || String(new Date().getFullYear()), 10) || new Date().getFullYear();
    next.year = String(Math.max(0, current + direction)).padStart(4, "0");
    return normalizeDateTimeParts(next);
  }

  const raw = Number.parseInt(next[key] || "0", 10);
  const [min, max] = key === "month"
    ? [1, 12]
    : key === "day"
      ? [1, 31]
      : [0, 59];
  let nextValue = Number.isNaN(raw) ? min : raw + direction;
  if (nextValue > max) {
    nextValue = min;
  }
  if (nextValue < min) {
    nextValue = max;
  }
  next[key] = String(nextValue).padStart(2, "0");
  return normalizeDateTimeParts(next);
}

export function DateTimePicker({
  label,
  value,
  onChange,
  allowClear = false,
  placeholder = "Enter datetime",
  disabled = false
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DateTimeParts>(() => createDateTimeParts(value));
  const lastWheelAt = useRef<Record<DateTimePartKey, number>>({
    year: 0,
    month: 0,
    day: 0,
    hour: 0,
    minute: 0,
    second: 0
  });

  useEffect(() => {
    if (open) {
      setDraft(createDateTimeParts(value));
    }
  }, [open, value]);

  const formatted = useMemo(() => formatDateTimeValue(value), [value]);

  function commit(nextParts: DateTimeParts) {
    const serialized = serializeDateTimeParts(nextParts);
    if (serialized) {
      onChange(serialized);
    }
  }

  function updatePart(key: DateTimePartKey, raw: string) {
    if (disabled) {
      return;
    }
    const nextParts = normalizeDateTimeParts({
      ...draft,
      [key]: sanitizeDateTimePart(key, raw)
    });
    setDraft(nextParts);
    if (nextParts.year.length === 4) {
      commit(nextParts);
    }
  }

  function handleWheel(key: Exclude<DateTimePartKey, "year"> | "year", deltaY: number) {
    if (disabled) {
      return;
    }
    const direction: 1 | -1 = deltaY < 0 ? 1 : -1;
    const now = performance.now();
    const elapsedMs = now - lastWheelAt.current[key];
    lastWheelAt.current[key] = now;
    const step = getWheelStep(deltaY, elapsedMs);
    let nextParts = { ...draft };
    for (let index = 0; index < step; index += 1) {
      nextParts = adjustPartValue(nextParts, key, direction);
    }
    setDraft(nextParts);
    commit(nextParts);
  }

  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger render={<Button variant="outline" className="w-full justify-between" disabled={disabled} />}>
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value && formatted !== "—" ? formatted : placeholder}
          </span>
          <Clock3Icon className="size-4" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-4">
          <div className="grid gap-4">
            <div className="grid gap-2">
              <div className="grid grid-cols-6 overflow-hidden rounded-xl border border-border bg-background">
                {DATE_TIME_PART_ORDER.map((key) => (
                  <div
                    className={cn(
                      "grid gap-1 px-2 py-2",
                      key !== "second" && "border-r border-border",
                      key === "year" && "rounded-l-xl",
                      key === "second" && "rounded-r-xl"
                    )}
                    key={key}
                  >
                    <Label className="text-center text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                      {PART_LABELS[key]}
                    </Label>
                    <Input
                      value={draft[key]}
                      inputMode="numeric"
                      onChange={(event) => updatePart(key, event.target.value)}
                      onFocus={(event) => event.currentTarget.select()}
                      disabled={disabled}
                      onWheel={(event) => {
                        event.preventDefault();
                        handleWheel(key, event.deltaY);
                      }}
                      className="h-10 w-full border-0 bg-transparent px-0 text-center tabular-nums shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      placeholder={PART_PLACEHOLDERS[key]}
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="text-sm text-muted-foreground">{formatDateTimeValue(serializeDateTimeParts(draft) ?? value)}</div>
              <div className="flex gap-2">
                {allowClear ? (
                  <Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(undefined)}>
                    <RotateCcwIcon className="size-4" />
                    Clear
                  </Button>
                ) : null}
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={disabled}
                  onClick={() => {
                    const now = serializeDateTimeParts(createDateTimeParts(new Date()));
                    if (now) {
                      setDraft(createDateTimeParts(new Date()));
                      onChange(now);
                    }
                  }}
                >
                  Now
                </Button>
              </div>
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
