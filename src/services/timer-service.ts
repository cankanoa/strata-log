import { TimeLogDatabase } from "@/lib/time-log-database";
import type { EntryInterval, SessionMetadata, TimeInterval, TimeLogFile } from "@/lib/types";

function ensureIntervals(entry: EntryInterval): TimeInterval[] {
  return entry.intervals ?? [];
}

export const TimerService = {
  createEntry(input: Omit<EntryInterval, "id">): EntryInterval {
    return TimeLogDatabase.createEntry({
      ...input,
      type: input.type ?? "interval",
      intervals: ensureIntervals(input as EntryInterval)
    });
  },

  startLiveEntry(
    file: TimeLogFile,
    metadata: SessionMetadata,
    now: string,
    intervalMetadata = false
  ): TimeLogFile {
    return TimeLogDatabase.startLiveEntry(file, metadata, now, intervalMetadata);
  },

  stopLiveEntry(file: TimeLogFile, now: string): TimeLogFile {
    return TimeLogDatabase.stopLiveEntry(file, now);
  },

  updateEntry(file: TimeLogFile, entryId: string, next: EntryInterval): TimeLogFile {
    return TimeLogDatabase.updateEntry(file, entryId, next);
  },

  deleteEntry(file: TimeLogFile, entryId: string): TimeLogFile {
    return TimeLogDatabase.deleteEntry(file, entryId);
  }
};
