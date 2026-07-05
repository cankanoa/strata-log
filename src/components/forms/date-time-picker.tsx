import { format } from "date-fns";
import { CalendarIcon, RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger
} from "@/components/ui/popover";
import { formatDateTimeValue, parseDateTimeValue } from "@/lib/datetime";
import { toIsoWithOffset } from "@/lib/time";
import { cn } from "@/lib/utils";

type DateTimePickerProps = {
  label: string;
  value?: string;
  onChange: (value?: string) => void;
  allowClear?: boolean;
  placeholder?: string;
  disabled?: boolean;
};

function timeValue(date?: Date): string {
  return date ? format(date, "HH:mm:ss") : "00:00:00";
}

function applyTime(date: Date, value: string): Date {
  const [hours = "0", minutes = "0", seconds = "0"] = value.split(":");
  const next = new Date(date);
  next.setHours(Number(hours) || 0, Number(minutes) || 0, Number(seconds) || 0, 0);
  return next;
}

function commitDate(date: Date, onChange: DateTimePickerProps["onChange"]) {
  onChange(toIsoWithOffset(date));
}

export function DateTimePicker({
  label,
  value,
  onChange,
  allowClear = false,
  placeholder = "Pick a date and time",
  disabled = false
}: DateTimePickerProps) {
  const selectedDate = parseDateTimeValue(value);

  function handleDateSelect(date?: Date) {
    if (!date || disabled) {
      return;
    }
    commitDate(applyTime(date, timeValue(selectedDate)), onChange);
  }

  function handleTimeChange(nextTime: string) {
    if (disabled) {
      return;
    }
    commitDate(applyTime(selectedDate ?? new Date(), nextTime), onChange);
  }

  function handleNow() {
    if (!disabled) {
      commitDate(new Date(), onChange);
    }
  }

  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      <Popover>
        <PopoverTrigger render={<Button variant="outline" className="w-full justify-between" disabled={disabled} />}>
          <span className={cn("truncate", !selectedDate && "text-muted-foreground")}>
            {selectedDate ? formatDateTimeValue(selectedDate) : placeholder}
          </span>
          <CalendarIcon className="size-4 opacity-70" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={handleDateSelect}
            captionLayout="dropdown"
            disabled={disabled}
          />
          <div className="flex items-end gap-2 border-t p-3">
            <div className="grid flex-1 gap-2">
              <Label>Time</Label>
              <Input
                type="time"
                step="1"
                value={timeValue(selectedDate)}
                disabled={disabled}
                onChange={(event) => handleTimeChange(event.target.value)}
              />
            </div>
            {allowClear ? (
              <Button type="button" variant="ghost" size="icon" disabled={disabled} onClick={() => onChange(undefined)}>
                <RotateCcwIcon className="size-4" />
                <span className="sr-only">Clear</span>
              </Button>
            ) : null}
            <Button type="button" variant="secondary" disabled={disabled} onClick={handleNow}>
              Now
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
