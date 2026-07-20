import { getActiveMetadataFields } from "@/lib/attribute-references";
import type { MetadataValue, SessionMetadata, TaskDisplayRow, TimeLogFile } from "@/lib/types";

function metadataStrings(value: MetadataValue): string[] {
  const values = Array.isArray(value) ? value : [value];
  return values
    .map((item) => String(item ?? "").trim())
    .filter((item) => item.length > 0);
}

export function getTrackTaskSourceFilterUrls(file: TimeLogFile, metadata: SessionMetadata): Set<string> {
  return Object.entries(getActiveMetadataFields(file, metadata)).reduce<Set<string>>((urls, [name, field]) => {
    if (field.type === "filter_task_sources") {
      metadataStrings(metadata[name]).forEach((url) => urls.add(url));
    }
    return urls;
  }, new Set());
}

export function filterTaskDisplayRowsBySourceUrls(
  file: TimeLogFile,
  rows: TaskDisplayRow[],
  selectedUrls: Set<string>
): TaskDisplayRow[] {
  const sourceUrlsById = new Map(file.taskSources.map((source) => [source.id, source.url.trim()]));
  return rows.filter((task) => selectedUrls.has(sourceUrlsById.get(task.sourceId) ?? ""));
}
