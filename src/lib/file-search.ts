import type { NativeApi } from "@/lib/platform";
import { getFieldSelection, getMetadataFields } from "@/lib/metadata";
import { resolveEntryMetadata } from "@/lib/attribute-references";
import type { EntryInterval, FieldDefinition, FileHandleInfo, MetadataValue, TimeLogFile } from "@/lib/types";

export type FileSearchNode = {
  id: string;
  kind: "field" | "pattern" | "directory" | "file";
  name: string;
  path?: string;
  children?: FileSearchNode[];
};

type FileSearchSource = {
  fieldName: string;
  patterns: string[];
};

function selectedPatterns(field: FieldDefinition, value: MetadataValue): string[] {
  if (getFieldSelection(field) === "multiselect") {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : [];
  }
  return typeof value === "string" && value.trim().length > 0 ? [value] : [];
}

function getFileSearchSources(file: TimeLogFile | null, entry: EntryInterval | undefined): FileSearchSource[] {
  if (!file || !entry) {
    return [];
  }

  const resolvedMetadata = resolveEntryMetadata(file, entry);
  const referenceFields = file.attributeReferenceGroups.flatMap((group) =>
    Object.entries(group.fields).filter(([, field]) => field.type === "file_search")
  );
  return [...getMetadataFields(file.fields), ...referenceFields]
    .filter(([, field]) => field.type === "file_search")
    .map(([fieldName, field]) => ({
      fieldName,
      patterns: selectedPatterns(field, resolvedMetadata[fieldName])
    }))
    .filter((source) => source.patterns.length > 0);
}

function dirname(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  parts.pop();
  return parts.join("/") || ".";
}

function basename(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized.split("/").pop() ?? normalized;
}

function pathSegments(filePath: string): string[] {
  return filePath.replace(/\\/g, "/").split("/").filter(Boolean);
}

function commonParent(paths: string[]): string {
  if (paths.length === 0) {
    return "";
  }
  const splitPaths = paths.map((path) => pathSegments(dirname(path)));
  const first = splitPaths[0] ?? [];
  const common = first.filter((part, index) => splitPaths.every((segments) => segments[index] === part));
  return `${paths[0]?.startsWith("/") ? "/" : ""}${common.join("/")}`.replace(/\/$/, "");
}

function relativePath(filePath: string, root: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
  return normalizedRoot && normalized.startsWith(`${normalizedRoot}/`)
    ? normalized.slice(normalizedRoot.length + 1)
    : basename(normalized);
}

function insertFile(root: FileSearchNode, filePath: string, displayPath: string) {
  const parts = pathSegments(displayPath);
  let node = root;
  parts.forEach((part, index) => {
    const leaf = index === parts.length - 1;
    const kind = leaf ? "file" : "directory";
    node.children ??= [];
    let child = node.children.find((candidate) => candidate.name === part && candidate.kind === kind);
    if (!child) {
      const id = `${node.id}:${part}`;
      child = {
        id,
        kind,
        name: part,
        path: leaf ? filePath : undefined,
        children: leaf ? undefined : []
      };
      node.children.push(child);
    }
    node = child;
  });
}

function sortTree(node: FileSearchNode): FileSearchNode {
  return {
    ...node,
    children: node.children
      ?.map(sortTree)
      .sort((left, right) => {
        if (left.kind === "directory" && right.kind !== "directory") {
          return -1;
        }
        if (left.kind !== "directory" && right.kind === "directory") {
          return 1;
        }
        return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" });
      })
  };
}

function buildPatternNode(fieldName: string, pattern: string, matches: string[], baseDir?: string): FileSearchNode {
  const root = matches.every((match) => baseDir && match.replace(/\\/g, "/").startsWith(baseDir.replace(/\\/g, "/")))
    ? baseDir
    : commonParent(matches);
  const node: FileSearchNode = {
    id: `file_search:${fieldName}:${pattern}`,
    kind: "pattern",
    name: pattern,
    children: []
  };
  matches.forEach((filePath) => insertFile(node, filePath, relativePath(filePath, root || dirname(filePath))));
  return sortTree(node);
}

function hasFiles(node: FileSearchNode): boolean {
  return node.kind === "file" || Boolean(node.children?.some(hasFiles));
}

export async function loadFileSearchTree(
  api: NativeApi,
  file: TimeLogFile | null,
  fileHandle: FileHandleInfo | null,
  entry: EntryInterval | undefined
): Promise<FileSearchNode[]> {
  const baseDir = fileHandle?.path ? dirname(fileHandle.path) : undefined;
  const fields = await Promise.all(
    getFileSearchSources(file, entry).map(async (source) => {
      const patterns = await Promise.all(
        source.patterns.map(async (pattern) =>
          buildPatternNode(source.fieldName, pattern, await api.listFiles(pattern, baseDir), baseDir)
        )
      );
      return {
        id: `file_search:${source.fieldName}`,
        kind: "field" as const,
        name: source.fieldName,
        children: patterns.filter(hasFiles)
      };
    })
  );
  return fields.filter(hasFiles);
}
