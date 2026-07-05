import { v4 as uuidv4 } from "uuid";
import { CSDBDatabase, serializeCSDB, type Row, type TableSchema } from "@/lib/csdb";
import {
  ensureBuiltinFields,
  getFieldSelection,
  normalizeFieldVisibility,
  getFieldOptions,
  getMetadataFields,
  hasMetadataValue,
  normalizeFieldDefinition,
  parseCellValue,
  serializeCellValue,
  serializeFieldOption
} from "@/lib/metadata";
import { getAttributeReferenceFieldDefinitions } from "@/lib/attribute-references";
import type { AttributeReferenceGroup, EntryInterval, FieldDefinition, MetadataValue, SessionMetadata, SessionPreset, TimeInterval, TimeLogFile } from "@/lib/types";
import { validateFile } from "@/lib/validation";

const EMPTY_DATABASE = `--- csdb
format: CSDB
version: 1
name: strata-log
tables: []
`;

const FIELD_TABLE: TableSchema = {
  name: "fields",
  columns: {
    id: "text",
    name: "text",
    type: "text",
    selection: "text",
    required: "boolean",
    visibility: "text",
    options_json: "text",
    default_json: "text",
    scope: "text",
    attribute_reference_group_label: "text"
  },
  required: ["id", "name", "type", "selection", "required", "visibility", "scope"],
  primary_key: { columns: ["id"] }
};

const ATTRIBUTE_REFERENCE_GROUPS_TABLE: TableSchema = {
  name: "attribute_reference_groups",
  columns: {
    label: "text"
  },
  required: ["label"],
  primary_key: { columns: ["label"] }
};

const SESSION_TABLE: TableSchema = {
  name: "sessions",
  columns: {
    id: "text",
    type: "text",
    interval_metadata: "boolean"
  },
  required: ["id", "type", "interval_metadata"],
  primary_key: { columns: ["id"] }
};

const SESSION_PRESET_TABLE: TableSchema = {
  name: "session_presets",
  columns: {
    id: "text",
    name: "text",
    metadata_json: "text"
  },
  required: ["id", "name", "metadata_json"],
  primary_key: { columns: ["id"] }
};

const INTERVAL_TABLE: TableSchema = {
  name: "intervals",
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
  name: "metadata",
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

const SCHEMAS: TableSchema[] = [
  FIELD_TABLE,
  ATTRIBUTE_REFERENCE_GROUPS_TABLE,
  SESSION_TABLE,
  SESSION_PRESET_TABLE,
  INTERVAL_TABLE,
  METADATA_TABLE
];

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
  return db.document.tables.get(tableName)?.rows ?? [];
}

function missingSchemaTables(db: CSDBDatabase): string[] {
  return SCHEMAS
    .map((schema) => schema.name)
    .filter((name) => !db.document.tables.has(name));
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
  return tableRows(db, "fields").map((row) => {
    const field: FieldDefinition = normalizeFieldDefinition({
      id: asString(row.id),
      type: asString(row.type) as FieldDefinition["type"],
      selection: asString(row.selection) as FieldDefinition["selection"],
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
  const groups = tableRows(db, "attribute_reference_groups").map((row) => ({
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
  const sessionRows = tableRows(db, "sessions");
  const intervalRowsBySession = groupRowsBy(tableRows(db, "intervals"), (row) => asString(row.session_id));
  const metadataRows = tableRows(db, "metadata");
  const sessionMetadataRowsByKey = groupRowsBy(
    metadataRows.filter((row) => asString(row.session_id).length > 0 && asString(row.interval_id).length === 0),
    (row) => `${asString(row.session_id)}::${asString(row.field_name)}`
  );
  const intervalMetadataRowsByKey = groupRowsBy(
    metadataRows.filter((row) => asString(row.interval_id).length > 0),
    (row) => `${asString(row.interval_id)}::${asString(row.field_name)}`
  );

  return sessionRows.map((sessionRow) => {
    const sessionId = asString(sessionRow.id);
    const intervalMetadata = asBoolean(sessionRow.interval_metadata);
    const entry: EntryInterval = {
      id: sessionId,
      type: asString(sessionRow.type) || "interval",
      intervalMetadata,
      metadata: {},
      intervals: []
    };

    const intervalRows = intervalRowsBySession.get(sessionId) ?? [];
    entry.intervals = intervalRows.map((intervalRow) => {
      const intervalId = asString(intervalRow.id);
      const interval: TimeInterval = {
        id: intervalId,
        start: asString(intervalRow.start_time),
        end: typeof intervalRow.end_time === "string" ? asString(intervalRow.end_time) : undefined,
        metadata: {}
      };

      if (intervalMetadata) {
        getMetadataFields(fields).forEach(([fieldName, field]) => {
          const fieldRows = intervalMetadataRowsByKey.get(`${intervalId}::${fieldName}`) ?? [];
          const value = readValueGroup(field, fieldRows);
          if (hasMetadataValue(value)) {
            interval.metadata![fieldName] = value;
          }
        });
      }

      return interval;
    });

    if (!intervalMetadata) {
      getMetadataFields(fields).forEach(([fieldName, field]) => {
        const fieldRows = sessionMetadataRowsByKey.get(`${sessionId}::${fieldName}`) ?? [];
        const value = readValueGroup(field, fieldRows);
        if (hasMetadataValue(value)) {
          entry.metadata![fieldName] = value;
        }
      });
    }

    return entry;
  });
}

function parseSessionPresets(db: CSDBDatabase): SessionPreset[] {
  return tableRows(db, "session_presets").map((row) => ({
    id: asString(row.id),
    name: asString(row.name),
    metadata: parseMetadataJsonText(row.metadata_json)
  }));
}

export function buildDatabaseFromFile(file: TimeLogFile): CSDBDatabase {
  const normalizedFile: TimeLogFile = {
    ...file,
    fields: ensureBuiltinFields(file.fields),
    attributeReferenceGroups: file.attributeReferenceGroups
  };

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
    const intervalMetadata = Boolean(entry.intervalMetadata);

    sessionRows.push({
      id: entry.id,
      type: entry.type ?? "interval",
      interval_metadata: intervalMetadata
    });

    if (!intervalMetadata) {
      getMetadataFields(normalizedFile.fields).forEach(([fieldName, field]) => {
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
    }

    (entry.intervals ?? []).forEach((interval, index) => {
      const intervalId = interval.id ?? `${entry.id}-${index}`;
      intervalRows.push({
        id: intervalId,
        session_id: entry.id,
        start_time: interval.start ?? "",
        end_time: interval.end ?? null
      });

      if (intervalMetadata) {
        getMetadataFields(normalizedFile.fields).forEach(([fieldName, field]) => {
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
      }
    });
  });

  if (fieldRows.length > 0) db.table("fields").insert(fieldRows);
  if (groupRows.length > 0) db.table("attribute_reference_groups").insert(groupRows);
  if (presetRows.length > 0) db.table("session_presets").insert(presetRows);
  if (sessionRows.length > 0) db.table("sessions").insert(sessionRows);
  if (intervalRows.length > 0) db.table("intervals").insert(intervalRows);
  if (metadataRows.length > 0) db.table("metadata").insert(metadataRows);

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
    ...getAttributeReferenceFieldDefinitions({ version: 1, fields, attributeReferenceGroups, sessionPresets: [], entries: [] })
  };

  return validateFile({
    version: 1,
    fields,
    attributeReferenceGroups,
    sessionPresets: parseSessionPresets(db),
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
