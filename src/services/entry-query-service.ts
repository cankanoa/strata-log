import type { EntryInterval, EntrySort, FieldDefinition, MetadataFilter, TimeLogFile } from "@/lib/types";
import { formatMetadataValue } from "@/lib/metadata";
import { formatMetadataFieldValueForFile, resolveEntryMetadata } from "@/lib/attribute-references";
import {
  buildDayDisplayLayout,
  getSessionBounds,
  monthGrid,
  netDurationMs,
  normalizeIntervals,
  weekdayRange
} from "@/lib/time";

export const EntryQueryService = {
  sortEntries(entries: EntryInterval[], sort: EntrySort, fields?: Record<string, FieldDefinition>, file?: TimeLogFile | null): EntryInterval[] {
    const sorted = [...entries].sort((a, b) => {
      const left = this.resolveSortValue(a, sort.key, fields, file);
      const right = this.resolveSortValue(b, sort.key, fields, file);
      if (left < right) {
        return -1;
      }
      if (left > right) {
        return 1;
      }
      return 0;
    });
    return sort.direction === "asc" ? sorted : sorted.reverse();
  },

  filterEntries(entries: EntryInterval[], filters: MetadataFilter[], fields?: Record<string, FieldDefinition>, file?: TimeLogFile | null): EntryInterval[] {
    return entries.filter((entry) =>
      filters.every((filter) => {
        const metadata = resolveEntryMetadata(
          file ?? (fields ? { version: 1, fields, attributeReferenceGroups: [], sessionPresets: [], taskSources: [], tasks: [], internalTaskColumns: {}, internalTasks: [], activeTasks: [], accounts: [], entries: [] } : undefined),
          entry
        );
        const value =
          filter.field === "status"
            ? (normalizeIntervals(entry).some((interval) => interval.end.getTime() > Date.now()) ? "running" : "stopped")
            : formatMetadataFieldValueForFile(file, fields?.[filter.field], metadata?.[filter.field]);
        return value.toLowerCase().includes(filter.value.toLowerCase());
      })
    );
  },

  weekIntervals(entries: EntryInterval[], anchorDate: Date, minimumMinutes = 15) {
    return buildDayDisplayLayout(entries, weekdayRange(anchorDate), minimumMinutes);
  },

  monthIntervals(entries: EntryInterval[], anchorDate: Date, minimumMinutes = 1) {
    return buildDayDisplayLayout(entries, monthGrid(anchorDate), minimumMinutes);
  },

  resolveSortValue(entry: EntryInterval, key: string, fields?: Record<string, FieldDefinition>, file?: TimeLogFile | null): string | number {
    const metadata = resolveEntryMetadata(
      file ?? (fields ? { version: 1, fields, attributeReferenceGroups: [], sessionPresets: [], taskSources: [], tasks: [], internalTaskColumns: {}, internalTasks: [], activeTasks: [], accounts: [], entries: [] } : undefined),
      entry
    );
    const bounds = getSessionBounds(entry);
    if (key === "start") {
      return bounds.start?.getTime() ?? Number.MIN_SAFE_INTEGER;
    }
    if (key === "end") {
      return bounds.end?.getTime() ?? Number.MAX_SAFE_INTEGER;
    }
    if (key === "duration") {
      return netDurationMs(entry);
    }
    return formatMetadataFieldValueForFile(file, fields?.[key], metadata?.[key]) || formatMetadataValue(metadata?.[key]);
  }
};
