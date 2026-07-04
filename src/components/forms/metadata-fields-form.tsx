import { useEffect, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/forms/date-time-picker";
import { PathInput } from "@/components/forms/path-input";
import {
  applyResolvedMetadataDefaults,
  getActiveMetadataFields,
  getSelectableFieldOptions
} from "@/lib/attribute-references";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  getFieldOptionDisplayValue,
  formatMetadataValue,
  getFieldChoose,
  getMetadataChoiceToken,
  getMetadataChoiceTokens,
  getMetadataFields,
  metadataValuesEqual,
  parseMetadataValueForField
} from "@/lib/metadata";
import type { MetadataValue, SessionMetadata, TimeLogFile } from "@/lib/types";

type MetadataFieldsFormProps = {
  fields: TimeLogFile["fields"];
  attributeReferenceGroups?: TimeLogFile["attributeReferenceGroups"];
  value: SessionMetadata;
  onChange: (value: SessionMetadata) => void;
};

export function MetadataFieldsForm({ fields, attributeReferenceGroups = [], value, onChange }: MetadataFieldsFormProps) {
  const file = useMemo<TimeLogFile>(
    () => ({
      version: 1,
      fields,
      attributeReferenceGroups,
      entries: []
    }),
    [attributeReferenceGroups, fields]
  );
  const visibleFields = useMemo(() => getActiveMetadataFields(file, value), [file, value]);

  useEffect(() => {
    const nextValue = applyResolvedMetadataDefaults(file, value);
    const changed = Object.keys(nextValue).some((key) => !metadataValuesEqual(nextValue[key], value[key]));
    if (changed) {
      onChange({
        ...value,
        ...nextValue
      });
    }
  }, [file, onChange, value]);

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {getMetadataFields(visibleFields).map(([key, field]) => {
        const effectiveChoose =
          field.type === "attribute_reference" && getFieldChoose(field) !== "multiselect"
            ? "select"
            : getFieldChoose(field);
        const selectableOptions = getSelectableFieldOptions(field, file);

        return (
        <div className="grid gap-2" key={key}>
          {field.type !== "datetime" ? (
            <Label htmlFor={`metadata-${key}`}>
              {key}
              {field.required ? <span className="ml-1 text-destructive">*</span> : null}
            </Label>
          ) : null}
          {effectiveChoose === "select" ? (
            <Select
              value={getMetadataChoiceToken(field, value[key])}
              disabled={field.editable === false}
              onValueChange={(nextValue) =>
                onChange({
                  ...value,
                  [key]: nextValue === "__unset__" ? undefined : nextValue ? parseMetadataValueForField(field, nextValue) : undefined
                })
              }
            >
              <SelectTrigger id={`metadata-${key}`} className="w-full">
                <SelectValue placeholder={`Choose ${key}${field.required ? " *" : ""}`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__unset__">Unset</SelectItem>
                {selectableOptions.map((option) => (
                  <SelectItem key={option.raw} value={option.value}>
                    {getFieldOptionDisplayValue(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : effectiveChoose === "multiselect" ? (
            <div className="flex flex-wrap gap-2 rounded-md border border-border p-2">
              {selectableOptions.map((option) => {
                const current = getMetadataChoiceTokens(field, value[key]);
                const selected = current.includes(option.value);
                return (
                  <button
                    className={
                      selected
                        ? "rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground"
                        : "rounded-md border border-border px-3 py-1 text-sm"
                    }
                    key={option.raw}
                    type="button"
                    disabled={field.editable === false}
                    onClick={() => {
                      if (field.editable === false) {
                        return;
                      }
                      const next = selected ? current.filter((item) => item !== option.value) : [...current, option.value];
                      onChange({
                        ...value,
                        [key]:
                          next.length > 0
                            ? next.map((item) => parseMetadataValueForField(field, item)).filter(
                                (item): item is boolean | number | string => item !== undefined
                              )
                            : undefined
                      });
                    }}
                  >
                    {getFieldOptionDisplayValue(option)}
                  </button>
                );
              })}
            </div>
          ) : field.type === "bool" ? (
            <Select
              value={typeof value[key] === "boolean" ? String(value[key]) : "__unset__"}
              disabled={field.editable === false}
              onValueChange={(nextValue) =>
                onChange({
                  ...value,
                  [key]: nextValue === "__unset__" ? undefined : nextValue === "true"
                })
              }
            >
              <SelectTrigger id={`metadata-${key}`} className="w-full">
                <SelectValue placeholder={`Choose ${key}`} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__unset__">Unset</SelectItem>
                <SelectItem value="true">True</SelectItem>
                <SelectItem value="false">False</SelectItem>
              </SelectContent>
            </Select>
          ) : field.type === "datetime" ? (
            <div id={`metadata-${key}`}>
              <DateTimePicker
                label={field.required ? `${key} *` : key}
                value={typeof value[key] === "string" ? String(value[key]) : undefined}
                disabled={field.editable === false}
                onChange={(nextValue) =>
                  onChange({
                    ...value,
                    [key]: nextValue
                  })
                }
                allowClear
              />
            </div>
          ) : field.type === "path" ? (
            <PathInput
              value={typeof value[key] === "string" ? value[key] : ""}
              disabled={field.editable === false}
              onChange={(nextValue) =>
                onChange({
                  ...value,
                  [key]: nextValue || undefined
                })
              }
            />
          ) : field.type === "markdown_glob" ? (
            <Input
              id={`metadata-${key}`}
              value={typeof value[key] === "string" ? value[key] : ""}
              required={field.required}
              disabled={field.editable === false}
              onChange={(event) =>
                onChange({
                  ...value,
                  [key]: event.target.value || undefined
                })
              }
              placeholder="**/*.md"
            />
          ) : field.type === "int" || field.type === "float" ? (
            <Input
              id={`metadata-${key}`}
              type="number"
              step={field.type === "int" ? "1" : "any"}
              value={value[key] === undefined ? "" : String(value[key])}
              required={field.required}
              disabled={field.editable === false}
              onChange={(event) =>
                onChange({
                  ...value,
                  [key]:
                    event.target.value === ""
                      ? undefined
                      : field.type === "int"
                        ? Number.parseInt(event.target.value, 10)
                        : Number.parseFloat(event.target.value)
                })
              }
              placeholder={key}
            />
          ) : (
            <Input
              id={`metadata-${key}`}
              value={formatMetadataValue(value[key])}
              required={field.required}
              disabled={field.editable === false}
              onChange={(event) =>
                onChange({
                  ...value,
                  [key]: event.target.value || undefined
                })
              }
              placeholder={key}
            />
          )}
        </div>
      )})}
    </div>
  );
}
