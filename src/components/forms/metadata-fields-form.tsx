import { useEffect, useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/forms/date-time-picker";
import { PathInput } from "@/components/forms/path-input";
import {
  applyResolvedMetadataDefaults,
  getActiveMetadataFields,
  getSelectableFieldOptions
} from "@/lib/attribute-references";
import { Button } from "@/components/ui/button";
import { MarkdownValueDialog } from "@/components/forms/markdown-value-dialog";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  canEditField,
  getFieldOptionDisplayValue,
  formatMetadataValue,
  getFieldSelection,
  getMetadataChoiceToken,
  getMetadataChoiceTokens,
  getMetadataFields,
  isFieldAddable,
  isFieldHidden,
  metadataValuesEqual,
  parseMetadataValueForField
} from "@/lib/metadata";
import { Pencil } from "lucide-react";
import type { MetadataValue, SessionMetadata, TimeLogFile } from "@/lib/types";

type MetadataFieldsFormProps = {
  fields: TimeLogFile["fields"];
  attributeReferenceGroups?: TimeLogFile["attributeReferenceGroups"];
  taskSources?: TimeLogFile["taskSources"];
  value: SessionMetadata;
  onChange: (value: SessionMetadata) => void;
  onEditOptions?: (fieldName: string) => void;
};

const EDIT_OPTIONS_VALUE = "__edit_options__";

export function MetadataFieldsForm({ fields, attributeReferenceGroups = [], taskSources = [], value, onChange, onEditOptions }: MetadataFieldsFormProps) {
  const [markdownFieldName, setMarkdownFieldName] = useState<string | null>(null);
  const file = useMemo<TimeLogFile>(
    () => ({
      version: 1,
      fields,
      attributeReferenceGroups,
      sessionPresets: [],
      taskSources,
      tasks: [],
      internalTaskColumns: {},
      internalTasks: [],
      activeTasks: [],
      accounts: [],
      entries: []
    }),
    [attributeReferenceGroups, fields, taskSources]
  );
  const visibleFields = useMemo(() => getActiveMetadataFields(file, value), [file, value]);
  const markdownField = markdownFieldName ? visibleFields[markdownFieldName] : undefined;

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
    <div className="grid items-start gap-4 md:grid-cols-2">
      {getMetadataFields(visibleFields).filter(([, field]) => !isFieldHidden(field)).map(([key, field]) => {
        const effectiveSelection =
          field.type === "attribute_reference" && getFieldSelection(field) !== "multiselect"
            ? "select"
            : getFieldSelection(field);
        const selectableOptions = getSelectableFieldOptions(field, file);
        const selectedOption = selectableOptions.find((option) => option.value === getMetadataChoiceToken(field, value[key]));
        const editable = canEditField(field);
        const addable = editable && isFieldAddable(field) && Boolean(onEditOptions);

        return (
        <div className="grid min-w-0 content-start gap-2 self-start" key={key}>
          {field.type !== "datetime" ? (
            <Label htmlFor={`metadata-${key}`}>
              {key}
              {field.required ? <span className="ml-1 text-destructive">*</span> : null}
            </Label>
          ) : null}
          {effectiveSelection === "select" ? (
            <Select
              value={getMetadataChoiceToken(field, value[key])}
              disabled={!editable}
              onValueChange={(nextValue) => {
                if (nextValue === EDIT_OPTIONS_VALUE) {
                  onEditOptions?.(key);
                  return;
                }
                onChange({
                  ...value,
                  [key]: nextValue === "__unset__" ? undefined : nextValue ? parseMetadataValueForField(field, nextValue) : undefined
                });
              }}
            >
              <SelectTrigger id={`metadata-${key}`} className="w-full">
                <SelectValue placeholder={`Select ${key}${field.required ? " *" : ""}`}>
                  {selectedOption ? getFieldOptionDisplayValue(selectedOption) : undefined}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__unset__">Unset</SelectItem>
                {selectableOptions.map((option) => (
                  <SelectItem key={option.raw} value={option.value}>
                    {getFieldOptionDisplayValue(option)}
                  </SelectItem>
                ))}
                {addable ? (
                  <>
                    <SelectSeparator />
                    <SelectItem value={EDIT_OPTIONS_VALUE}>
                      <Pencil className="size-4" />
                      Options
                    </SelectItem>
                  </>
                ) : null}
              </SelectContent>
            </Select>
          ) : effectiveSelection === "multiselect" ? (
            <div className="flex min-h-8 flex-wrap gap-2 rounded-md border border-border p-px">
              {selectableOptions.map((option) => {
                const current = getMetadataChoiceTokens(field, value[key]);
                const selected = current.includes(option.value);
                return (
                  <button
                    className={
                      selected
                        ? "inline-flex h-7 items-center rounded-md border border-primary bg-primary px-3 text-sm text-primary-foreground"
                        : "inline-flex h-7 items-center rounded-md border border-border px-3 text-sm"
                    }
                    key={option.raw}
                    type="button"
                    disabled={!editable}
                    onClick={() => {
                      if (!editable) {
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
              {addable ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => onEditOptions?.(key)}>
                  <Pencil className="size-4" />
                  Options
                </Button>
              ) : null}
            </div>
          ) : field.type === "bool" ? (
            <Select
              value={typeof value[key] === "boolean" ? String(value[key]) : "__unset__"}
              disabled={!editable}
              onValueChange={(nextValue) =>
                onChange({
                  ...value,
                  [key]: nextValue === "__unset__" ? undefined : nextValue === "true"
                })
              }
            >
              <SelectTrigger id={`metadata-${key}`} className="w-full">
                <SelectValue placeholder={`Select ${key}`}>
                  {typeof value[key] === "boolean" ? (value[key] ? "True" : "False") : undefined}
                </SelectValue>
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
                disabled={!editable}
                onChange={(nextValue) =>
                  onChange({
                    ...value,
                    [key]: nextValue
                  })
                }
                allowClear
              />
            </div>
          ) : field.type === "markdown" ? (
            <Button
              id={`metadata-${key}`}
              type="button"
              variant="outline"
              className="w-full min-w-0 max-w-full justify-start overflow-hidden"
              disabled={!editable}
              onClick={() => setMarkdownFieldName(key)}
            >
              <span className={value[key] ? "block min-w-0 flex-1 truncate text-left" : "block min-w-0 flex-1 truncate text-left text-muted-foreground"}>
                {typeof value[key] === "string" && value[key].trim().length > 0 ? value[key] : key}
              </span>
            </Button>
          ) : field.type === "path" ? (
            <PathInput
              id={`metadata-${key}`}
              value={typeof value[key] === "string" ? value[key] : ""}
              required={field.required}
              disabled={!editable}
              onChange={(nextValue) =>
                onChange({
                  ...value,
                  [key]: nextValue || undefined
                })
              }
            />
          ) : field.type === "file_search" ? (
            <PathInput
              id={`metadata-${key}`}
              value={typeof value[key] === "string" ? value[key] : ""}
              required={field.required}
              disabled={!editable}
              onChange={(nextValue) =>
                onChange({
                  ...value,
                  [key]: nextValue || undefined
                })
              }
              placeholder="**/*"
            />
          ) : field.type === "int" || field.type === "float" ? (
            <Input
              id={`metadata-${key}`}
              type="number"
              step={field.type === "int" ? "1" : "any"}
              value={value[key] === undefined ? "" : String(value[key])}
              required={field.required}
              disabled={!editable}
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
              disabled={!editable}
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
      {markdownFieldName && markdownField ? (
        <MarkdownValueDialog
          open
          title={markdownFieldName}
          description="Edit this markdown value."
          initialValue={value[markdownFieldName]}
          onOpenChange={(open) => !open && setMarkdownFieldName(null)}
          onSave={(nextValue) => {
            onChange({
              ...value,
              [markdownFieldName]: nextValue
            });
            setMarkdownFieldName(null);
          }}
        />
      ) : null}
    </div>
  );
}
