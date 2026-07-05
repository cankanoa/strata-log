import { v4 as uuidv4 } from "uuid";
import type { CSDBDatabase, Row } from "@/lib/csdb";
import {
  getFieldSelection,
  getFieldOptions,
  getMetadataFields,
  hasMetadataValue,
  normalizeFieldVisibility,
  normalizeFieldDefinition,
  normalizeMetadata,
  parseFieldOption,
  serializeCellValue,
  serializeFieldOption
} from "@/lib/metadata";
import { getResolvedMetadataFields } from "@/lib/attribute-references";
import { normalizeSessionPresets } from "@/lib/session-presets";
import type { EntryInterval, FieldDefinition, MetadataValue, SessionMetadata, SessionPreset, TimeLogFile } from "@/lib/types";
import { buildDatabaseFromFile, fileFromDatabase } from "@/lib/yaml";

function rows(db: CSDBDatabase, tableName: string): Row[] {
  return db.document.tables.get(tableName)?.rows ?? [];
}

function singleValueField(field: FieldDefinition): FieldDefinition {
  return {
    ...field,
    selection: "single",
    options: undefined
  };
}

function serializeJsonValue(value: MetadataValue | null | undefined): string {
  return JSON.stringify(value ?? null);
}

function toStoredValues(field: FieldDefinition, value: MetadataValue): string[] {
  if (!hasMetadataValue(value)) {
    return [];
  }

  if (getFieldSelection(field) === "multiselect") {
    return (Array.isArray(value) ? value : [])
      .filter((item): item is boolean | number | string => item !== undefined && item !== null)
      .map((item) => serializeCellValue(singleValueField(field), item));
  }

  if (Array.isArray(value) || value === undefined || value === null) {
    return [];
  }

  return [serializeCellValue(singleValueField(field), value)];
}

function readFile(db: CSDBDatabase): TimeLogFile {
  const parsed = fileFromDatabase(db);
  if (!parsed.file || parsed.errors.length > 0) {
    throw new Error(parsed.errors.join(" ") || "Failed to read CSDB database.");
  }
  return parsed.file;
}

function mutateFile(file: TimeLogFile, mutator: (db: CSDBDatabase) => void): TimeLogFile {
  const db = buildDatabaseFromFile(file);
  mutator(db);
  return readFile(db);
}

function fieldScope(groupLabel?: string): "regular" | "attribute_reference_group" {
  return groupLabel ? "attribute_reference_group" : "regular";
}

function findFieldRow(db: CSDBDatabase, name: string, groupLabel?: string): Row | undefined {
  return rows(db, "fields").find((row) =>
    String(row.name) === name &&
    String(row.scope) === fieldScope(groupLabel) &&
    (groupLabel ? String(row.attribute_reference_group_label ?? "") === groupLabel : row.attribute_reference_group_label == null)
  );
}

function deleteEntryRows(db: CSDBDatabase, entryId: string) {
  const intervalIds = rows(db, "intervals")
    .filter((row) => row.session_id === entryId)
    .map((row) => String(row.id));

  intervalIds.forEach((intervalId) => {
    db.table("metadata").where({ interval_id: intervalId }).delete();
  });

  db.table("metadata").where({ session_id: entryId }).delete();
  db.table("intervals").where({ session_id: entryId }).delete();
  db.table("sessions").where({ id: entryId }).delete();
}

function insertFieldDefinitionRows(db: CSDBDatabase, name: string, rawField: FieldDefinition, groupLabel?: string) {
  const field = normalizeFieldDefinition(rawField);
  const existingRow = rawField.id ? db.table("fields").byPrimaryKey(rawField.id) : findFieldRow(db, name, groupLabel);
  const fieldId = String(existingRow?.id ?? rawField.id ?? uuidv4());
  if (!groupLabel && field.type === "attribute_reference") {
    getFieldOptions(field).forEach((option) => ensureAttributeReferenceGroupRow(db, option.value));
  }

  if (existingRow) {
    db.table("fields").where({ id: fieldId }).update({
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
      scope: fieldScope(groupLabel),
      attribute_reference_group_label: groupLabel ?? null
    });
  } else {
    db.table("fields").insert({
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
      scope: fieldScope(groupLabel),
      attribute_reference_group_label: groupLabel ?? null
    });
  }
}

function insertMetadataRows(
  db: CSDBDatabase,
  owner: { sessionId?: string | null; intervalId?: string | null },
  fieldName: string,
  field: FieldDefinition,
  value: MetadataValue
) {
  const storedValues = toStoredValues(field, value);
  if (storedValues.length === 0) {
    return;
  }

  db.table("metadata").insert(
    storedValues.map((valueText) => ({
      id: uuidv4(),
      session_id: owner.sessionId ?? null,
      interval_id: owner.intervalId ?? null,
      field_name: fieldName,
      value_text: valueText
    }))
  );
}

function normalizeEntryForStorage(file: TimeLogFile, entry: EntryInterval): EntryInterval {
  const resolvedFields = getResolvedMetadataFields(file);
  return {
    ...entry,
    id: entry.id,
    type: entry.type ?? "interval",
    intervalMetadata: Boolean(entry.intervalMetadata),
    metadata: normalizeMetadata(resolvedFields, entry.metadata ?? {}),
    intervals: (entry.intervals ?? []).map((interval) => ({
      ...interval,
      id: interval.id ?? uuidv4(),
      metadata: normalizeMetadata(resolvedFields, interval.metadata ?? {})
    }))
  };
}

function insertEntryRows(db: CSDBDatabase, file: TimeLogFile, rawEntry: EntryInterval) {
  const resolvedFields = getResolvedMetadataFields(file);
  const entry = normalizeEntryForStorage(file, rawEntry);

  db.table("sessions").insert({
    id: entry.id,
    type: entry.type ?? "interval",
    interval_metadata: Boolean(entry.intervalMetadata)
  });

  if (!entry.intervalMetadata) {
    getMetadataFields(resolvedFields).forEach(([fieldName, field]) => {
      insertMetadataRows(db, { sessionId: entry.id }, fieldName, field, entry.metadata?.[fieldName]);
    });
  }

  (entry.intervals ?? []).forEach((interval) => {
    const intervalId = interval.id ?? uuidv4();
    db.table("intervals").insert({
      id: intervalId,
      session_id: entry.id,
      start_time: interval.start ?? "",
      end_time: interval.end ?? null
    });

    if (!entry.intervalMetadata) {
      return;
    }

    getMetadataFields(resolvedFields).forEach(([fieldName, field]) => {
      insertMetadataRows(db, { intervalId }, fieldName, field, interval.metadata?.[fieldName]);
    });
  });
}

function latestIntervalRow(db: CSDBDatabase, sessionId: string): Row | undefined {
  return rows(db, "intervals").filter((row) => row.session_id === sessionId).at(-1);
}

function selectorFieldNames(file: TimeLogFile): string[] {
  return Object.entries(file.fields)
    .filter(([, field]) => field.type === "attribute_reference")
    .map(([name]) => name);
}

function uniqueLabels(labels: string[]): string[] {
  const seen = new Set<string>();
  return labels
    .map((label) => label.trim())
    .filter((label) => label.length > 0)
    .filter((label) => {
      if (seen.has(label)) {
        return false;
      }
      seen.add(label);
      return true;
    });
}

function ensureAttributeReferenceGroupRow(db: CSDBDatabase, label: string) {
  if (rows(db, "attribute_reference_groups").some((row) => String(row.label) === label)) {
    return;
  }

  db.table("attribute_reference_groups").insert({ label });
}

function readFieldOptionLabels(fieldRow: Row): string[] {
  try {
    return (JSON.parse(String(fieldRow.options_json ?? "[]")) as string[])
      .map((option) => parseFieldOption(option).value.trim())
      .filter((option) => option.length > 0);
  } catch {
    return [];
  }
}

function writeFieldOptionLabels(db: CSDBDatabase, fieldId: string, labels: string[]) {
  const nextLabels = uniqueLabels(labels);
  db.table("fields").where({ id: fieldId }).update({
    options_json: serializeJsonValue(
      nextLabels.map((label) =>
        serializeFieldOption({
          display: label,
          value: label,
          raw: ""
        })
      )
    )
  });
}

function addAttributeReferenceToFieldRows(db: CSDBDatabase, fieldName: string, label: string) {
  const nextLabel = label.trim();
  if (nextLabel.length === 0) {
    return;
  }

  const fieldRow = findFieldRow(db, fieldName);
  if (!fieldRow) {
    return;
  }

  ensureAttributeReferenceGroupRow(db, nextLabel);
  const nextLabels = [...readFieldOptionLabels(fieldRow), nextLabel];
  writeFieldOptionLabels(db, String(fieldRow.id), nextLabels);
}

function removeAttributeReferenceFromFieldRows(db: CSDBDatabase, fieldName: string, label: string) {
  const nextLabel = label.trim();
  const fieldRow = findFieldRow(db, fieldName);
  if (!fieldRow || nextLabel.length === 0) {
    return;
  }

  writeFieldOptionLabels(
    db,
    String(fieldRow.id),
    readFieldOptionLabels(fieldRow).filter((currentLabel) => currentLabel !== nextLabel)
  );
}

function updateEntries(file: TimeLogFile, updater: (entry: EntryInterval) => EntryInterval): TimeLogFile {
  return {
    ...file,
    entries: file.entries.map(updater)
  };
}

function getFieldDefinition(file: TimeLogFile, name: string, groupLabel?: string): FieldDefinition | undefined {
  if (!groupLabel) {
    return file.fields[name];
  }
  return file.attributeReferenceGroups.find((group) => group.label === groupLabel)?.fields[name];
}

function convertSelectionValue(
  value: MetadataValue,
  nextSelection: NonNullable<FieldDefinition["selection"]>
): MetadataValue {
  if (!hasMetadataValue(value)) {
    return undefined;
  }

  if (nextSelection === "multiselect") {
    return Array.isArray(value)
      ? value.filter((item): item is boolean | number | string => item !== undefined)
      : [value].filter((item): item is boolean | number | string => item !== undefined);
  }

  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

function collectObservedFieldOptionValues(file: TimeLogFile, name: string, field: FieldDefinition): string[] {
  const serialized = new Set<string>();
  const baseField = singleValueField(field);

  function addValue(value: MetadataValue) {
    if (!hasMetadataValue(value)) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => addValue(item));
      return;
    }

    const stored = serializeCellValue(baseField, value);
    if (stored.length === 0) {
      return;
    }

    serialized.add(
      serializeFieldOption({
        display: stored,
        value: stored,
        raw: stored
      })
    );
  }

  addValue(field.default ?? undefined);

  file.entries.forEach((entry) => {
    if (entry.intervalMetadata) {
      (entry.intervals ?? []).forEach((interval) => addValue(interval.metadata?.[name]));
      return;
    }

    addValue(entry.metadata?.[name]);
  });

  return [...serialized];
}

function convertFieldSelectionInFile(
  file: TimeLogFile,
  name: string,
  currentField: FieldDefinition,
  nextField: FieldDefinition,
  groupLabel?: string
): TimeLogFile {
  const currentSelection = getFieldSelection(currentField);
  const nextSelection = getFieldSelection(nextField);

  if (currentSelection === nextSelection) {
    return file;
  }

  const nextDefault = convertSelectionValue(currentField.default ?? undefined, nextSelection);

  return {
    ...updateEntries(file, (entry) => {
      if (entry.intervalMetadata) {
        return {
          ...entry,
          intervals: (entry.intervals ?? []).map((interval) => ({
            ...interval,
            metadata: {
              ...(interval.metadata ?? {}),
              [name]: convertSelectionValue(interval.metadata?.[name], nextSelection)
            }
          }))
        };
      }

      return {
        ...entry,
        metadata: {
          ...(entry.metadata ?? {}),
          [name]: convertSelectionValue(entry.metadata?.[name], nextSelection)
        }
      };
    }),
    fields: !groupLabel
      ? {
          ...file.fields,
          [name]: {
            ...nextField,
            default: nextDefault
          }
        }
      : file.fields,
    attributeReferenceGroups: groupLabel
      ? file.attributeReferenceGroups.map((group) =>
          group.label === groupLabel
            ? {
                ...group,
                fields: {
                  ...group.fields,
                  [name]: {
                    ...nextField,
                    default: nextDefault
                  }
                }
              }
            : group
        )
      : file.attributeReferenceGroups
  };
}

export const TimeLogDatabase = {
  createEntry(input: Omit<EntryInterval, "id">): EntryInterval {
    return {
      ...input,
      id: uuidv4(),
      type: input.type ?? "interval",
      intervalMetadata: Boolean(input.intervalMetadata),
      intervals: (input.intervals ?? []).map((interval) => ({
        ...interval,
        id: interval.id ?? uuidv4(),
        metadata: interval.metadata ?? {}
      })),
      metadata: input.metadata ?? {}
    };
  },

  addEntry(file: TimeLogFile, entry: EntryInterval): TimeLogFile {
    return mutateFile(file, (db) => {
      insertEntryRows(db, file, entry);
    });
  },

  updateEntry(file: TimeLogFile, entryId: string, nextEntry: EntryInterval): TimeLogFile {
    return mutateFile(file, (db) => {
      deleteEntryRows(db, entryId);
      insertEntryRows(db, file, { ...nextEntry, id: entryId });
    });
  },

  deleteEntry(file: TimeLogFile, entryId: string): TimeLogFile {
    return mutateFile(file, (db) => {
      deleteEntryRows(db, entryId);
    });
  },

  setSessionPresets(file: TimeLogFile, presets: SessionPreset[]): TimeLogFile {
    return {
      ...file,
      sessionPresets: normalizeSessionPresets(presets)
    };
  },

  startLiveEntry(file: TimeLogFile, metadata: SessionMetadata, now: string, intervalMetadata = false): TimeLogFile {
    return this.addEntry(file, {
      id: uuidv4(),
      type: "running",
      intervalMetadata,
      metadata: intervalMetadata ? {} : metadata,
      intervals: [
        {
          id: uuidv4(),
          start: now,
          end: now,
          metadata: intervalMetadata ? metadata : {}
        }
      ]
    });
  },

  stopLiveEntry(file: TimeLogFile, now: string): TimeLogFile {
    return mutateFile(file, (db) => {
      const running = db.table("sessions").where({ type: "running" }).first();
      if (!running) {
        return;
      }

      const sessionId = String(running.id);
      const interval = latestIntervalRow(db, sessionId);
      if (!interval) {
        return;
      }

      db.table("intervals").where({ id: String(interval.id) }).update({ end_time: now });
      db.table("sessions").where({ id: sessionId }).update({ type: "interval" });
    });
  },

  addField(file: TimeLogFile, name: string, field: FieldDefinition, groupLabel?: string): TimeLogFile {
    return mutateFile(file, (db) => {
      insertFieldDefinitionRows(db, name, field, groupLabel);
    });
  },

  renameField(file: TimeLogFile, previousName: string, nextName: string, groupLabel?: string): TimeLogFile {
    return mutateFile(file, (db) => {
      const existingRow = findFieldRow(db, previousName, groupLabel);
      if (!existingRow) {
        return;
      }
      db.table("fields").where({ id: String(existingRow.id) }).update({ name: nextName });
      if (!groupLabel) {
        db.table("metadata").where({ field_name: previousName }).update({ field_name: nextName });
      }
    });
  },

  updateField(file: TimeLogFile, name: string, nextField: FieldDefinition, groupLabel?: string): TimeLogFile {
    const currentField = getFieldDefinition(file, name, groupLabel);
    const preparedFile = currentField ? convertFieldSelectionInFile(file, name, currentField, nextField, groupLabel) : file;
    const nextSelection = getFieldSelection(nextField);
    const preparedField = currentField
      ? {
          ...nextField,
          default: convertSelectionValue(nextField.default ?? currentField.default ?? undefined, nextSelection),
          options:
            nextSelection === "single"
              ? undefined
              : nextField.options && nextField.options.length > 0
                ? nextField.options
                : collectObservedFieldOptionValues(preparedFile, name, nextField)
        }
      : nextField;

    return mutateFile(preparedFile, (db) => {
      insertFieldDefinitionRows(db, name, preparedField, groupLabel);
    });
  },

  addAttributeReferenceToField(file: TimeLogFile, name: string, label: string): TimeLogFile {
    return mutateFile(file, (db) => {
      addAttributeReferenceToFieldRows(db, name, label);
    });
  },

  removeAttributeReferenceFromField(file: TimeLogFile, name: string, label: string): TimeLogFile {
    return mutateFile(file, (db) => {
      removeAttributeReferenceFromFieldRows(db, name, label);
    });
  },

  setAttributeReferenceGroupsForField(file: TimeLogFile, name: string, labels: string[]): TimeLogFile {
    const currentField = file.fields[name];
    if (!currentField) {
      return file;
    }

    const currentLabels = getFieldOptions(currentField).map((option) => option.value);
    const nextLabels = uniqueLabels(labels);
    const labelsToAdd = nextLabels.filter((label) => !currentLabels.includes(label));
    const labelsToRemove = currentLabels.filter((label) => !nextLabels.includes(label));

    return mutateFile(file, (db) => {
      labelsToAdd.forEach((label) => addAttributeReferenceToFieldRows(db, name, label));
      labelsToRemove.forEach((label) => removeAttributeReferenceFromFieldRows(db, name, label));
    });
  },

  deleteField(file: TimeLogFile, name: string, groupLabel?: string): TimeLogFile {
    return mutateFile(file, (db) => {
      const existingRow = findFieldRow(db, name, groupLabel);
      if (!existingRow) {
        return;
      }
      const fieldId = String(existingRow.id);
      if (!groupLabel) {
        db.table("metadata").where({ field_name: name }).delete();
      }
      db.table("fields").where({ id: fieldId }).delete();
    });
  },

  addAttributeReferenceGroup(file: TimeLogFile, label: string): TimeLogFile {
    return mutateFile(file, (db) => {
      db.table("attribute_reference_groups").insert({ label });
    });
  },

  renameAttributeReferenceGroup(file: TimeLogFile, groupLabel: string, label: string): TimeLogFile {
    return mutateFile(file, (db) => {
      db.table("attribute_reference_groups").where({ label: groupLabel }).update({ label });
      db.table("fields").where({ attribute_reference_group_label: groupLabel }).update({
        attribute_reference_group_label: label
      });
    });
  },

  deleteAttributeReferenceGroup(file: TimeLogFile, groupLabel: string): TimeLogFile {
    return mutateFile(file, (db) => {
      db.table("fields").where({ attribute_reference_group_label: groupLabel }).delete();
      rows(db, "fields")
        .filter((row) => String(row.type) === "attribute_reference")
        .forEach((row) => {
          const options = (() => {
            try {
              return JSON.parse(String(row.options_json ?? "[]")) as string[];
            } catch {
              return [];
            }
          })();
          const nextOptions = options.filter((option) => parseFieldOption(option).value !== groupLabel);
          db.table("fields").where({ id: String(row.id) }).update({ options_json: serializeJsonValue(nextOptions) });
        });
      db.table("attribute_reference_groups").where({ label: groupLabel }).delete();

      selectorFieldNames(file).forEach((fieldName) => {
        db.table("metadata").where({ field_name: fieldName, value_text: groupLabel }).delete();
      });
    });
  },

  countMissingFieldValues(file: TimeLogFile, name: string): number {
    return file.entries.reduce((count, entry) => {
      if (entry.intervalMetadata) {
        return count + (entry.intervals ?? []).filter((interval) => !hasMetadataValue(interval.metadata?.[name])).length;
      }
      return count + (hasMetadataValue(entry.metadata?.[name]) ? 0 : 1);
    }, 0);
  },

  fillMissingFieldValues(file: TimeLogFile, name: string, value: MetadataValue): TimeLogFile {
    const field = file.fields[name];
    if (!field) {
      return file;
    }

    const normalizedValue = normalizeMetadata({ [name]: field }, { [name]: value })[name];
    return updateEntries(file, (entry) => {
      if (entry.intervalMetadata) {
        return {
          ...entry,
          intervals: (entry.intervals ?? []).map((interval) =>
            hasMetadataValue(interval.metadata?.[name])
              ? interval
              : {
                  ...interval,
                  metadata: {
                    ...(interval.metadata ?? {}),
                    [name]: normalizedValue
                  }
                }
          )
        };
      }

      if (hasMetadataValue(entry.metadata?.[name])) {
        return entry;
      }

      return {
        ...entry,
        metadata: {
          ...(entry.metadata ?? {}),
          [name]: normalizedValue
        }
      };
    });
  }
};
