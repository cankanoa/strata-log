import { useEffect, useState } from "react";
import { DateTimePicker } from "@/components/forms/date-time-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PathInput } from "@/components/forms/path-input";
import { getSelectableFieldOptions } from "@/lib/attribute-references";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import {
  getFieldOptionDisplayValue,
  formatMetadataValue,
  getFieldChoose,
  getMetadataChoiceToken,
  getMetadataChoiceTokens,
  normalizeMetadataValue,
  parseMetadataValueForField
} from "@/lib/metadata";
import type { FieldDefinition, MetadataValue } from "@/lib/types";

type MetadataValueDialogProps = {
  open: boolean;
  title: string;
  description: string;
  field: FieldDefinition;
  attributeReferenceGroups?: Array<{ label: string; fields: Record<string, FieldDefinition> }>;
  initialValue: MetadataValue;
  saveLabel?: string;
  allowClear?: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (value: MetadataValue) => Promise<void> | void;
};

function normalizeSavedValue(field: FieldDefinition, value: MetadataValue): MetadataValue {
  return normalizeMetadataValue(field, value);
}

export function MetadataValueDialog({
  open,
  title,
  description,
  field,
  attributeReferenceGroups = [],
  initialValue,
  saveLabel = "Save",
  allowClear = false,
  onOpenChange,
  onSave
}: MetadataValueDialogProps) {
  const [value, setValue] = useState<MetadataValue>(initialValue);
  const optionFile = { version: 1 as const, fields: {}, attributeReferenceGroups, entries: [] };
  const effectiveChoose =
    field.type === "attribute_reference" && getFieldChoose(field) !== "multiselect"
      ? "select"
      : getFieldChoose(field);
  const selectableOptions = getSelectableFieldOptions(field, optionFile);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
    }
  }, [initialValue, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {effectiveChoose === "select" ? (
            <div className="grid gap-2">
              <Label>Value</Label>
              <Select
                value={getMetadataChoiceToken(field, value)}
                onValueChange={(nextValue) => setValue(nextValue === "__unset__" ? undefined : nextValue ? parseMetadataValueForField(field, nextValue) : undefined)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a value" />
                </SelectTrigger>
                <SelectContent>
                  {allowClear ? <SelectItem value="__unset__">Unset</SelectItem> : null}
                  {selectableOptions.map((option) => (
                    <SelectItem key={option.raw} value={option.value}>
                      {getFieldOptionDisplayValue(option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : effectiveChoose === "multiselect" ? (
            <div className="grid gap-2">
              <Label>Value</Label>
              <div className="flex flex-wrap gap-2 rounded-md border border-border p-2">
                {selectableOptions.map((option) => {
                  const current = getMetadataChoiceTokens(field, value);
                  const selected = current.includes(option.value);
                  return (
                    <button
                      key={option.raw}
                      type="button"
                      className={selected ? "rounded-md bg-primary px-3 py-1 text-sm text-primary-foreground" : "rounded-md border border-border px-3 py-1 text-sm"}
                      onClick={() =>
                        setValue(
                          (selected ? current.filter((item) => item !== option.value) : [...current, option.value])
                            .map((item) => parseMetadataValueForField(field, item))
                            .filter((item): item is boolean | number | string => item !== undefined)
                        )
                      }
                    >
                      {getFieldOptionDisplayValue(option)}
                    </button>
                  );
                })}
              </div>
            </div>
          ) : field.type === "bool" ? (
            <div className="grid gap-2">
              <Label>Value</Label>
              <Select
                value={typeof value === "boolean" ? String(value) : ""}
                onValueChange={(nextValue) => setValue(nextValue === "__unset__" ? undefined : nextValue === "true")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a value" />
                </SelectTrigger>
                <SelectContent>
                  {allowClear ? <SelectItem value="__unset__">Unset</SelectItem> : null}
                  <SelectItem value="true">True</SelectItem>
                  <SelectItem value="false">False</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : field.type === "datetime" ? (
            <DateTimePicker
              label="Value"
              value={typeof value === "string" ? value : undefined}
              onChange={(nextValue) => setValue(nextValue ?? "")}
            />
          ) : field.type === "path" ? (
            <div className="grid gap-2">
              <Label>Value</Label>
              <PathInput value={typeof value === "string" ? value : ""} onChange={(nextValue) => setValue(nextValue)} />
            </div>
          ) : field.type === "markdown_glob" ? (
            <div className="grid gap-2">
              <Label>Value</Label>
              <Input
                value={typeof value === "string" ? value : ""}
                onChange={(event) => setValue(event.target.value)}
                placeholder="**/*.md"
              />
            </div>
          ) : field.type === "int" || field.type === "float" ? (
            <div className="grid gap-2">
              <Label>Value</Label>
              <Input
                type="number"
                step={field.type === "int" ? "1" : "any"}
                value={value === undefined ? "" : String(value)}
                onChange={(event) =>
                  setValue(
                    event.target.value === ""
                      ? ""
                      : field.type === "int"
                        ? Number.parseInt(event.target.value, 10)
                        : Number.parseFloat(event.target.value)
                  )
                }
              />
            </div>
          ) : (
            <div className="grid gap-2">
              <Label>Value</Label>
              <Input
                value={formatMetadataValue(value)}
                onChange={(event) => setValue(event.target.value)}
              />
            </div>
          )}

          <div className="flex justify-end gap-2">
            {allowClear ? (
              <Button variant="ghost" onClick={() => setValue(undefined)}>
                Clear
              </Button>
            ) : null}
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => void onSave(normalizeSavedValue(field, value))}>{saveLabel}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
