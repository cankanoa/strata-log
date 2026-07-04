import type { FieldChoose, FieldDefinition, FieldType, MetadataValue, SessionMetadata } from "@/lib/types";
import { formatDateTimeValue } from "@/lib/datetime";

export const BUILTIN_FIELD_DEFINITIONS = {
  id: { type: "uuid", choose: "single", required: false, editable: false, default: null },
  type: { type: "string", choose: "single", required: false, editable: false, default: null },
  start_time: { type: "datetime", choose: "single", required: false, editable: false, default: null },
  end_time: { type: "datetime", choose: "single", required: false, editable: false, default: null },
  session_id: { type: "uuid", choose: "single", required: false, editable: false, default: null },
  interval_metadata: { type: "bool", choose: "single", required: false, editable: false, default: false }
} as const satisfies Record<string, FieldDefinition>;

export const fieldTypeOptions: FieldType[] = [
  "string",
  "path",
  "markdown_glob",
  "attribute_reference",
  "bool",
  "int",
  "float",
  "datetime",
  "uuid"
];

export const fieldChooseOptions: FieldChoose[] = ["single", "select", "multiselect"];
export const attributeReferenceChooseOptions: FieldChoose[] = ["select", "multiselect"];
export const boolChooseOptions: FieldChoose[] = ["single"];

export type ParsedFieldOption = {
  display?: string;
  value: string;
  raw: string;
};

export function normalizeFieldDefinition(field: FieldDefinition): FieldDefinition {
  const legacyChoose =
    field.type === "select" ? "select" : field.type === "multiselect" ? "multiselect" : "single";
  const choose = field.type === "bool" ? "single" : field.choose ?? legacyChoose;
  const type: FieldType = field.type === "select" || field.type === "multiselect" ? "string" : field.type;
  const options =
    field.type === "bool" || choose === "single"
      ? undefined
      : field.options?.filter((value) => value.trim().length > 0);
  return {
    ...field,
    type,
    choose,
    editable: field.editable ?? true,
    options
  };
}

export function normalizeFieldDefinitions(fields: Record<string, FieldDefinition>): Record<string, FieldDefinition> {
  return Object.fromEntries(
    Object.entries(fields).map(([key, field]) => [key, normalizeFieldDefinition(field)])
  );
}

export function isBuiltinField(key: string): boolean {
  return key in BUILTIN_FIELD_DEFINITIONS;
}

export function ensureBuiltinFields(fields: Record<string, FieldDefinition>): Record<string, FieldDefinition> {
  return {
    ...BUILTIN_FIELD_DEFINITIONS,
    ...normalizeFieldDefinitions(fields)
  };
}

export function getMetadataFields(fields: Record<string, FieldDefinition>): Array<[string, FieldDefinition]> {
  return Object.entries(fields).filter(([key]) => !isBuiltinField(key));
}

export function getSessionMetadataFields(fields: Record<string, FieldDefinition>): Array<[string, FieldDefinition]> {
  return getMetadataFields(fields).filter(([, field]) => field.type !== "attribute_reference");
}

export function getFieldChoose(field: FieldDefinition | undefined): FieldChoose {
  return field?.choose ?? "single";
}

export function getChooseOptionsForFieldType(type: FieldType): FieldChoose[] {
  if (type === "attribute_reference") {
    return attributeReferenceChooseOptions;
  }
  if (type === "bool") {
    return boolChooseOptions;
  }
  return fieldChooseOptions;
}

export function supportsOptions(field: FieldDefinition | undefined): boolean {
  return field?.type === "attribute_reference" || getFieldChoose(field) !== "single";
}

export function parseFieldOption(raw: string): ParsedFieldOption {
  const trimmed = raw.trim();
  const match = trimmed.match(/^\[(.*?)\](.*)$/);
  if (!match) {
    return {
      value: trimmed,
      raw: trimmed
    };
  }

  const display = match[1]?.trim() || undefined;
  const value = match[2]?.trim() || display || trimmed;
  return {
    display,
    value,
    raw: trimmed
  };
}

export function getFieldOptions(field: FieldDefinition | undefined): ParsedFieldOption[] {
  return (field?.options ?? []).map((option) => parseFieldOption(option)).filter((option) => option.value.length > 0);
}

export function serializeFieldOption(option: ParsedFieldOption): string {
  return !option.display || option.display === option.value ? option.value : `[${option.display}]${option.value}`;
}

export function getFieldOptionDisplayValue(option: ParsedFieldOption): string {
  return option.display || option.value;
}

export function formatFieldOption(option: ParsedFieldOption): string {
  return getFieldOptionDisplayValue(option);
}

export function getFieldOptionLabel(option: ParsedFieldOption): string {
  return getFieldOptionDisplayValue(option);
}

export function parseMetadataValueForField(field: FieldDefinition | undefined, value: string): MetadataValue {
  if (!field || value.trim().length === 0) {
    return undefined;
  }

  switch (field.type) {
    case "uuid":
    case "string":
    case "path":
    case "markdown_glob":
    case "attribute_reference":
    case "datetime":
      return value;
    case "bool":
      return ["true", "1", "yes", "on"].includes(value.toLowerCase());
    case "int": {
      const parsed = Number.parseInt(value, 10);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    case "float": {
      const parsed = Number.parseFloat(value);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    default:
      return value;
  }
}

function parseOptionValue(field: FieldDefinition, option: ParsedFieldOption): MetadataValue {
  return parseMetadataValueForField(field, option.value);
}

export function metadataValueMatchesOption(field: FieldDefinition, value: MetadataValue, option: ParsedFieldOption): boolean {
  const optionValue = parseOptionValue(field, option);
  return metadataValuesEqual(value, optionValue);
}

export function getMetadataChoiceToken(field: FieldDefinition | undefined, value: MetadataValue): string {
  if (!field || value === undefined || value === null) {
    return "";
  }

  const options = getFieldOptions(field);
  const match = options.find((option) => metadataValueMatchesOption(field, value, option));
  if (match) {
    return match.value;
  }

  return typeof value === "string" ? value : String(value);
}

export function getMetadataChoiceTokens(field: FieldDefinition | undefined, value: MetadataValue): string[] {
  if (!field || !Array.isArray(value)) {
    return [];
  }

  return value.map((item) => getMetadataChoiceToken(field, item)).filter((item) => item.length > 0);
}

export function formatMetadataValue(value: MetadataValue): string {
  if (value === undefined) {
    return "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (Array.isArray(value)) {
    return value.join(", ");
  }
  return String(value);
}

export function getMetadataDisplayValue(value: MetadataValue): string {
  const formatted = formatMetadataValue(value);
  return formatted === "" ? "—" : formatted;
}

function getMatchingFieldOption(field: FieldDefinition, value: MetadataValue): ParsedFieldOption | undefined {
  if (field.type === "attribute_reference") {
    return getFieldOptions(field).find((option) => option.value === value);
  }

  return getFieldOptions(field).find((option) => metadataValuesEqual(parseOptionValue(field, option), value));
}

export function getMetadataChoiceDisplayValue(field: FieldDefinition | undefined, value: MetadataValue): string {
  if (!field) {
    return getMetadataDisplayValue(value);
  }

  if (getFieldChoose(field) === "multiselect") {
    const values = Array.isArray(value) ? value : [];
    return values
      .map((item) => {
        const match = getMatchingFieldOption(field, item);
        return match ? getFieldOptionDisplayValue(match) : String(item);
      })
      .join(", ");
  }

  const match = getMatchingFieldOption(field, value);
  return match ? getFieldOptionDisplayValue(match) : getMetadataDisplayValue(value);
}

export function formatMetadataFieldValue(field: FieldDefinition | undefined, value: MetadataValue): string {
  if (!field) {
    return getMetadataDisplayValue(value);
  }
  const choose = getFieldChoose(field);
  if (field.type === "attribute_reference" || choose === "select" || choose === "multiselect") {
    return getMetadataChoiceDisplayValue(field, value);
  }
  if (field.type === "datetime") {
    return formatDateTimeValue(value as string | undefined);
  }
  if (field.type === "path" || field.type === "markdown_glob") {
    return typeof value === "string" && value.trim().length > 0 ? value : "—";
  }
  return getMetadataDisplayValue(value);
}

export function hasMetadataValue(value: MetadataValue): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return true;
}

export function getFieldDefaultValue(field: FieldDefinition): MetadataValue | undefined {
  return field.default === null ? undefined : field.default;
}

export function createEmptyMetadataValue(field: FieldDefinition): MetadataValue {
  const defaultValue = getFieldDefaultValue(field);
  if (defaultValue !== undefined) {
    return defaultValue;
  }
  return getFieldChoose(field) === "multiselect" ? [] : undefined;
}

export function emptyMetadata(fields: Record<string, FieldDefinition>): SessionMetadata {
  return getMetadataFields(fields).reduce<SessionMetadata>((accumulator, [key, field]) => {
    accumulator[key] = createEmptyMetadataValue(field);
    return accumulator;
  }, {});
}

export function applyMetadataDefaults(
  fields: Record<string, FieldDefinition>,
  metadata: SessionMetadata | undefined
): SessionMetadata {
  const next = normalizeMetadata(fields, metadata);

  getMetadataFields(fields).forEach(([key, field]) => {
    if (hasMetadataValue(next[key])) {
      return;
    }
    const defaultValue = getFieldDefaultValue(field);
    if (defaultValue !== undefined) {
      next[key] = normalizeMetadataValue(field, defaultValue);
    }
  });

  return next;
}

export function normalizeMetadataValue(field: FieldDefinition, value: MetadataValue): MetadataValue {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
    return undefined;
  }

  const choose = getFieldChoose(field);
  if (choose === "multiselect") {
    const values = Array.isArray(value) ? value : String(value).split(",").map((item) => item.trim()).filter(Boolean);
    return values
      .map((item) => normalizeMetadataValue({ ...field, choose: "single" }, item))
      .filter((item): item is boolean | number | string => item !== undefined);
  }
  if (choose === "select") {
    return normalizeMetadataValue({ ...field, choose: "single" }, Array.isArray(value) ? value[0] : value);
  }

  switch (field.type) {
    case "bool":
      return typeof value === "boolean" ? value : String(value).toLowerCase() === "true";
    case "int": {
      const parsed = typeof value === "number" ? value : Number.parseInt(String(value), 10);
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    case "float": {
      const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
      return Number.isNaN(parsed) ? undefined : parsed;
    }
    case "path":
    case "markdown_glob":
    case "attribute_reference":
    case "uuid":
    default:
      return String(value);
  }
}

export function normalizeMetadata(
  fields: Record<string, FieldDefinition>,
  metadata: SessionMetadata | undefined
): SessionMetadata {
  const source = metadata ?? {};
  return Object.keys(source).reduce<SessionMetadata>((accumulator, key) => {
    const field = fields[key];
    if (!field || isBuiltinField(key)) {
      return accumulator;
    }
    accumulator[key] = normalizeMetadataValue(field, source[key]);
    return accumulator;
  }, {});
}

export function metadataValuesEqual(left: MetadataValue, right: MetadataValue): boolean {
  if (left === null || right === null) {
    return left === right;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
  }
  return left === right;
}

export function parseCellValue(field: FieldDefinition, raw: string): MetadataValue {
  if (raw.trim() === "") {
    return undefined;
  }

  const choose = getFieldChoose(field);
  if (choose === "multiselect") {
    return raw
      .split("|")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => parseMetadataValueForField(field, item))
      .filter((item): item is boolean | number | string => item !== undefined);
  }
  if (choose === "select") {
    return parseMetadataValueForField(field, raw);
  }

  return parseMetadataValueForField(field, raw);
}

export function serializeCellValue(field: FieldDefinition, value: MetadataValue): string {
  if (value === undefined) {
    return "";
  }
  const choose = getFieldChoose(field);
  if (choose === "multiselect") {
    return Array.isArray(value)
      ? value
          .map((item) => {
            if (typeof item === "string") {
              return item;
            }
            if (typeof item === "boolean") {
              return item ? "true" : "false";
            }
            return String(item);
          })
          .join("|")
      : "";
  }
  if (field.type === "bool") {
    return value ? "true" : "false";
  }
  return String(value);
}
