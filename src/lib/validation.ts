import { z } from "zod";
import { validate as isUuid } from "uuid";
import {
  ensureBuiltinFields,
  getFieldDefaultValue,
  getIntervalMetadataFieldDefinitions,
  getFieldSelection,
  normalizeFieldVisibility,
  getFieldOptions,
  getSessionMetadataFields,
  getSessionMetadataFieldDefinitions,
  getMetadataFields,
  hasMetadataValue,
  internalTaskColumnTypeOptions,
  isBuiltinField,
  metadataValueMatchesOption,
} from "@/lib/metadata";
import { parseDate } from "@/lib/time";
import {
  getActiveMetadataFields,
  getResolvedMetadataFields,
  getSelectableFieldOptions,
  resolveAttributeReferenceMetadata
} from "@/lib/attribute-references";
import {
  INTERNAL_TASK_BODY_COLUMN_NAME,
  INTERNAL_TASK_TITLE_COLUMN_NAME,
  normalizeInternalTaskColumns,
  normalizeInternalTaskSources
} from "@/lib/internal-tasks";
import { defaultGeneralSettings } from "@/lib/defaults";
import type { ActiveTaskReference, AttributeReferenceGroup, EntryInterval, FieldDefinition, GeneralSettings, InternalTaskRow, MetadataValue, OnlineAccount, SessionMetadata, SessionPreset, TaskFieldMetadata, TaskRow, TaskSource, TimeInterval, TimeLogFile } from "@/lib/types";

const fieldTypeSchema = z.enum([
  "uuid",
  "string",
  "markdown",
  "path",
  "file_search",
  "filter_task_sources",
  "attribute_reference",
  "datetime",
  "bool",
  "int",
  "float"
]);

const fieldSelectionSchema = z.enum(["single", "select", "multiselect"]).optional();
const fieldVisibilitySchema = z.enum(["editable", "viewable", "hidden", "addable"]);

const metadataValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  z.array(z.union([z.boolean(), z.number(), z.string()])),
  z.undefined()
]);

const fieldDefinitionSchema: z.ZodType<FieldDefinition> = z.object({
  id: z.string().uuid().optional(),
  type: fieldTypeSchema,
  selection: fieldSelectionSchema,
  options: z.array(z.string().min(1)).optional(),
  required: z.boolean().optional(),
  visibility: fieldVisibilitySchema,
  interval: z.boolean().optional(),
  default: metadataValueSchema.nullable().optional()
});

const intervalSchema: z.ZodType<TimeInterval> = z.object({
  id: z.string().uuid().optional(),
  start: z.string().optional(),
  end: z.string().optional(),
  metadata: z.record(metadataValueSchema).optional()
});

const entrySchema: z.ZodType<EntryInterval> = z.object({
  id: z.string().uuid(),
  type: z.string().optional(),
  intervals: z.array(intervalSchema).optional(),
  metadata: z.record(metadataValueSchema).optional()
});

const sessionPresetSchema: z.ZodType<SessionPreset> = z.object({
  id: z.string().uuid(),
  name: z.string(),
  metadata: z.record(metadataValueSchema)
});

const taskSourceSchema: z.ZodType<TaskSource> = z.object({
  id: z.string().uuid(),
  type: z.enum(["Markdown", "Github", "Internal Task"]),
  url: z.string(),
  name: z.string().optional(),
  accountId: z.string().uuid().optional(),
  columnNames: z.array(z.string()).optional(),
  repositoryUrls: z.array(z.string()).optional(),
  lastUpdatedAt: z.string().optional()
});

const taskRowSchema: z.ZodType<TaskRow> = z.object({
  id: z.string().uuid(),
  sourceId: z.string().uuid(),
  parentUrl: z.string().optional(),
  type: z.enum(["Markdown", "Github", "Internal Task"]),
  url: z.string(),
  contents: z.string(),
  status: z.boolean().optional(),
  rank: z.string(),
  hash: z.string().optional(),
  byteLength: z.number().int().nonnegative().optional(),
  updatedAt: z.string().optional(),
  data: z.record(z.unknown())
});

const onlineAccountSchema: z.ZodType<OnlineAccount> = z.object({
  id: z.string().uuid(),
  type: z.enum(["Github"]),
  name: z.string(),
  username: z.string().optional(),
  token: z.string().optional()
});

const internalTaskRowSchema: z.ZodType<InternalTaskRow> = z.object({
  id: z.string().uuid(),
  taskSourceId: z.string().uuid(),
  values: z.record(metadataValueSchema)
});

const activeTaskReferenceSchema: z.ZodType<ActiveTaskReference> = z.object({
  taskId: z.string().uuid(),
  table: z.enum(["tasks", "tasks_internal"])
});

const taskFieldMetadataSchema: z.ZodType<TaskFieldMetadata> = z.object({
  sourceId: z.string().uuid().optional(),
  path: z.string(),
  label: z.string(),
  type: z.enum(["string", "markdown", "number", "bool", "datetime", "select", "multiselect"]),
  editable: z.boolean(),
  options: z.array(z.string()).optional(),
  fieldId: z.union([z.string(), z.number()]).optional(),
  updateKind: z.enum(["github_issue", "github_issue_field", "markdown_field"]).optional()
});

const generalSettingsSchema: z.ZodType<GeneralSettings> = z.object({
  refreshRateSeconds: z.number().min(0),
  taskFieldMetadata: z.record(z.array(taskFieldMetadataSchema))
});

const timeLogSchema: z.ZodType<TimeLogFile> = z.object({
  version: z.literal(1),
  fields: z.record(fieldDefinitionSchema),
  attributeReferenceGroups: z.array(z.object({
    label: z.string(),
    fields: z.record(fieldDefinitionSchema)
  })),
  sessionPresets: z.array(sessionPresetSchema),
  taskSources: z.array(taskSourceSchema),
  tasks: z.array(taskRowSchema),
  internalTaskColumns: z.record(fieldDefinitionSchema),
  internalTasks: z.array(internalTaskRowSchema),
  activeTasks: z.array(activeTaskReferenceSchema),
  accounts: z.array(onlineAccountSchema),
  entries: z.array(entrySchema),
  settings: generalSettingsSchema.optional()
});

function validateFieldValue(name: string, field: FieldDefinition, value: MetadataValue | null | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  const selection = getFieldSelection(field);
  if (selection === "select") {
    const options = getFieldOptions(field);
    if (options.length === 0) {
      return null;
    }
    return options.some((option) => metadataValueMatchesOption(field, value, option))
      ? null
      : `"${value}" is not a valid option for "${name}".`;
  }
  if (selection === "multiselect") {
    if (!Array.isArray(value)) {
      return `"${name}" must be a list of options.`;
    }
    const options = getFieldOptions(field);
    if (options.length === 0) {
      return null;
    }
    return value.every((item) => options.some((option) => metadataValueMatchesOption(field, item, option)))
      ? null
      : `One or more values are not valid for "${name}".`;
  }

  switch (field.type) {
    case "uuid":
      return typeof value === "string" && isUuid(value) ? null : `"${name}" must be a UUID.`;
    case "bool":
      return typeof value === "boolean" ? null : `"${name}" must be a boolean.`;
    case "int":
      return typeof value === "number" && Number.isInteger(value) ? null : `"${name}" must be an integer.`;
    case "float":
      return typeof value === "number" ? null : `"${name}" must be a number.`;
    case "string":
    case "markdown":
    case "path":
    case "file_search":
    case "filter_task_sources":
      return typeof value === "string" ? null : `"${name}" must be a string.`;
    case "attribute_reference":
      return typeof value === "string" ? null : `"${name}" must reference an attribute option.`;
    case "datetime": {
      if (typeof value !== "string") {
        return `"${name}" must be a datetime string.`;
      }
      const parsed = parseDate(value);
      return Number.isNaN(parsed.getTime()) ? `"${name}" must be a valid datetime.` : null;
    }
    default:
      return null;
  }
}

export function validateFieldDefinitions(fields: Record<string, FieldDefinition>): string[] {
  const nextFields = ensureBuiltinFields(fields);
  const errors: string[] = [];

  Object.entries(nextFields).forEach(([key, field]) => {
    const parsed = fieldDefinitionSchema.safeParse(field);
    if (!parsed.success) {
      errors.push(`Field "${key}" is invalid.`);
      return;
    }
    if (field.type === "bool" && getFieldSelection(field) !== "single") {
      errors.push(`Field "${key}" must use single selection value.`);
    }
    if (field.type === "markdown" && getFieldSelection(field) !== "single") {
      errors.push(`Field "${key}" must use single selection value.`);
    }
    if (field.type === "attribute_reference" && !["select", "multiselect"].includes(getFieldSelection(field))) {
      errors.push(`Field "${key}" must use select or multiselect selection value.`);
    }
    if (field.type === "filter_task_sources" && !["select", "multiselect"].includes(getFieldSelection(field))) {
      errors.push(`Field "${key}" must use select or multiselect selection value.`);
    }
    if (
      !isBuiltinField(key) &&
      field.required &&
      !["editable", "addable"].includes(normalizeFieldVisibility(field)) &&
      !hasMetadataValue(getFieldDefaultValue(field))
    ) {
      errors.push(`Field "${key}" is not editable and must define a default value.`);
    }
    if (field.default !== undefined && field.default !== null) {
      const defaultError = validateFieldValue(`${key} default`, field, field.default);
      if (defaultError) {
        errors.push(defaultError);
      }
    }
  });

  const requiredBuiltins: Array<[string, FieldDefinition["type"]]> = [
    ["id", "uuid"],
    ["type", "string"],
    ["start_time", "datetime"],
    ["end_time", "datetime"],
    ["session_id", "uuid"]
  ];

  requiredBuiltins.forEach(([key, type]) => {
    if (nextFields[key]?.type !== type) {
      errors.push(`Field "${key}" must be type "${type}".`);
    }
    if (getFieldSelection(nextFields[key]) !== "single") {
      errors.push(`Field "${key}" must use single selection value.`);
    }
  });

  getMetadataFields(nextFields).forEach(([key]) => {
    if (isBuiltinField(key)) {
      errors.push(`"${key}" is reserved.`);
    }
  });

  return errors;
}

function validateAttributeReferenceGroups(
  fields: Record<string, FieldDefinition>,
  groups: AttributeReferenceGroup[]
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const byFieldName = new Map<string, FieldDefinition>();
  const regularFieldNames = new Set(getMetadataFields(fields).map(([key]) => key));

  groups.forEach((group) => {
    if (seen.has(group.label)) {
      errors.push(`Attribute reference "${group.label}" is duplicated.`);
      return;
    }
    seen.add(group.label);

    Object.entries(group.fields).forEach(([key, field]) => {
      if (isBuiltinField(key)) {
        errors.push(`"${key}" is reserved.`);
      }
      if (regularFieldNames.has(key)) {
        errors.push(`Attribute reference field "${key}" conflicts with a regular metadata field.`);
      }
      const parsed = fieldDefinitionSchema.safeParse(field);
      if (!parsed.success) {
        errors.push(`Attribute reference field "${group.label}.${key}" is invalid.`);
        return;
      }
      if (field.type === "bool" && getFieldSelection(field) !== "single") {
        errors.push(`Attribute reference field "${group.label}.${key}" must use single selection value.`);
      }
      if (field.type === "markdown" && getFieldSelection(field) !== "single") {
        errors.push(`Attribute reference field "${group.label}.${key}" must use single selection value.`);
      }
      if (field.type === "attribute_reference" && !["select", "multiselect"].includes(getFieldSelection(field))) {
        errors.push(`Attribute reference field "${group.label}.${key}" must use select or multiselect selection value.`);
      }
      if (field.type === "filter_task_sources" && !["select", "multiselect"].includes(getFieldSelection(field))) {
        errors.push(`Attribute reference field "${group.label}.${key}" must use select or multiselect selection value.`);
      }
      if (field.default !== undefined && field.default !== null) {
        const defaultError = validateFieldValue(`${group.label}.${key} default`, field, field.default);
        if (defaultError) {
          errors.push(defaultError);
        }
      }
      if (field.type === "attribute_reference") {
        errors.push(`Attribute reference field "${group.label}.${key}" cannot itself be type "attribute_reference".`);
      }
      if (
        field.required &&
        !["editable", "addable"].includes(normalizeFieldVisibility(field)) &&
        !hasMetadataValue(getFieldDefaultValue(field))
      ) {
        errors.push(`Attribute reference field "${group.label}.${key}" is not editable and must define a value.`);
      }
      const existing = byFieldName.get(key);
      if (existing) {
        const left = JSON.stringify({ ...existing, default: undefined, id: undefined });
        const right = JSON.stringify({ ...field, default: undefined, id: undefined });
        if (left !== right) {
          errors.push(`Attribute reference field "${key}" must use the same definition across groups.`);
        }
      } else {
        byFieldName.set(key, field);
      }
    });
  });

  return errors;
}

function validateInternalTaskColumns(columns: Record<string, FieldDefinition>): string[] {
  const errors: string[] = [];
  const title = columns[INTERNAL_TASK_TITLE_COLUMN_NAME];
  const body = columns[INTERNAL_TASK_BODY_COLUMN_NAME];
  if (!title) {
    errors.push(`Internal task column "${INTERNAL_TASK_TITLE_COLUMN_NAME}" is required.`);
  } else {
    if (title.type !== "string") {
      errors.push(`Internal task column "${INTERNAL_TASK_TITLE_COLUMN_NAME}" must use string type.`);
    }
    if (getFieldSelection(title) !== "single") {
      errors.push(`Internal task column "${INTERNAL_TASK_TITLE_COLUMN_NAME}" must use single selection value.`);
    }
    if (!title.required) {
      errors.push(`Internal task column "${INTERNAL_TASK_TITLE_COLUMN_NAME}" must be required.`);
    }
  }
  if (!body) {
    errors.push(`Internal task column "${INTERNAL_TASK_BODY_COLUMN_NAME}" is required.`);
  } else {
    if (body.type !== "markdown") {
      errors.push(`Internal task column "${INTERNAL_TASK_BODY_COLUMN_NAME}" must use markdown type.`);
    }
    if (getFieldSelection(body) !== "single") {
      errors.push(`Internal task column "${INTERNAL_TASK_BODY_COLUMN_NAME}" must use single selection value.`);
    }
  }

  return [
    ...errors,
    ...Object.entries(columns).flatMap(([key, field]) => {
    const errors: string[] = [];
    const parsed = fieldDefinitionSchema.safeParse(field);
    if (!parsed.success) {
      return [`Internal task column "${key}" is invalid.`];
    }
    if (key === "task_source_id") {
      errors.push(`"task_source_id" is reserved for internal task rows.`);
    }
    if (!internalTaskColumnTypeOptions.includes(field.type)) {
      errors.push(`Internal task column "${key}" must use a basic type.`);
    }
    if (field.type === "bool" && getFieldSelection(field) !== "single") {
      errors.push(`Internal task column "${key}" must use single selection value.`);
    }
    if (field.type === "markdown" && getFieldSelection(field) !== "single") {
      errors.push(`Internal task column "${key}" must use single selection value.`);
    }
    if (field.default !== undefined && field.default !== null) {
      const defaultError = validateFieldValue(`${key} default`, field, field.default);
      if (defaultError) {
        errors.push(defaultError);
      }
    }
    return errors;
    })
  ];
}

function validateTaskSources(file: TimeLogFile): string[] {
  const errors: string[] = [];
  const columnNames = new Set(Object.keys(file.internalTaskColumns));
  file.taskSources.forEach((source) => {
    if (source.type !== "Internal Task") {
      return;
    }
    (source.columnNames ?? []).forEach((columnName) => {
      if (!columnNames.has(columnName)) {
        errors.push(`Task source "${source.name || source.url}" references unknown internal task column "${columnName}".`);
      }
    });
  });
  return errors;
}

function validateInternalTasks(file: TimeLogFile): string[] {
  const sources = new Map(file.taskSources.map((source) => [source.id, source]));
  return file.internalTasks.flatMap((task) => {
    const errors: string[] = [];
    const source = sources.get(task.taskSourceId);
    if (!source || source.type !== "Internal Task") {
      errors.push(`Internal task "${task.id}" references an unknown internal task source.`);
      return errors;
    }

    const allowedColumns = new Set(source.columnNames ?? []);
    Object.entries(task.values).forEach(([key, value]) => {
      const field = file.internalTaskColumns[key];
      if (!field) {
        errors.push(`Internal task "${task.id}" uses unknown column "${key}".`);
        return;
      }
      if (!allowedColumns.has(key)) {
        errors.push(`Internal task "${task.id}" uses column "${key}" outside its task source.`);
        return;
      }
      const valueError = validateFieldValue(key, field, value);
      if (valueError) {
        errors.push(valueError);
      }
    });

    allowedColumns.forEach((key) => {
      const field = file.internalTaskColumns[key];
      if (field?.required && !hasMetadataValue(task.values[key] ?? field.default ?? undefined)) {
        errors.push(`Internal task "${task.id}" requires "${key}".`);
      }
    });
    return errors;
  });
}

function normalizeActiveTasks(file: TimeLogFile): ActiveTaskReference[] {
  const importedTaskIds = new Set(file.tasks.map((task) => task.id));
  const seen = new Set<string>();
  return file.activeTasks.filter((reference) => {
    const valid = reference.table === "tasks" && importedTaskIds.has(reference.taskId);
    const key = `${reference.table}:${reference.taskId}`;
    if (!valid || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function validateMetadataPayload(
  fields: Record<string, FieldDefinition>,
  metadata: SessionMetadata | undefined,
  file?: TimeLogFile
): string[] {
  const source = metadata ?? {};
  const availableFieldSource = file ? getResolvedMetadataFields(file) : fields;
  const requestedFieldNames = new Set(Object.keys(fields));
  const availableFields = Object.fromEntries(
    Object.entries(availableFieldSource).filter(([key]) => requestedFieldNames.has(key))
  );
  const activeFieldSource = file ? getActiveMetadataFields(file, source) : availableFields;
  const activeFields = Object.fromEntries(
    Object.entries(activeFieldSource).filter(([key]) => requestedFieldNames.has(key))
  );
  const errors = Object.entries(source).flatMap(([key, value]) => {
    const field = availableFields[key];
    if (!field || isBuiltinField(key)) {
      return [`Metadata field "${key}" is not defined in this file.`];
    }
    if (field.type === "attribute_reference" || field.type === "filter_task_sources") {
      const options = getSelectableFieldOptions(field, file);
      if (options.length === 0) {
        const valueError = validateFieldValue(key, field, value);
        return valueError ? [valueError] : [];
      }
      const values = getFieldSelection(field) === "multiselect"
        ? (Array.isArray(value) ? value : [])
        : [value];
      return values.every((item) => typeof item === "string" && options.some((option) => option.value === item))
        ? []
        : [`"${key}" contains an invalid option.`];
    }
    const valueError = validateFieldValue(key, field, value);
    return valueError ? [valueError] : [];
  });

  const resolved = resolveAttributeReferenceMetadata(file, source);

  const requiredErrors = getSessionMetadataFields(activeFields).flatMap(([key, field]) => {
    if (!field.required) {
      return [];
    }
    return hasMetadataValue(resolved[key]) ? [] : [`Metadata field "${key}" is required.`];
  });

  return [...errors, ...requiredErrors];
}

function validateIntervals(entry: EntryInterval): string[] {
  const errors: string[] = [];
  const intervals = entry.intervals ?? [];
  intervals.forEach((interval, index) => {
    const isRunningTail = entry.type === "running" && index === intervals.length - 1;
    if (!interval.id || !isUuid(interval.id)) {
      errors.push(`Interval ${index + 1} requires a valid UUID id.`);
    }
    if (!interval.start) {
      errors.push(`Interval ${index + 1} requires a start time.`);
    }
    if (!interval.end && !isRunningTail) {
      errors.push(`Interval ${index + 1} requires an end time.`);
    }
    if (interval.start && Number.isNaN(parseDate(interval.start).getTime())) {
      errors.push(`Interval ${index + 1} start time is invalid.`);
    }
    if (interval.end && Number.isNaN(parseDate(interval.end).getTime())) {
      errors.push(`Interval ${index + 1} end time is invalid.`);
    }
    if (interval.start && interval.end && parseDate(interval.end) < parseDate(interval.start)) {
      errors.push(`Interval ${index + 1} cannot end before it starts.`);
    }
  });
  return errors;
}

function validateEntryMetadata(file: TimeLogFile, entry: EntryInterval): string[] {
  return [
    ...validateMetadataPayload(getSessionMetadataFieldDefinitions(getResolvedMetadataFields(file)), entry.metadata, file),
    ...(entry.intervals ?? []).flatMap((interval) =>
      validateMetadataPayload(getIntervalMetadataFieldDefinitions(getResolvedMetadataFields(file)), interval.metadata, file)
    )
  ];
}

export function validateFile(input: unknown): { file: TimeLogFile | null; errors: string[] } {
  const parsed = timeLogSchema.safeParse(input);
  if (!parsed.success) {
    return {
      file: null,
      errors: parsed.error.issues.map((issue) => issue.message)
    };
  }

  const file: TimeLogFile = {
    ...parsed.data,
    fields: ensureBuiltinFields(parsed.data.fields),
    internalTaskColumns: normalizeInternalTaskColumns(parsed.data.internalTaskColumns),
    taskSources: normalizeInternalTaskSources(
      parsed.data.taskSources,
      normalizeInternalTaskColumns(parsed.data.internalTaskColumns)
    ),
    activeTasks: normalizeActiveTasks(parsed.data),
    settings: parsed.data.settings ?? defaultGeneralSettings
  };

  const errors = [
    ...validateFieldDefinitions(file.fields),
    ...validateAttributeReferenceGroups(file.fields, file.attributeReferenceGroups),
    ...validateInternalTaskColumns(file.internalTaskColumns),
    ...validateTaskSources(file),
    ...validateInternalTasks(file),
    ...file.entries.flatMap((entry) => [
      ...validateIntervals(entry),
      ...validateEntryMetadata(file, entry)
    ])
  ];

  return {
    file: errors.length > 0 ? null : file,
    errors
  };
}
