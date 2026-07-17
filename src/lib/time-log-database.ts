import { v4 as uuidv4 } from "uuid";
import type { CSDBDatabase, Row } from "@/lib/csdb";
import {
  getFieldSelection,
  getFieldOptions,
  getIntervalMetadataFields,
  getSessionMetadataFields,
  hasMetadataValue,
  normalizeFieldVisibility,
  normalizeFieldDefinition,
  normalizeMetadata,
  parseFieldOption,
  parseMetadataValueForField,
  serializeCellValue,
  serializeFieldOption
} from "@/lib/metadata";
import { getResolvedMetadataFields } from "@/lib/attribute-references";
import { normalizeSessionPresets } from "@/lib/session-presets";
import type {
  EntryInterval,
  FieldDefinition,
  MetadataValue,
  OnlineAccount,
  SessionMetadata,
  SessionPreset,
  TaskRow,
  TaskSource,
  TimeLogFile
} from "@/lib/types";
import { buildDatabaseFromFile, fileFromDatabase } from "@/lib/yaml";

export type FieldOptionValueResolution = "remove" | "update";

export type FieldOptionValueChange = {
  previousValue: string;
  previousDisplay: string;
  nextValue?: string;
  nextDisplay?: string;
  count: number;
};

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

function serializeFieldOptionsJson(field: FieldDefinition): string {
  return serializeJsonValue(
    getFieldOptions(field).map((option) =>
      serializeFieldOption({
        display: option.display,
        value: option.value,
        raw: option.raw
      })
    )
  );
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
  return db.table("fields").where({
    name,
    scope: fieldScope(groupLabel),
    attribute_reference_group_label: groupLabel ?? null
  }).first();
}

function deleteEntryRows(db: CSDBDatabase, entryId: string) {
  const intervalIds = db.table("intervals")
    .where({ session_id: entryId })
    .select(["id"])
    .all()
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
      interval: Boolean(field.interval),
      required: Boolean(field.required),
      visibility: normalizeFieldVisibility(field),
      options_json: serializeFieldOptionsJson(field),
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
      interval: Boolean(field.interval),
      required: Boolean(field.required),
      visibility: normalizeFieldVisibility(field),
      options_json: serializeFieldOptionsJson(field),
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
  const sessionFields = Object.fromEntries(getSessionMetadataFields(resolvedFields));
  const intervalFields = Object.fromEntries(getIntervalMetadataFields(resolvedFields));
  return {
    ...entry,
    id: entry.id,
    type: entry.type ?? "interval",
    metadata: normalizeMetadata(sessionFields, entry.metadata ?? {}),
    intervals: (entry.intervals ?? []).map((interval) => ({
      ...interval,
      id: interval.id ?? uuidv4(),
      metadata: normalizeMetadata(intervalFields, interval.metadata ?? {})
    }))
  };
}

function insertEntryRows(db: CSDBDatabase, file: TimeLogFile, rawEntry: EntryInterval) {
  const resolvedFields = getResolvedMetadataFields(file);
  const entry = normalizeEntryForStorage(file, rawEntry);

  db.table("sessions").insert({
    id: entry.id,
    type: entry.type ?? "interval"
  });

  getSessionMetadataFields(resolvedFields).forEach(([fieldName, field]) => {
    insertMetadataRows(db, { sessionId: entry.id }, fieldName, field, entry.metadata?.[fieldName]);
  });

  (entry.intervals ?? []).forEach((interval) => {
    const intervalId = interval.id ?? uuidv4();
    db.table("intervals").insert({
      id: intervalId,
      session_id: entry.id,
      start_time: interval.start ?? "",
      end_time: interval.end ?? null
    });

    getIntervalMetadataFields(resolvedFields).forEach(([fieldName, field]) => {
      insertMetadataRows(db, { intervalId }, fieldName, field, interval.metadata?.[fieldName]);
    });
  });
}

function latestIntervalRow(db: CSDBDatabase, sessionId: string): Row | undefined {
  return db.table("intervals").where({ session_id: sessionId }).all().at(-1);
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
  if (db.table("attribute_reference_groups").byPrimaryKey(label)) {
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
    if (field.interval) {
      (entry.intervals ?? []).forEach((interval) => addValue(interval.metadata?.[name]));
      return;
    }
    addValue(entry.metadata?.[name]);
  });

  return [...serialized];
}

function optionStoredValue(field: FieldDefinition, option: { value: string }): string {
  return serializeCellValue(singleValueField(field), parseMetadataValueForField(singleValueField(field), option.value));
}

function countFieldOptionValueUsage(
  db: CSDBDatabase,
  file: TimeLogFile,
  name: string,
  field: FieldDefinition,
  storedValue: string
): number {
  let count = db.table("metadata").where({ field_name: name, value_text: storedValue }).all().length;
  function countValue(value: MetadataValue) {
    count += toStoredValues(field, value).filter((item) => item === storedValue).length;
  }
  if (field.default !== undefined && field.default !== null) {
    countValue(field.default);
  }
  file.sessionPresets.forEach((preset) => countValue(preset.metadata[name]));
  return count;
}

function resolveOptionValue(
  field: FieldDefinition,
  value: MetadataValue,
  replacements: Map<string, MetadataValue | undefined>,
  resolution: FieldOptionValueResolution
): MetadataValue {
  if (!hasMetadataValue(value)) {
    return undefined;
  }

  if (getFieldSelection(field) === "multiselect") {
    const nextValues: Array<boolean | number | string> = [];
    const seen = new Set<string>();
    (Array.isArray(value) ? value : []).forEach((item) => {
      if (item === undefined || item === null) {
        return;
      }
      const stored = serializeCellValue(singleValueField(field), item);
      const replacement = replacements.get(stored);
      const nextValue = replacements.has(stored)
        ? resolution === "update"
          ? replacement
          : undefined
        : item;
      if (nextValue === undefined || Array.isArray(nextValue)) {
        return;
      }
      const nextStored = serializeCellValue(singleValueField(field), nextValue);
      if (seen.has(nextStored)) {
        return;
      }
      seen.add(nextStored);
      nextValues.push(nextValue);
    });
    return nextValues.length > 0 ? nextValues : undefined;
  }

  if (Array.isArray(value)) {
    return undefined;
  }
  const stored = serializeCellValue(singleValueField(field), value);
  if (!replacements.has(stored)) {
    return value;
  }
  return resolution === "update" ? replacements.get(stored) : undefined;
}

function resolveMetadataOptionValues(
  metadata: SessionMetadata | undefined,
  name: string,
  field: FieldDefinition,
  replacements: Map<string, MetadataValue | undefined>,
  resolution: FieldOptionValueResolution
): SessionMetadata {
  const nextValue = resolveOptionValue(field, metadata?.[name], replacements, resolution);
  return {
    ...(metadata ?? {}),
    [name]: nextValue
  };
}

function optionValueReplacements(
  field: FieldDefinition,
  changes: FieldOptionValueChange[]
): Map<string, MetadataValue | undefined> {
  return new Map(
    changes.map((change) => [
      change.previousValue,
      change.nextValue === undefined
        ? undefined
        : parseMetadataValueForField(singleValueField(field), change.nextValue)
    ])
  );
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

  if (currentSelection === nextSelection && Boolean(currentField.interval) === Boolean(nextField.interval)) {
    return file;
  }

  const nextDefault = convertSelectionValue(currentField.default ?? undefined, nextSelection);

  return {
    ...updateEntries(file, (entry) => {
      if (nextField.interval) {
        return {
          ...entry,
          metadata: {
            ...(entry.metadata ?? {}),
            [name]: undefined
          },
          intervals: (entry.intervals ?? []).map((interval) => ({
            ...interval,
            metadata: {
              ...(interval.metadata ?? {}),
              [name]: convertSelectionValue(interval.metadata?.[name] ?? entry.metadata?.[name], nextSelection)
            }
          }))
        };
      }

      return {
        ...entry,
        metadata: {
          ...(entry.metadata ?? {}),
          [name]: convertSelectionValue(entry.metadata?.[name] ?? entry.intervals?.find((interval) => hasMetadataValue(interval.metadata?.[name]))?.metadata?.[name], nextSelection)
        },
        intervals: (entry.intervals ?? []).map((interval) => ({
          ...interval,
          metadata: {
            ...(interval.metadata ?? {}),
            [name]: undefined
          }
        }))
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

  setTaskSources(file: TimeLogFile, sources: TaskSource[]): TimeLogFile {
    const sourceIds = new Set(sources.map((source) => source.id));
    return mutateFile(file, (db) => {
      db.table("task_sources").all().forEach((row) => {
        db.table("task_sources").where({ id: String(row.id) }).delete();
      });
      if (sources.length > 0) {
        db.table("task_sources").insert(
          sources.map((source) => ({
            id: source.id,
            name: source.name ?? null,
            type: source.type,
            url: source.url,
            account_id: source.accountId ?? null
          }))
        );
      }
      db.table("tasks").all().forEach((row) => {
        if (!sourceIds.has(String(row.source_id))) {
          db.table("tasks").where({ uuid: String(row.uuid) }).delete();
        }
      });
    });
  },

  setAccounts(file: TimeLogFile, accounts: OnlineAccount[]): TimeLogFile {
    return mutateFile(file, (db) => {
      db.table("accounts").all().forEach((row) => {
        db.table("accounts").where({ id: String(row.id) }).delete();
      });
      if (accounts.length > 0) {
        db.table("accounts").insert(
          accounts.map((account) => ({
            id: account.id,
            type: account.type,
            name: account.name,
            username: account.username ?? null,
            token: account.token ?? null
          }))
        );
      }
    });
  },

  replaceTasksForSource(file: TimeLogFile, sourceId: string, tasks: TaskRow[]): TimeLogFile {
    return mutateFile(file, (db) => {
      db.table("tasks").where({ source_id: sourceId }).delete();
      if (tasks.length > 0) {
        db.table("tasks").insert(
          tasks.map((task) => ({
            uuid: task.id,
            source_id: task.sourceId,
            parent_task_id: task.parentTaskId ?? null,
            type: task.type,
            url: task.url,
            contents: task.contents,
            status: task.status ?? null,
            rank: task.rank,
            data_json: JSON.stringify(task.data)
          }))
        );
      }
    });
  },

  startLiveEntry(
    file: TimeLogFile,
    metadata: SessionMetadata,
    now: string,
    intervalMetadata: SessionMetadata
  ): TimeLogFile {
    const resolvedFields = getResolvedMetadataFields(file);
    const sessionFields = Object.fromEntries(getSessionMetadataFields(resolvedFields));
    const intervalFields = Object.fromEntries(getIntervalMetadataFields(resolvedFields));
    return this.addEntry(file, {
      id: uuidv4(),
      type: "running",
      metadata: normalizeMetadata(sessionFields, metadata),
      intervals: [
        {
          id: uuidv4(),
          start: now,
          metadata: normalizeMetadata(intervalFields, intervalMetadata)
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

  getFieldOptionValueChanges(file: TimeLogFile, name: string, nextField: FieldDefinition): FieldOptionValueChange[] {
    const currentField = file.fields[name];
    if (!currentField || getFieldSelection(currentField) === "single" || getFieldSelection(nextField) === "single") {
      return [];
    }
    const db = buildDatabaseFromFile(file);
    const currentOptions = getFieldOptions(currentField);
    const nextOptions = getFieldOptions(nextField);
    const nextValues = new Set(nextOptions.map((option) => optionStoredValue(nextField, option)));

    return currentOptions.flatMap((option, index) => {
      const previousValue = optionStoredValue(currentField, option);
      if (nextValues.has(previousValue)) {
        return [];
      }
      const count = countFieldOptionValueUsage(db, file, name, currentField, previousValue);
      if (count === 0) {
        return [];
      }
      const nextOption = currentOptions.length === nextOptions.length || nextOptions.length > currentOptions.length
        ? nextOptions[index]
        : undefined;
      const nextValue = nextOption ? optionStoredValue(nextField, nextOption) : undefined;
      return [{
        previousValue,
        previousDisplay: option.display ?? option.value,
        nextValue,
        nextDisplay: nextOption ? nextOption.display ?? nextOption.value : undefined,
        count
      }];
    });
  },

  resolveFieldOptionValues(
    file: TimeLogFile,
    name: string,
    nextField: FieldDefinition,
    changes: FieldOptionValueChange[],
    resolution: FieldOptionValueResolution
  ): TimeLogFile {
    const currentField = file.fields[name];
    if (!currentField || changes.length === 0) {
      return file;
    }
    const db = buildDatabaseFromFile(file);
    const replacements = optionValueReplacements(nextField, changes);
    const fieldRow = findFieldRow(db, name);
    if (fieldRow) {
      db.table("fields").where({ id: String(fieldRow.id) }).update({
        options_json: serializeFieldOptionsJson(nextField),
        default_json: serializeJsonValue(resolveOptionValue(currentField, currentField.default ?? undefined, replacements, resolution))
      });
    }

    changes.forEach((change) => {
      const query = db.table("metadata").where({ field_name: name, value_text: change.previousValue });
      if (resolution === "update" && change.nextValue !== undefined) {
        query.update({ value_text: change.nextValue });
        return;
      }
      query.delete();
    });

    db.table("session_presets").all().forEach((presetRow) => {
      const metadata = resolveMetadataOptionValues(
        JSON.parse(String(presetRow.metadata_json ?? "{}")) as SessionMetadata,
        name,
        currentField,
        replacements,
        resolution
      );
      db.table("session_presets").where({ id: String(presetRow.id) }).update({
        metadata_json: JSON.stringify(metadata)
      });
    });

    return readFile(db);
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
      db.table("fields")
        .where({ type: "attribute_reference" })
        .all()
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
      if (file.fields[name]?.interval) {
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
      if (field.interval) {
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
