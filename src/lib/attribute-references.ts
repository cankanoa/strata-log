import {
  applyMetadataDefaults,
  formatMetadataFieldValue,
  getFieldOptionDisplayValue,
  getFieldSelection,
  getFieldOptions,
  getMetadataDisplayValue,
  getIntervalMetadataFieldDefinitions,
  getMetadataFields,
  getSessionMetadataFieldDefinitions,
  normalizeMetadataValue,
  serializeFieldOption,
  type ParsedFieldOption
} from "@/lib/metadata";
import { taskSourceLabel } from "@/lib/task-query";
import type { AttributeReferenceGroup, EntryInterval, FieldDefinition, MetadataValue, SessionMetadata, TimeLogFile } from "@/lib/types";

export function getTaskSourceFieldOptions(file: TimeLogFile | null | undefined): ParsedFieldOption[] {
  const seen = new Set<string>();
  return (file?.taskSources ?? []).flatMap((source) => {
    const value = source.url.trim();
    if (!value || seen.has(value)) {
      return [];
    }
    seen.add(value);
    return [{
      display: taskSourceLabel(source),
      value,
      raw: `task-source:${source.id}`
    }];
  });
}

export function getFieldOptionsWithAttributeReferences(
  field: FieldDefinition | undefined,
  file: TimeLogFile | null | undefined
): ParsedFieldOption[] {
  if (field?.type === "attribute_reference") {
    const groupsByLabel = new Map((file?.attributeReferenceGroups ?? []).map((group) => [group.label, group]));
    return getFieldOptions(field).map((option) => {
      const group = groupsByLabel.get(option.value);
      return group
        ? {
            display: group.label,
            value: group.label,
            raw: serializeFieldOption({
              display: group.label,
              value: group.label,
              raw: ""
            })
          }
        : option;
    });
  }
  return [];
}

export function getSelectableFieldOptions(
  field: FieldDefinition | undefined,
  file: TimeLogFile | null | undefined
): ParsedFieldOption[] {
  if (!field) {
    return [];
  }

  if (field.type === "attribute_reference") {
    return getFieldOptionsWithAttributeReferences(field, file);
  }
  if (field.type === "filter_task_sources") {
    return getTaskSourceFieldOptions(file);
  }
  return getFieldOptions(field);
}

export function getSelectableMetadataChoiceDisplayValue(
  field: FieldDefinition | undefined,
  file: TimeLogFile | null | undefined,
  value: MetadataValue
): string {
  if (!field) {
    return getMetadataDisplayValue(value);
  }

  const selection = getFieldSelection(field);
  if (field.type === "attribute_reference" || field.type === "filter_task_sources") {
    const options = getSelectableFieldOptions(field, file);
    if (selection === "multiselect") {
      const values = Array.isArray(value) ? value : [];
      const labels = values.map((item) => {
        const match = options.find((option) => option.value === item);
        return match ? getFieldOptionDisplayValue(match) : String(item);
      });
      return labels.length > 0 ? labels.join(", ") : "—";
    }

    const match = options.find((option) => option.value === value);
    return match ? getFieldOptionDisplayValue(match) : getMetadataDisplayValue(value);
  }

  return formatMetadataFieldValue(field, value);
}

export function formatMetadataFieldValueForFile(
  file: TimeLogFile | null | undefined,
  field: FieldDefinition | undefined,
  value: MetadataValue
): string {
  return getSelectableMetadataChoiceDisplayValue(field, file, value);
}

export function getAttributeReferenceFieldDefinitions(
  file: TimeLogFile | null | undefined
): Record<string, FieldDefinition> {
  return (file?.attributeReferenceGroups ?? []).reduce<Record<string, FieldDefinition>>((accumulator, group) => {
    Object.entries(group.fields).forEach(([key, field]) => {
      if (!accumulator[key]) {
        accumulator[key] = field;
      }
    });
    return accumulator;
  }, {});
}

export function getResolvedMetadataFields(
  file: TimeLogFile | null | undefined
): Record<string, FieldDefinition> {
  if (!file) {
    return {};
  }

  return {
    ...file.fields,
    ...getAttributeReferenceFieldDefinitions(file)
  };
}

function selectedReferenceIds(field: FieldDefinition, value: MetadataValue): string[] {
  const selection = getFieldSelection(field);
  if (selection === "multiselect") {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  }
  return typeof value === "string" && value.trim().length > 0 ? [value] : [];
}

export function getSelectedAttributeReferenceGroups(
  file: TimeLogFile | null | undefined,
  metadata: SessionMetadata | undefined
): AttributeReferenceGroup[] {
  if (!file) {
    return [];
  }

  const selectedIds = new Set<string>();
  getMetadataFields(file.fields).forEach(([key, field]) => {
    if (field.type !== "attribute_reference") {
      return;
    }
    selectedReferenceIds(field, metadata?.[key]).forEach((groupLabel) => selectedIds.add(groupLabel));
  });

  return file.attributeReferenceGroups.filter((group) => selectedIds.has(group.label));
}

export function getSelectedAttributeReferenceFieldDefinitions(
  file: TimeLogFile | null | undefined,
  metadata: SessionMetadata | undefined
): Record<string, FieldDefinition> {
  return getSelectedAttributeReferenceGroups(file, metadata).reduce<Record<string, FieldDefinition>>((accumulator, group) => {
    Object.entries(group.fields).forEach(([key, field]) => {
      if (!accumulator[key]) {
        accumulator[key] = field;
      }
    });
    return accumulator;
  }, {});
}

export function getActiveMetadataFields(
  file: TimeLogFile | null | undefined,
  metadata: SessionMetadata | undefined
): Record<string, FieldDefinition> {
  if (!file) {
    return {};
  }

  return {
    ...file.fields,
    ...getSelectedAttributeReferenceFieldDefinitions(file, metadata)
  };
}

export function resolveAttributeReferenceMetadata(
  file: TimeLogFile | null | undefined,
  metadata: SessionMetadata | undefined
): SessionMetadata {
  if (!file) {
    return metadata ?? {};
  }

  const source = { ...(metadata ?? {}) };
  getSelectedAttributeReferenceGroups(file, source).forEach((group) => {
    Object.entries(group.fields).forEach(([groupFieldKey, groupField]) => {
      if (source[groupFieldKey] !== undefined) {
        source[groupFieldKey] = normalizeMetadataValue(groupField, source[groupFieldKey]);
        return;
      }
      const resolved = normalizeMetadataValue(groupField, groupField.default ?? undefined);
      if (resolved !== undefined) {
        source[groupFieldKey] = resolved;
      }
    });
  });

  return source;
}

export function applyResolvedMetadataDefaults(
  file: TimeLogFile | null | undefined,
  metadata: SessionMetadata | undefined
): SessionMetadata {
  if (!file) {
    return metadata ?? {};
  }

  return applyMetadataDefaults(getActiveMetadataFields(file, metadata), metadata);
}

export function resolveEntryMetadata(file: TimeLogFile | null | undefined, entry: EntryInterval | undefined): SessionMetadata {
  if (!entry) {
    return {};
  }

  return resolveAttributeReferenceMetadata(file, entry.metadata ?? {});
}

export function getSessionFields(file: TimeLogFile | null | undefined): Record<string, FieldDefinition> {
  return getSessionMetadataFieldDefinitions(getResolvedMetadataFields(file));
}

export function getIntervalFields(file: TimeLogFile | null | undefined): Record<string, FieldDefinition> {
  return getIntervalMetadataFieldDefinitions(getResolvedMetadataFields(file));
}
