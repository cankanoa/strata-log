import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";

const presets = [1, 5, 15, 30];
const soundLabels = {
  none: "None",
  chime: "Chime",
  bell: "Bell",
  gentle: "Gentle"
} as const;
const vibrationLabels = {
  none: "None",
  short: "Short",
  pulse: "Pulse"
} as const;

function formatRemaining(totalSeconds: number) {
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

export function FocusPage() {
  const {
    focusMode,
    focusSound,
    focusVibration,
    focusSelectedMinutes,
    focusCustomSelected,
    focusCustomMinutes,
    focusDurationSeconds,
    focusEndsAt,
    setFocusMode,
    setFocusSound,
    setFocusVibration,
    setFocusSelectedMinutes,
    setFocusCustomMinutes,
    startFocusTimer,
    pauseFocusTimer,
    resetFocusTimer
  } = useAppStore(
    useShallow((state) => ({
      focusMode: state.focusMode,
      focusSound: state.focusSound,
      focusVibration: state.focusVibration,
      focusSelectedMinutes: state.focusSelectedMinutes,
      focusCustomSelected: state.focusCustomSelected,
      focusCustomMinutes: state.focusCustomMinutes,
      focusDurationSeconds: state.focusDurationSeconds,
      focusEndsAt: state.focusEndsAt,
      setFocusMode: state.setFocusMode,
      setFocusSound: state.setFocusSound,
      setFocusVibration: state.setFocusVibration,
      setFocusSelectedMinutes: state.setFocusSelectedMinutes,
      setFocusCustomMinutes: state.setFocusCustomMinutes,
      startFocusTimer: state.startFocusTimer,
      pauseFocusTimer: state.pauseFocusTimer,
      resetFocusTimer: state.resetFocusTimer
    }))
  );
  const [, setTick] = useState(0);

  const isRunning = Boolean(focusEndsAt);

  const remainingSeconds = focusEndsAt
    ? Math.max(0, Math.ceil((focusEndsAt - Date.now()) / 1000))
    : focusDurationSeconds;

  function handleCustomMinutesChange(value: string) {
    const numeric = value.replace(/\D+/g, "");
    setFocusCustomMinutes(numeric);
  }

  useEffect(() => {
    if (!focusEndsAt) {
      return;
    }

    const interval = window.setInterval(() => setTick((value) => value + 1), 1000);
    return () => window.clearInterval(interval);
  }, [focusEndsAt]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 p-5 xl:p-7">
      <Card className="border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <CardTitle>Focus</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => {
                resetFocusTimer();
              }}
            >
              Reset
            </Button>
            {isRunning ? (
              <Button
                onClick={() => {
                  pauseFocusTimer();
                }}
              >
                Pause
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => {
                  startFocusTimer();
                }}
              >
                Start
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="flex items-center gap-4">
            <div className="text-5xl font-semibold tracking-tight md:text-6xl">
              {formatRemaining(remainingSeconds)}
            </div>
            <div className="flex items-center rounded-full border border-border bg-background px-4 py-2 text-sm font-medium text-muted-foreground">
              {focusMode === "focus" ? "Focus" : "Break"}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`inline-flex h-8 items-center justify-center rounded-lg border px-3 text-sm ${!focusCustomSelected && focusSelectedMinutes === preset ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"}`}
                onClick={() => {
                  setFocusSelectedMinutes(preset);
                }}
              >
                {preset}
              </button>
            ))}
            <input
              className={`h-8 w-24 rounded-lg border px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/30 ${focusCustomSelected ? "border-primary bg-primary text-primary-foreground placeholder:text-primary-foreground/70" : "border-border bg-background"}`}
              value={focusCustomMinutes}
              placeholder="Custom"
              inputMode="numeric"
              pattern="[0-9]*"
              onFocus={() => setFocusCustomMinutes(focusCustomMinutes)}
              onChange={(event) => handleCustomMinutesChange(event.target.value)}
            />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="grid gap-2">
              <label className="text-sm font-medium">Complete Alert Sound</label>
              <Select value={focusSound} onValueChange={(value) => value && setFocusSound(value as typeof focusSound)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{soundLabels[focusSound]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{soundLabels.none}</SelectItem>
                  <SelectItem value="chime">{soundLabels.chime}</SelectItem>
                  <SelectItem value="bell">{soundLabels.bell}</SelectItem>
                  <SelectItem value="gentle">{soundLabels.gentle}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <label className="text-sm font-medium">Vibrate</label>
              <Select value={focusVibration} onValueChange={(value) => value && setFocusVibration(value as typeof focusVibration)}>
                <SelectTrigger className="w-full">
                  <SelectValue>{vibrationLabels[focusVibration]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{vibrationLabels.none}</SelectItem>
                  <SelectItem value="short">{vibrationLabels.short}</SelectItem>
                  <SelectItem value="pulse">{vibrationLabels.pulse}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2">
            <Button variant={focusMode === "focus" ? "default" : "outline"} onClick={() => setFocusMode("focus")}>
              Focus
            </Button>
            <Button variant={focusMode === "break" ? "default" : "outline"} onClick={() => setFocusMode("break")}>
              Break
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
