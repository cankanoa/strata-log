import type { NativeApi } from "@/lib/platform";
import { getFieldSelection, getMetadataFields } from "@/lib/metadata";
import { resolveEntryMetadata } from "@/lib/attribute-references";
import type { EntryInterval, FieldDefinition, FileHandleInfo, MetadataValue, TaskItem, TimeLogFile } from "@/lib/types";

type TaskSource = {
  id: string;
  kind: "markdown_glob";
  label: string;
  pattern: string;
};

function getMarkdownGlobPatterns(field: FieldDefinition, value: MetadataValue): string[] {
  const selection = getFieldSelection(field);

  if (selection === "multiselect") {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  }

  return typeof value === "string" && value.trim().length > 0 ? [value] : [];
}

export function isMarkdownPath(filePath: string): boolean {
  return /\.md$/i.test(filePath);
}

export function getTaskSources(file: TimeLogFile | null, entry: EntryInterval | undefined): TaskSource[] {
  if (!file || !entry) {
    return [];
  }

  const resolvedMetadata = resolveEntryMetadata(file, entry);
  const referenceFields = file.attributeReferenceGroups.flatMap((group) =>
    Object.entries(group.fields).filter(([, field]) => field.type === "markdown_glob")
  );

  return [...getMetadataFields(file.fields), ...referenceFields]
    .filter(([, field]) => field.type === "markdown_glob")
    .flatMap(([key, field]) =>
      getMarkdownGlobPatterns(field, resolvedMetadata[key]).map((pattern) => ({
        id: `markdown_glob:${key}:${pattern}`,
        kind: "markdown_glob" as const,
        label: key,
        pattern
      }))
    )
    .filter((source) => source.pattern.length > 0);
}

export async function loadTaskItems(
  api: NativeApi,
  file: TimeLogFile | null,
  fileHandle: FileHandleInfo | null,
  entry: EntryInterval | undefined
): Promise<TaskItem[]> {
  const baseDir = fileHandle?.path ? dirname(fileHandle.path) : undefined;
  const sources = getTaskSources(file, entry);
  const items = await Promise.all(
    sources.map(async (source) => {
      const matches = await api.listMarkdownFiles(source.pattern, baseDir);
      return matches
        .filter((taskPath) => isMarkdownPath(taskPath))
        .map((taskPath) => ({
          id: `${source.id}:${taskPath}`,
          kind: source.kind,
          title: basename(taskPath),
          path: taskPath,
          sourceLabel: source.label
        }));
    })
  );

  return items
    .flat()
    .filter((item, index, collection) => collection.findIndex((candidate) => candidate.path === item.path) === index)
    .sort((left, right) => left.title.localeCompare(right.title));
}
function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? normalized;
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  parts.pop();
  return parts.join("/") || ".";
}
