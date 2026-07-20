import { getActiveMetadataFields } from "@/lib/attribute-references";
import { githubRepositorySlugFromTask } from "@/lib/github-task-sources";
import type { TaskSourceChoiceGroup } from "@/lib/task-query";
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
  const sourcesById = new Map(file.taskSources.map((source) => [source.id, source]));
  return rows.filter((task) => {
    const source = sourcesById.get(task.sourceId);
    const sourceUrl = source?.url.trim() ?? "";
    const repository = source?.type === "Github" ? githubRepositorySlugFromTask(source, task) : undefined;
    return selectedUrls.has(sourceUrl) || Boolean(repository && selectedUrls.has(repository));
  });
}

export function filterTaskSourceChoiceGroupsBySourceUrls(
  groups: TaskSourceChoiceGroup[],
  selectedUrls: Set<string>
): TaskSourceChoiceGroup[] {
  if (selectedUrls.size === 0) {
    return groups;
  }

  return groups.flatMap((group) => {
    const choices = group.choices.filter((choice) => {
      const sourceUrl = choice.source.url.trim();
      const targetUrl = choice.targetUrl?.trim();
      return selectedUrls.has(sourceUrl) || Boolean(targetUrl && selectedUrls.has(targetUrl));
    });
    return choices.length > 0 ? [{ ...group, choices }] : [];
  });
}
