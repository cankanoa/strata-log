import { v4 as uuidv4 } from "uuid";
import { CSDBDatabase, serializeCSDB, type Row, type TableSchema } from "@/lib/csdb";
import {
  ensureBuiltinFields,
  getIntervalMetadataFields,
  getSessionMetadataFields,
  getFieldSelection,
  normalizeFieldVisibility,
  getFieldOptions,
  hasMetadataValue,
  normalizeFieldDefinition,
  parseCellValue,
  serializeCellValue,
  serializeFieldOption
} from "@/lib/metadata";
import { getAttributeReferenceFieldDefinitions } from "@/lib/attribute-references";
import {
  normalizeInternalTaskColumns,
  normalizeInternalTaskSources,
  sanitizeInternalTaskValues
} from "@/lib/internal-tasks";
import { defaultGeneralSettings } from "@/lib/defaults";
import type { ActiveTaskReference, AttributeReferenceGroup, EntryInterval, FieldDefinition, GeneralSettings, InternalTaskRow, MetadataValue, OnlineAccount, SessionMetadata, SessionPreset, TaskFieldMetadata, TaskRow, TaskSource, TimeInterval, TimeLogFile } from "@/lib/types";
import { validateFile } from "@/lib/validation";

const EMPTY_DATABASE = `--- csdb
format: CSDB
version: 1
name: strata-log
tables: []
`;

const FIELD_TABLE: TableSchema = {
  name: "track_fields",
  columns: {
    id: "text",
    name: "text",
    type: "text",
    selection: "text",
    interval: "boolean",
    required: "boolean",
    visibility: "text",
    options_json: "text",
    default_json: "text",
    scope: "text",
    attribute_reference_group_label: "text"
  },
  required: ["id", "name", "type", "selection", "interval", "required", "visibility", "scope"],
  primary_key: { columns: ["id"] }
};

const ATTRIBUTE_REFERENCE_GROUPS_TABLE: TableSchema = {
  name: "track_attribute_references",
  columns: {
    label: "text"
  },
  required: ["label"],
  primary_key: { columns: ["label"] }
};

const SESSION_TABLE: TableSchema = {
  name: "track_sessions",
  columns: {
    id: "text",
    type: "text"
  },
  required: ["id", "type"],
  primary_key: { columns: ["id"] }
};

const SESSION_PRESET_TABLE: TableSchema = {
  name: "track_session_presets",
  columns: {
    id: "text",
    name: "text",
    metadata_json: "text"
  },
  required: ["id", "name", "metadata_json"],
  primary_key: { columns: ["id"] }
};

const INTERVAL_TABLE: TableSchema = {
  name: "track_intervals",
  columns: {
    id: "text",
    session_id: "text",
    start_time: "timestamp",
    end_time: "timestamp"
  },
  required: ["id", "session_id", "start_time"],
  primary_key: { columns: ["id"] }
};

const METADATA_TABLE: TableSchema = {
  name: "track_metadata",
  columns: {
    id: "text",
    session_id: "text",
    interval_id: "text",
    field_name: "text",
    value_text: "text"
  },
  required: ["id", "field_name", "value_text"],
  primary_key: { columns: ["id"] }
};

const TASK_SOURCES_TABLE: TableSchema = {
  name: "task_sources",
  columns: {
    id: "text",
    name: "text",
    type: "text",
    url: "text",
    account_id: "text",
    column_names_json: "text",
    last_updated_at: "timestamp"
  },
  required: ["id", "type", "url"],
  primary_key: { columns: ["id"] }
};

const INTERNAL_TASK_COLUMNS_TABLE: TableSchema = {
  name: "task_internal_columns",
  columns: {
    id: "text",
    name: "text",
    type: "text",
    selection: "text",
    required: "boolean",
    options_json: "text",
    default_json: "text"
  },
  required: ["id", "name", "type", "selection", "required"],
  primary_key: { columns: ["id"] }
};

const INTERNAL_TASKS_TABLE: TableSchema = {
  name: "tasks_internal",
  columns: {
    id: "text",
    task_source_id: "text",
    values_json: "text"
  },
  required: ["id", "task_source_id", "values_json"],
  primary_key: { columns: ["id"] }
};

const ACTIVE_TASKS_TABLE: TableSchema = {
  name: "tasks_active",
  columns: {
    task_id: "text",
    task_table: "text"
  },
  required: ["task_id", "task_table"],
  primary_key: { columns: ["task_id", "task_table"] }
};

const TASKS_TABLE: TableSchema = {
  name: "tasks",
  columns: {
    uuid: "text",
    source_id: "text",
    parent_task_id: "text",
    type: "text",
    url: "text",
    contents: "text",
    status: "boolean",
    rank: "text",
    hash: "text",
    byte_length: "integer",
    updated_at: "timestamp",
    data_json: "text"
  },
  required: ["uuid", "source_id", "type", "url", "contents", "rank", "data_json"],
  primary_key: { columns: ["uuid"] }
};

const SETTINGS_TABLE: TableSchema = {
  name: "settings",
  columns: {
    key: "text",
    value_json: "text"
  },
  required: ["key", "value_json"],
  primary_key: { columns: ["key"] }
};

const ACCOUNTS_TABLE: TableSchema = {
  name: "accounts",
  columns: {
    id: "text",
    type: "text",
    name: "text",
    username: "text",
    token: "text"
  },
  required: ["id", "type", "name"],
  primary_key: { columns: ["id"] }
};

const SCHEMAS: TableSchema[] = [
  FIELD_TABLE,
  ATTRIBUTE_REFERENCE_GROUPS_TABLE,
  SESSION_TABLE,
  SESSION_PRESET_TABLE,
  INTERVAL_TABLE,
  METADATA_TABLE,
  TASK_SOURCES_TABLE,
  TASKS_TABLE,
  INTERNAL_TASK_COLUMNS_TABLE,
  INTERNAL_TASKS_TABLE,
  ACTIVE_TASKS_TABLE,
  SETTINGS_TABLE,
  ACCOUNTS_TABLE
];

const REQUIRED_SCHEMA_NAMES = new Set(SCHEMAS.map((schema) => schema.name).filter((name) => name !== SETTINGS_TABLE.name));

type ParsedFieldRow = {
  id: string;
  name: string;
  scope: "regular" | "attribute_reference_group";
  attributeReferenceGroupLabel?: string;
  field: FieldDefinition;
};

function createDatabase(): CSDBDatabase {
  const db = CSDBDatabase.parse(EMPTY_DATABASE);
  SCHEMAS.forEach((schema) => db.createTable(schema));
  return db;
}

function tableRows(db: CSDBDatabase, tableName: string): Row[] {
  if (!db.document.tables.has(tableName)) {
    return [];
  }
  return db.table(tableName).all();
}

function missingSchemaTables(db: CSDBDatabase): string[] {
  return SCHEMAS
    .map((schema) => schema.name)
    .filter((name) => REQUIRED_SCHEMA_NAMES.has(name) && !db.document.tables.has(name));
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function asBoolean(value: unknown): boolean {
  return typeof value === "boolean" ? value : value === "true";
}

function createScalarValue(field: FieldDefinition, value: boolean | number | string): { value_text: string } {
  return {
    value_text: serializeCellValue({ ...field, selection: "single", options: undefined }, value)
  };
}

function readScalarValue(field: FieldDefinition, row: Row): MetadataValue {
  return parseCellValue({ ...field, selection: "single", options: undefined }, asString(row.value_text));
}

function readValueGroup(field: FieldDefinition, rows: Row[]): MetadataValue {
  const values = rows
    .map((row) => readScalarValue(field, row))
    .filter((value): value is boolean | number | string => value !== undefined);
  return getFieldSelection(field) === "multiselect" ? values : values[0];
}

function serializeJsonValue(value: MetadataValue | null | undefined): string {
  return JSON.stringify(value ?? null);
}

function parseJsonText(value: unknown): MetadataValue | null | undefined {
  const text = asString(value);
  if (!text) {
    return null;
  }
  return JSON.parse(text) as MetadataValue | null;
}

function parseMetadataJsonText(value: unknown): SessionMetadata {
  try {
    const parsed = JSON.parse(asString(value) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as SessionMetadata
      : {};
  } catch {
    return {};
  }
}

function parseObjectJsonText(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(asString(value) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function parseStringArrayJsonText(value: unknown): string[] {
  try {
    const parsed = JSON.parse(asString(value) || "[]");
    return Array.isArray(parsed)
      ? parsed.map((item) => String(item)).filter((item) => item.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function parseSettingsValue<T>(rowsByKey: Map<string, Row>, key: string, fallback: T): T {
  try {
    const row = rowsByKey.get(key);
    if (!row) {
      return fallback;
    }
    return JSON.parse(asString(row.value_json)) as T;
  } catch {
    return fallback;
  }
}

function normalizeTaskFieldMetadata(value: unknown): Record<string, TaskFieldMetadata[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([sourceId, rawItems]) => [
      sourceId,
      Array.isArray(rawItems)
        ? rawItems.flatMap((item) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
              return [];
            }
            const raw = item as Partial<TaskFieldMetadata>;
            if (!raw.path || !raw.label) {
              return [];
            }
            return [{
              sourceId: raw.sourceId,
              path: String(raw.path),
              label: String(raw.label),
              type: raw.type === "markdown" || raw.type === "number" || raw.type === "bool" || raw.type === "datetime" || raw.type === "select" || raw.type === "multiselect"
                ? raw.type
                : "string",
              editable: Boolean(raw.editable),
              options: Array.isArray(raw.options) ? raw.options.map(String) : undefined,
              fieldId: raw.fieldId,
              updateKind: raw.updateKind
            }];
          })
        : []
    ])
  );
}

function normalizeSettings(settings: GeneralSettings | undefined): GeneralSettings {
  const refreshRateSeconds = Number(settings?.refreshRateSeconds ?? defaultGeneralSettings.refreshRateSeconds);
  return {
    refreshRateSeconds: Number.isFinite(refreshRateSeconds) && refreshRateSeconds >= 0 ? Math.floor(refreshRateSeconds) : 0,
    taskFieldMetadata: normalizeTaskFieldMetadata(settings?.taskFieldMetadata)
  };
}

function groupRowsBy<T extends Row>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  return rows.reduce((map, row) => {
    const groupKey = key(row);
    map.set(groupKey, [...(map.get(groupKey) ?? []), row]);
    return map;
  }, new Map<string, T[]>());
}

function appendValueRows(
  rows: Row[],
  owner: { session_id?: string | null; interval_id?: string | null; field_name: string },
  field: FieldDefinition,
  value: MetadataValue
) {
  if (!hasMetadataValue(value)) {
    return;
  }

  const values = getFieldSelection(field) === "multiselect" ? (Array.isArray(value) ? value : []) : [value];
  values.forEach((item) => {
    if (item === undefined || item === null || Array.isArray(item)) {
      return;
    }
    rows.push({
      id: uuidv4(),
      session_id: owner.session_id ?? null,
      interval_id: owner.interval_id ?? null,
      field_name: owner.field_name,
      ...createScalarValue(field, item)
    });
  });
}

function parseFieldRows(db: CSDBDatabase): ParsedFieldRow[] {
  return tableRows(db, "track_fields").map((row) => {
    const field: FieldDefinition = normalizeFieldDefinition({
      id: asString(row.id),
      type: asString(row.type) as FieldDefinition["type"],
      selection: asString(row.selection) as FieldDefinition["selection"],
      interval: asBoolean(row.interval),
      required: asBoolean(row.required),
      visibility: asString(row.visibility) as FieldDefinition["visibility"],
      options: (() => {
        const parsedOptions = parseJsonText(row.options_json);
        return Array.isArray(parsedOptions) ? parsedOptions.map((item) => String(item)) : undefined;
      })(),
      default: parseJsonText(row.default_json) ?? null
    });

    return {
      id: asString(row.id),
      name: asString(row.name),
      scope: asString(row.scope) === "attribute_reference_group" ? "attribute_reference_group" : "regular",
      attributeReferenceGroupLabel:
        typeof row.attribute_reference_group_label === "string" ? asString(row.attribute_reference_group_label) : undefined,
      field
    };
  });
}

function parseAttributeReferenceGroups(db: CSDBDatabase, fieldRows: ParsedFieldRow[]): AttributeReferenceGroup[] {
  const groups = tableRows(db, "track_attribute_references").map((row) => ({
    label: asString(row.label),
    fields: {} as Record<string, FieldDefinition>
  }));

  const groupsByLabel = new Map(groups.map((group) => [group.label, group]));
  fieldRows
    .filter((row) => row.scope === "attribute_reference_group" && row.attributeReferenceGroupLabel)
    .forEach((row) => {
      const group = groupsByLabel.get(row.attributeReferenceGroupLabel!);
      if (group) {
        group.fields[row.name] = row.field;
      }
    });

  return groups;
}

function parseFields(db: CSDBDatabase): Record<string, FieldDefinition> {
  const fields = parseFieldRows(db)
    .filter((row) => row.scope === "regular")
    .reduce<Record<string, FieldDefinition>>((accumulator, row) => {
      accumulator[row.name] = row.field;
      return accumulator;
    }, {});

  return ensureBuiltinFields(fields);
}

function parseEntries(db: CSDBDatabase, fields: Record<string, FieldDefinition>): EntryInterval[] {
  const sessionRows = tableRows(db, "track_sessions");
  const intervalRowsBySession = groupRowsBy(tableRows(db, "track_intervals"), (row) => asString(row.session_id));
  const metadataRows = tableRows(db, "track_metadata");
  const sessionMetadataRowsByKey = groupRowsBy(
    metadataRows.filter((row) => asString(row.session_id).length > 0 && asString(row.interval_id).length === 0),
    (row) => `${asString(row.session_id)}::${asString(row.field_name)}`
  );
  const intervalValueRowsByKey = groupRowsBy(
    metadataRows.filter((row) => asString(row.interval_id).length > 0),
    (row) => `${asString(row.interval_id)}::${asString(row.field_name)}`
  );

  return sessionRows.map((sessionRow) => {
    const sessionId = asString(sessionRow.id);
    const entry: EntryInterval = {
      id: sessionId,
      type: asString(sessionRow.type) || "interval",
      metadata: {},
      intervals: []
    };

    const intervalRows = intervalRowsBySession.get(sessionId) ?? [];
    entry.intervals = intervalRows.map((intervalRow) => {
      const intervalId = asString(intervalRow.id);
      const endTime = typeof intervalRow.end_time === "string" ? asString(intervalRow.end_time) : undefined;
      const interval: TimeInterval = {
        id: intervalId,
        start: asString(intervalRow.start_time),
        end: endTime || undefined,
        metadata: {}
      };

      getIntervalMetadataFields(fields).forEach(([fieldName, field]) => {
        const fieldRows = intervalValueRowsByKey.get(`${intervalId}::${fieldName}`) ?? [];
        const value = readValueGroup(field, fieldRows);
        if (hasMetadataValue(value)) {
          interval.metadata![fieldName] = value;
        }
      });

      return interval;
    });

    getSessionMetadataFields(fields).forEach(([fieldName, field]) => {
      const fieldRows = sessionMetadataRowsByKey.get(`${sessionId}::${fieldName}`) ?? [];
      const value = readValueGroup(field, fieldRows);
      if (hasMetadataValue(value)) {
        entry.metadata![fieldName] = value;
      }
    });

    return entry;
  });
}

function parseTaskSources(db: CSDBDatabase): TaskSource[] {
  return tableRows(db, "task_sources").map((row) => ({
    id: asString(row.id),
    name: asString(row.name) || undefined,
    type: asString(row.type) === "Github" ? "Github" : asString(row.type) === "Internal Task" ? "Internal Task" : "Markdown",
    url: asString(row.url),
    accountId: asString(row.account_id) || undefined,
    columnNames: parseStringArrayJsonText(row.column_names_json),
    lastUpdatedAt: asString(row.last_updated_at) || undefined
  }));
}

function parseTasks(db: CSDBDatabase): TaskRow[] {
  return tableRows(db, "tasks").map((row) => ({
    id: asString(row.uuid),
    sourceId: asString(row.source_id),
    parentTaskId: asString(row.parent_task_id) || undefined,
    type: asString(row.type) === "Github" ? "Github" : asString(row.type) === "Internal Task" ? "Internal Task" : "Markdown",
    url: asString(row.url),
    contents: asString(row.contents),
    status: typeof row.status === "boolean" ? row.status : undefined,
    rank: asString(row.rank),
    hash: asString(row.hash) || undefined,
    byteLength: typeof row.byte_length === "number" ? row.byte_length : undefined,
    updatedAt: asString(row.updated_at) || undefined,
    data: parseObjectJsonText(row.data_json)
  }));
}

function parseAccounts(db: CSDBDatabase): OnlineAccount[] {
  return tableRows(db, "accounts").map((row) => ({
    id: asString(row.id),
    type: "Github",
    name: asString(row.name),
    username: asString(row.username) || undefined,
    token: asString(row.token) || undefined
  }));
}

function parseInternalTaskColumns(db: CSDBDatabase): Record<string, FieldDefinition> {
  return Object.fromEntries(
    tableRows(db, "task_internal_columns").map((row) => {
      const field = normalizeFieldDefinition({
        id: asString(row.id),
        type: asString(row.type) as FieldDefinition["type"],
        selection: asString(row.selection) as FieldDefinition["selection"],
        interval: false,
        required: asBoolean(row.required),
        visibility: "editable",
        options: parseStringArrayJsonText(row.options_json),
        default: parseJsonText(row.default_json) ?? null
      });
      return [asString(row.name), field];
    })
  );
}

function parseInternalTasks(db: CSDBDatabase): InternalTaskRow[] {
  return tableRows(db, "tasks_internal").map((row) => ({
    id: asString(row.id),
    taskSourceId: asString(row.task_source_id),
    values: parseMetadataJsonText(row.values_json)
  }));
}

function parseActiveTasks(db: CSDBDatabase): ActiveTaskReference[] {
  return tableRows(db, "tasks_active").flatMap((row) => {
    const table = asString(row.task_table);
    return table === "tasks" || table === "tasks_internal"
      ? [{ taskId: asString(row.task_id), table }]
      : [];
  });
}

function parseSessionPresets(db: CSDBDatabase): SessionPreset[] {
  return tableRows(db, "track_session_presets").map((row) => ({
    id: asString(row.id),
    name: asString(row.name),
    metadata: parseMetadataJsonText(row.metadata_json)
  }));
}

function parseSettings(db: CSDBDatabase): GeneralSettings {
  const rowsByKey = new Map(tableRows(db, "settings").map((row) => [asString(row.key), row]));
  return normalizeSettings({
    refreshRateSeconds: parseSettingsValue(rowsByKey, "refresh_rate_seconds", defaultGeneralSettings.refreshRateSeconds),
    taskFieldMetadata: parseSettingsValue(rowsByKey, "task_field_metadata", defaultGeneralSettings.taskFieldMetadata)
  });
}

function normalizeActiveTasks(file: TimeLogFile): ActiveTaskReference[] {
  const validTasks = new Set(file.tasks.map((task) => `tasks:${task.id}`));
  const seen = new Set<string>();
  return file.activeTasks.filter((reference) => {
    const key = `${reference.table}:${reference.taskId}`;
    const valid = reference.table === "tasks" && validTasks.has(key);
    if (!valid || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function normalizeFileForStorage(file: TimeLogFile): TimeLogFile {
  const internalTaskColumns = normalizeInternalTaskColumns(file.internalTaskColumns);
  const taskSources = normalizeInternalTaskSources(file.taskSources, internalTaskColumns);
  const sourcesById = new Map(taskSources.map((source) => [source.id, source]));
  const internalTasks = file.internalTasks.flatMap((task) => {
    const source = sourcesById.get(task.taskSourceId);
    return source?.type === "Internal Task"
      ? [{
          ...task,
          values: sanitizeInternalTaskValues(task.values, internalTaskColumns, source.columnNames ?? [])
        }]
      : [];
  });
  const existingInternalTaskRows = new Map(
    file.tasks.filter((task) => task.type === "Internal Task").map((task) => [task.id, task])
  );
  const internalTaskIndexRows: TaskRow[] = internalTasks.map((task, index) => {
    const source = sourcesById.get(task.taskSourceId);
    const existing = existingInternalTaskRows.get(task.id);
    const title = typeof task.values.title === "string" && task.values.title.trim() ? task.values.title.trim() : "Untitled";
    const rawStatus = task.values.status ?? task.values.Status;
    const statusText = String(rawStatus ?? "").toLowerCase();
    const status = typeof rawStatus === "boolean"
      ? rawStatus
      : ["open", "active", "true", "1"].includes(statusText)
        ? true
        : ["closed", "completed", "complete", "done", "false", "0", "x"].includes(statusText)
          ? false
          : true;
    return {
      id: task.id,
      sourceId: task.taskSourceId,
      type: "Internal Task",
      url: task.id,
      contents: title,
      status,
      rank: existing?.rank ?? String(index).padStart(6, "0"),
      hash: existing?.hash,
      byteLength: existing?.byteLength,
      updatedAt: existing?.updatedAt,
      data: {
        internalTaskId: task.id,
        taskSourceId: task.taskSourceId,
        __strata: {
          sourceType: "Internal Task",
          table: "tasks_internal"
        }
      }
    };
  });
  const normalized: TimeLogFile = {
    ...file,
    fields: ensureBuiltinFields(file.fields),
    taskSources,
    tasks: [
      ...file.tasks.filter((task) => task.type !== "Internal Task"),
      ...internalTaskIndexRows
    ],
    internalTaskColumns,
    internalTasks,
    settings: normalizeSettings(file.settings)
  };
  return {
    ...normalized,
    activeTasks: normalizeActiveTasks(normalized)
  };
}

export function buildDatabaseFromFile(file: TimeLogFile): CSDBDatabase {
  const normalizedFile = normalizeFileForStorage(file);

  const db = createDatabase();
  const fieldRows: Row[] = [];
  const groupRows: Row[] = [];
  const presetRows: Row[] = normalizedFile.sessionPresets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    metadata_json: JSON.stringify(preset.metadata ?? {})
  }));
  const sessionRows: Row[] = [];
  const intervalRows: Row[] = [];
  const metadataRows: Row[] = [];
  const taskSourceRows: Row[] = normalizedFile.taskSources.map((source) => ({
    id: source.id,
    name: source.name ?? null,
    type: source.type,
    url: source.url,
    account_id: source.accountId ?? null,
    column_names_json: JSON.stringify(source.columnNames ?? []),
    last_updated_at: source.lastUpdatedAt ?? null
  }));
  const taskRows: Row[] = normalizedFile.tasks.map((task) => ({
    uuid: task.id,
    source_id: task.sourceId,
    parent_task_id: task.parentTaskId ?? null,
    type: task.type,
    url: task.url,
    contents: task.contents,
    status: task.status ?? null,
    rank: task.rank,
    hash: task.hash ?? null,
    byte_length: task.byteLength ?? null,
    updated_at: task.updatedAt ?? null,
    data_json: JSON.stringify(task.data)
  }));
  const accountRows: Row[] = normalizedFile.accounts.map((account) => ({
    id: account.id,
    type: account.type,
    name: account.name,
    username: account.username ?? null,
    token: account.token ?? null
  }));
  const internalTaskColumnRows: Row[] = Object.entries(normalizedFile.internalTaskColumns).map(([name, rawField]) => {
    const fieldId = rawField.id ?? uuidv4();
    const field = normalizeFieldDefinition({
      ...rawField,
      id: fieldId,
      interval: false,
      visibility: "editable"
    });
    return {
      id: field.id ?? fieldId,
      name,
      type: field.type,
      selection: getFieldSelection(field),
      required: Boolean(field.required),
      options_json: serializeJsonValue(
        getFieldOptions(field).map((option) =>
          serializeFieldOption({
            display: option.display,
            value: option.value,
            raw: option.raw
          })
        )
      ),
      default_json: serializeJsonValue(field.default)
    };
  });
  const internalTaskRows: Row[] = normalizedFile.internalTasks.map((task) => ({
    id: task.id,
    task_source_id: task.taskSourceId,
    values_json: JSON.stringify(task.values ?? {})
  }));
  const activeTaskRows: Row[] = normalizedFile.activeTasks.map((reference) => ({
    task_id: reference.taskId,
    task_table: reference.table
  }));
  const settings = normalizeSettings(normalizedFile.settings);
  const settingsRows: Row[] = [
    {
      key: "refresh_rate_seconds",
      value_json: JSON.stringify(settings.refreshRateSeconds)
    },
    {
      key: "task_field_metadata",
      value_json: JSON.stringify(settings.taskFieldMetadata)
    }
  ];

  normalizedFile.attributeReferenceGroups.forEach((group) => {
    groupRows.push({
      label: group.label
    });
  });

  const appendFieldRow = (
    name: string,
    rawField: FieldDefinition,
    scope: "regular" | "attribute_reference_group",
    attributeReferenceGroupLabel?: string
  ) => {
    const fieldId = rawField.id ?? uuidv4();
    const field = normalizeFieldDefinition({
      ...rawField,
      id: fieldId
    });

    fieldRows.push({
      id: fieldId,
      name,
      type: field.type,
      selection: getFieldSelection(field),
      interval: Boolean(field.interval),
      required: Boolean(field.required),
      visibility: normalizeFieldVisibility(field),
      options_json: serializeJsonValue(
        getFieldOptions(field).map((option) =>
          serializeFieldOption({
            display: option.display,
            value: option.value,
            raw: option.raw
          })
        )
      ),
      default_json: serializeJsonValue(field.default),
      scope,
      attribute_reference_group_label: attributeReferenceGroupLabel ?? null
    });
  };

  Object.entries(normalizedFile.fields).forEach(([name, field]) => appendFieldRow(name, field, "regular"));
  normalizedFile.attributeReferenceGroups.forEach((group) => {
    Object.entries(group.fields).forEach(([name, field]) => appendFieldRow(name, field, "attribute_reference_group", group.label));
  });

  normalizedFile.entries.forEach((entry) => {
    sessionRows.push({
      id: entry.id,
      type: entry.type ?? "interval"
    });

    getSessionMetadataFields(normalizedFile.fields).forEach(([fieldName, field]) => {
      appendValueRows(
        metadataRows,
        {
          session_id: entry.id,
          interval_id: null,
          field_name: fieldName
        },
        field,
        entry.metadata?.[fieldName]
      );
    });

    (entry.intervals ?? []).forEach((interval, index) => {
      const intervalId = interval.id ?? `${entry.id}-${index}`;
      intervalRows.push({
        id: intervalId,
        session_id: entry.id,
        start_time: interval.start ?? "",
        end_time: interval.end ?? null
      });

      getIntervalMetadataFields(normalizedFile.fields).forEach(([fieldName, field]) => {
        appendValueRows(
          metadataRows,
          {
            session_id: null,
            interval_id: intervalId,
            field_name: fieldName
          },
          field,
          interval.metadata?.[fieldName]
        );
      });
    });
  });

  if (fieldRows.length > 0) db.table("track_fields").insert(fieldRows);
  if (groupRows.length > 0) db.table("track_attribute_references").insert(groupRows);
  if (presetRows.length > 0) db.table("track_session_presets").insert(presetRows);
  if (sessionRows.length > 0) db.table("track_sessions").insert(sessionRows);
  if (intervalRows.length > 0) db.table("track_intervals").insert(intervalRows);
  if (metadataRows.length > 0) db.table("track_metadata").insert(metadataRows);
  if (taskSourceRows.length > 0) db.table("task_sources").insert(taskSourceRows);
  if (taskRows.length > 0) db.table("tasks").insert(taskRows);
  if (internalTaskColumnRows.length > 0) db.table("task_internal_columns").insert(internalTaskColumnRows);
  if (internalTaskRows.length > 0) db.table("tasks_internal").insert(internalTaskRows);
  if (activeTaskRows.length > 0) db.table("tasks_active").insert(activeTaskRows);
  if (settingsRows.length > 0) db.table("settings").insert(settingsRows);
  if (accountRows.length > 0) db.table("accounts").insert(accountRows);

  return db;
}

export function fileFromDatabase(db: CSDBDatabase): { file: TimeLogFile | null; errors: string[] } {
  const missingTables = missingSchemaTables(db);
  if (missingTables.length > 0) {
    return {
      file: null,
      errors: [`Missing required table(s): ${missingTables.join(", ")}.`]
    };
  }

  const fieldRows = parseFieldRows(db);
  const attributeReferenceGroups = parseAttributeReferenceGroups(db, fieldRows);
  const fields = parseFields(db);
  const resolvedFields = {
    ...fields,
    ...getAttributeReferenceFieldDefinitions({
      version: 1,
      fields,
      attributeReferenceGroups,
      sessionPresets: [],
      taskSources: [],
      tasks: [],
      internalTaskColumns: {},
      internalTasks: [],
      activeTasks: [],
      accounts: [],
      settings: defaultGeneralSettings,
      entries: []
    })
  };

  return validateFile({
    version: 1,
    fields,
    attributeReferenceGroups,
    sessionPresets: parseSessionPresets(db),
    taskSources: parseTaskSources(db),
    tasks: parseTasks(db),
    internalTaskColumns: parseInternalTaskColumns(db),
    internalTasks: parseInternalTasks(db),
    activeTasks: parseActiveTasks(db),
    accounts: parseAccounts(db),
    settings: parseSettings(db),
    entries: parseEntries(db, resolvedFields)
  });
}

export function parseTimeLogYaml(raw: string): { file: TimeLogFile | null; errors: string[] } {
  try {
    return fileFromDatabase(CSDBDatabase.parse(raw));
  } catch (error) {
    return {
      file: null,
      errors: [error instanceof Error ? error.message : "Failed to parse CSDB file."]
    };
  }
}

export function serializeTimeLogYaml(file: TimeLogFile): string {
  return serializeCSDB(buildDatabaseFromFile(file));
}
