import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { DateTimePicker } from "@/components/forms/date-time-picker";
import { PathInput } from "@/components/forms/path-input";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  formatMetadataValue,
  normalizeMetadataValue,
  parseFieldOption,
  parseMetadataValueForField,
  serializeCellValue,
  serializeFieldOption
} from "@/lib/metadata";
import type { FieldDefinition, MetadataValue } from "@/lib/types";

type OptionDraft = {
  display: string;
  value: MetadataValue;
};

type OptionEditorProps = {
  option: OptionDraft;
  onChange: (patch: Partial<OptionDraft>) => void;
};

type FieldOptionsDialogProps = {
  open: boolean;
  title: string;
  description: string;
  field: FieldDefinition;
  initialOptions: string[];
  onOpenChange: (open: boolean) => void;
  onSave: (options: string[]) => Promise<boolean | void> | boolean | void;
};

function createOptionDraft(field: FieldDefinition, raw = ""): OptionDraft {
  const parsed = parseFieldOption(raw);
  return {
    display: parsed.display ?? "",
    value: parseMetadataValueForField(
      {
        ...field,
        selection: "single"
      },
      parsed.value
    )
  };
}

function OptionDisplayInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <Input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Optional label"
    />
  );
}

function StringOptionEditor({ option, onChange }: OptionEditorProps) {
  return (
    <Input
      value={formatMetadataValue(option.value)}
      onChange={(event) => onChange({ value: event.target.value })}
      placeholder="Saved value"
    />
  );
}

function UuidOptionEditor({ option, onChange }: OptionEditorProps) {
  return (
    <Input
      value={typeof option.value === "string" ? option.value : ""}
      onChange={(event) => onChange({ value: event.target.value })}
      placeholder="00000000-0000-0000-0000-000000000000"
    />
  );
}

function BoolOptionEditor({ option, onChange }: OptionEditorProps) {
  return (
    <div className="flex min-h-10 items-center rounded-md border border-input px-3">
      <Switch
        checked={option.value === true}
        onCheckedChange={(checked) => onChange({ value: checked })}
      />
    </div>
  );
}

function IntOptionEditor({ option, onChange }: OptionEditorProps) {
  return (
    <Input
      type="number"
      step="1"
      value={option.value === undefined ? "" : String(option.value)}
      onChange={(event) =>
        onChange({
          value: event.target.value === "" ? undefined : Number.parseInt(event.target.value, 10),
        })
      }
      placeholder="Saved value"
    />
  );
}

function FloatOptionEditor({ option, onChange }: OptionEditorProps) {
  return (
    <Input
      type="number"
      step="any"
      value={option.value === undefined ? "" : String(option.value)}
      onChange={(event) =>
        onChange({
          value: event.target.value === "" ? undefined : Number.parseFloat(event.target.value),
        })
      }
      placeholder="Saved value"
    />
  );
}

function PathOptionEditor({ option, onChange }: OptionEditorProps) {
  return (
    <PathInput
      value={typeof option.value === "string" ? option.value : ""}
      onChange={(value) => onChange({ value })}
      placeholder="Saved path"
    />
  );
}

function FileSearchOptionEditor({ option, onChange }: OptionEditorProps) {
  return (
    <PathInput
      value={typeof option.value === "string" ? option.value : ""}
      onChange={(value) => onChange({ value })}
      placeholder="**/*"
    />
  );
}

function DateTimeOptionEditor({ option, onChange }: OptionEditorProps) {
  return (
    <DateTimePicker
      label="Value"
      value={typeof option.value === "string" ? option.value : undefined}
      onChange={(value) => onChange({ value: value ?? undefined })}
      placeholder="Enter datetime"
    />
  );
}

function TypeOptionEditor({
  field,
  option,
  onChange,
}: {
  field: FieldDefinition;
  option: OptionDraft;
  onChange: (patch: Partial<OptionDraft>) => void;
}) {
  switch (field.type) {
    case "uuid":
      return <UuidOptionEditor option={option} onChange={onChange} />;
    case "bool":
      return <BoolOptionEditor option={option} onChange={onChange} />;
    case "int":
      return <IntOptionEditor option={option} onChange={onChange} />;
    case "float":
      return <FloatOptionEditor option={option} onChange={onChange} />;
    case "path":
      return <PathOptionEditor option={option} onChange={onChange} />;
    case "file_search":
      return <FileSearchOptionEditor option={option} onChange={onChange} />;
    case "datetime":
      return <DateTimeOptionEditor option={option} onChange={onChange} />;
    case "attribute_reference":
    case "string":
    default:
      return <StringOptionEditor option={option} onChange={onChange} />;
  }
}

function OptionRow({
  field,
  option,
  onChange,
  onRemove,
}: {
  field: FieldDefinition;
  option: OptionDraft;
  onChange: (patch: Partial<OptionDraft>) => void;
  onRemove: () => void;
}) {
  return (
    <TableRow>
      <TableCell className="align-top">
        <TypeOptionEditor field={field} option={option} onChange={onChange} />
      </TableCell>
      <TableCell className="align-top">
        <OptionDisplayInput value={option.display} onChange={(value) => onChange({ display: value })} />
      </TableCell>
      <TableCell className="w-14 align-top">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onRemove}
        >
          <Trash2 className="size-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

export function FieldOptionsDialog({
  open,
  title,
  description,
  field,
  initialOptions,
  onOpenChange,
  onSave
}: FieldOptionsDialogProps) {
  const [options, setOptions] = useState<OptionDraft[]>([]);
  const [newOption, setNewOption] = useState<OptionDraft>(createOptionDraft(field));
  const singleValueField: FieldDefinition = {
    ...field,
    selection: "single"
  };
  const initialOptionsKey = initialOptions.join("\u001f");

  useEffect(() => {
    if (!open) {
      return;
    }
    setOptions(
      initialOptions.length > 0
        ? initialOptions.map((option) => createOptionDraft(singleValueField, option))
        : []
    );
    setNewOption(createOptionDraft(singleValueField));
  }, [field.type, initialOptionsKey, open]);

  function updateOption(index: number, patch: Partial<OptionDraft>) {
    setOptions((current) =>
      current.map((option, optionIndex) =>
        optionIndex === index
          ? {
              ...option,
              ...patch
            }
          : option
      )
    );
  }

  function removeOption(index: number) {
    setOptions((current) => current.filter((_, optionIndex) => optionIndex !== index));
  }

  function appendNewOption() {
    setOptions((current) => [...current, newOption]);
    setNewOption(createOptionDraft(singleValueField));
  }

  async function handleSave() {
    const nextOptions = options
      .map((option) => ({
        display: option.display.trim(),
        value: normalizeMetadataValue(singleValueField, option.value)
      }))
      .filter((option) => option.display.length > 0 || option.value !== undefined)
      .map((option) =>
        serializeFieldOption({
          display: option.display || serializeCellValue(singleValueField, option.value),
          value: serializeCellValue(singleValueField, option.value) || option.display,
          raw: ""
        })
      );

    const saved = await onSave(nextOptions);
    if (saved === false) {
      return;
    }
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Value</TableHead>
                <TableHead>Display</TableHead>
                <TableHead className="w-14" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {options.map((option, index) => (
                <OptionRow
                  key={index}
                  field={singleValueField}
                  option={option}
                  onChange={(patch) => updateOption(index, patch)}
                  onRemove={() => removeOption(index)}
                />
              ))}
              <TableRow>
                <TableCell className="align-top">
                  <TypeOptionEditor
                    field={singleValueField}
                    option={newOption}
                    onChange={(patch) =>
                      setNewOption((current) => ({
                        ...current,
                        ...patch,
                      }))
                    }
                  />
                </TableCell>
                <TableCell className="align-top">
                  <OptionDisplayInput
                    value={newOption.display}
                    onChange={(value) =>
                      setNewOption((current) => ({
                        ...current,
                        display: value,
                      }))
                    }
                  />
                </TableCell>
                <TableCell className="w-14 align-top">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={appendNewOption}
                  >
                    <Plus className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>

          <div className="flex justify-end gap-2">
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void handleSave()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
