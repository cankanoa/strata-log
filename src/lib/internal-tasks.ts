import { v4 as uuidv4 } from "uuid";
import {
  applyMetadataDefaults,
  normalizeFieldDefinition,
} from "@/lib/metadata";
import type { FieldDefinition, SessionMetadata, TaskSource } from "@/lib/types";

export const INTERNAL_TASK_TITLE_COLUMN_NAME = "title";
export const INTERNAL_TASK_STATUS_COLUMN_NAME = "status";
export const INTERNAL_TASK_BODY_COLUMN_NAME = "body";

export const INTERNAL_TASK_TITLE_COLUMN: FieldDefinition = {
  id: "00000000-0000-4000-8000-000000000201",
  type: "string",
  selection: "single",
  required: true,
  visibility: "editable",
  default: null
};

export const INTERNAL_TASK_STATUS_COLUMN: FieldDefinition = {
  id: "00000000-0000-4000-8000-000000000202",
  type: "bool",
  selection: "single",
  required: true,
  visibility: "editable",
  default: true,
  options: ["Open", "Closed"]
};

export const INTERNAL_TASK_BODY_COLUMN: FieldDefinition = {
  id: "00000000-0000-4000-8000-000000000203",
  type: "markdown",
  selection: "single",
  required: false,
  visibility: "editable",
  default: null
};

function uniqueColumnNames(names: string[], validNames: Set<string>): string[] {
  const seen = new Set<string>();
  return [INTERNAL_TASK_TITLE_COLUMN_NAME, INTERNAL_TASK_STATUS_COLUMN_NAME, INTERNAL_TASK_BODY_COLUMN_NAME, ...names]
    .filter((name) => validNames.has(name))
    .filter((name) => {
      if (seen.has(name)) {
        return false;
      }
      seen.add(name);
      return true;
    });
}

export function normalizeInternalTaskColumn(field: FieldDefinition): FieldDefinition {
  return normalizeFieldDefinition({
    ...field,
    id: field.id ?? uuidv4(),
    interval: false,
    visibility: "editable"
  });
}

export function normalizeInternalTaskColumns(columns: Record<string, FieldDefinition>): Record<string, FieldDefinition> {
  const {
    [INTERNAL_TASK_TITLE_COLUMN_NAME]: titleField,
    [INTERNAL_TASK_STATUS_COLUMN_NAME]: statusField,
    [INTERNAL_TASK_BODY_COLUMN_NAME]: bodyField,
    task_source_id: _reserved,
    ...otherColumns
  } = columns;
  return {
    [INTERNAL_TASK_TITLE_COLUMN_NAME]: normalizeInternalTaskColumn({
      ...INTERNAL_TASK_TITLE_COLUMN,
      ...titleField,
      type: "string",
      selection: "single",
      required: true,
      options: undefined,
      default: null
    }),
    [INTERNAL_TASK_STATUS_COLUMN_NAME]: normalizeInternalTaskColumn({
      ...INTERNAL_TASK_STATUS_COLUMN,
      ...statusField,
      type: "bool",
      selection: "single",
      required: true,
      options: ["Open", "Closed"],
      default: true
    }),
    [INTERNAL_TASK_BODY_COLUMN_NAME]: normalizeInternalTaskColumn({
      ...INTERNAL_TASK_BODY_COLUMN,
      ...bodyField,
      type: "markdown",
      selection: "single",
      required: false,
      options: undefined,
      default: null
    }),
    ...Object.fromEntries(
      Object.entries(otherColumns).map(([name, field]) => [name, normalizeInternalTaskColumn(field)])
    )
  };
}

export function normalizeInternalTaskSources(
  sources: TaskSource[],
  columns: Record<string, FieldDefinition>
): TaskSource[] {
  const validNames = new Set(Object.keys(columns));
  return sources.map((source) => {
    if (source.type !== "Internal Task") {
      return {
        ...source,
        columnNames: undefined,
        repositoryUrls: source.type === "Github" ? source.repositoryUrls : undefined
      };
    }
    return {
      ...source,
      url: source.url || `internal-task:${source.id}`,
      columnNames: uniqueColumnNames(source.columnNames ?? [], validNames),
      repositoryUrls: undefined
    };
  });
}

export function sanitizeInternalTaskValues(
  values: SessionMetadata,
  columns: Record<string, FieldDefinition>,
  allowedColumnNames: string[]
): SessionMetadata {
  const fields: Record<string, FieldDefinition> = {};
  allowedColumnNames.forEach((name) => {
    const field = columns[name];
    if (field) {
      fields[name] = field;
    }
  });
  return applyMetadataDefaults(fields, values);
}
