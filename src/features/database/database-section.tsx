import { useMemo, useState } from "react";
import { ChevronDown, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AttributeReferenceOptionsDialog } from "@/features/database/attribute-reference-options-dialog";
import { FieldOptionsDialog } from "@/features/database/field-options-dialog";
import { MetadataValueDialog } from "@/features/database/metadata-value-dialog";
import { getFieldOptionsWithAttributeReferences } from "@/lib/attribute-references";
import {
  getChooseOptionsForFieldType,
  fieldTypeOptions,
  getFieldOptionDisplayValue,
  formatMetadataFieldValue,
  formatMetadataValue,
  getFieldChoose,
  getFieldOptions,
  getMetadataFields,
  parseFieldOption,
  serializeFieldOption,
  supportsOptions
} from "@/lib/metadata";
import { TimeLogDatabase } from "@/lib/time-log-database";
import type { AttributeReferenceGroup, FieldDefinition, MetadataValue, TimeLogFile } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TemplateService } from "@/services/template-service";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";

type EditDialogState =
  | {
      title: string;
      value: string;
      placeholder: string;
      onSave: (value: string) => Promise<boolean> | boolean;
    }
  | null;

type ValueDialogState =
  | {
      title: string;
      description: string;
      field: FieldDefinition;
      initialValue: MetadataValue;
      allowClear?: boolean;
      onSave: (value: MetadataValue) => Promise<void> | void;
    }
  | null;

type OptionsDialogState =
  | {
      title: string;
      description: string;
      field: FieldDefinition;
      initialOptions: string[];
      onSave: (options: string[]) => Promise<void> | void;
    }
  | null;

type AttributeReferenceOptionsDialogState =
  | {
      title: string;
      description: string;
      initialLabels: string[];
      onSave: (labels: string[]) => Promise<void> | void;
    }
  | null;

type FieldRowHandlers = {
  onRename: (name: string) => void;
  onTypeChange: (name: string, field: FieldDefinition, type: FieldDefinition["type"]) => void;
  onChooseChange: (name: string, field: FieldDefinition, choose: NonNullable<FieldDefinition["choose"]>) => void;
  onRequiredChange: (name: string, field: FieldDefinition, required: boolean) => void;
  onEditableChange: (name: string, field: FieldDefinition, editable: boolean) => void;
  onDefaultEdit: (name: string, field: FieldDefinition) => void;
  onOptionsEdit: (name: string, field: FieldDefinition) => void;
  onDelete: (name: string) => void;
};

function withSupportedFieldOptions(field: FieldDefinition): FieldDefinition {
  return supportsOptions(field)
    ? field
    : {
        ...field,
        options: undefined,
      };
}

function FieldCellAction({ value, onClick }: { value: string; onClick: () => void }) {
  return (
    <button type="button" className="inline-flex items-center gap-2 text-left hover:text-foreground" onClick={onClick}>
      <Pencil className="size-3.5 text-muted-foreground" />
      <span>{value || "—"}</span>
    </button>
  );
}

function FieldCreationRow({
  typeOptions,
  onAdd,
  onEditDefault,
  onEditOptions,
}: {
  typeOptions?: FieldDefinition["type"][];
  onAdd: (name: string, field: FieldDefinition) => Promise<boolean | void> | boolean | void;
  onEditDefault: (field: FieldDefinition, setValue: (value: MetadataValue) => void) => void;
  onEditOptions: (field: FieldDefinition, setOptions: (value: string[]) => void) => void;
}) {
  const [nameDraft, setNameDraft] = useState("");
  const [typeDraft, setTypeDraft] = useState<FieldDefinition["type"]>("string");
  const [chooseDraft, setChooseDraft] = useState<NonNullable<FieldDefinition["choose"]>>("single");
  const [optionsDraft, setOptionsDraft] = useState<string[]>([]);
  const [requiredDraft, setRequiredDraft] = useState(false);
  const [editableDraft, setEditableDraft] = useState(true);
  const [defaultDraft, setDefaultDraft] = useState<MetadataValue>(undefined);
  const options = typeOptions ?? fieldTypeOptions;

  const draftField: FieldDefinition = {
    type: typeDraft,
    choose: chooseDraft,
    required: requiredDraft,
    editable: editableDraft,
    default: defaultDraft,
    options: supportsOptions({ type: typeDraft, choose: chooseDraft }) ? optionsDraft : undefined
  };
  const chooseOptions = getChooseOptionsForFieldType(typeDraft);

  return (
    <TableRow>
      <TableCell>
        <Input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} placeholder="Column name" />
      </TableCell>
      <TableCell>
        <Select
          value={typeDraft}
          onValueChange={(value) => {
            const nextType = value as FieldDefinition["type"];
            setTypeDraft(nextType);
            const nextChooseOptions = getChooseOptionsForFieldType(nextType);
            if (!nextChooseOptions.includes(chooseDraft)) {
              setChooseDraft(nextChooseOptions[0]);
            }
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select value={chooseDraft} onValueChange={(value) => setChooseDraft(value as NonNullable<FieldDefinition["choose"]>)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {chooseOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Switch checked={requiredDraft} onCheckedChange={setRequiredDraft} />
      </TableCell>
      <TableCell>
        <Switch checked={editableDraft} onCheckedChange={setEditableDraft} />
      </TableCell>
      <TableCell>
        <button type="button" className="inline-flex items-center gap-2 text-left hover:text-foreground" onClick={() => onEditDefault(draftField, setDefaultDraft)}>
          <Pencil className="size-3.5 text-muted-foreground" />
          <span>{defaultDraft === undefined || defaultDraft === null ? "—" : formatMetadataValue(defaultDraft)}</span>
        </button>
      </TableCell>
      <TableCell>
        {supportsOptions(draftField) ? (
          <FieldCellAction
            value={optionsDraft.map((value) => getFieldOptionDisplayValue(parseFieldOption(value))).join(", ") || "—"}
            onClick={() => onEditOptions(draftField, setOptionsDraft)}
          />
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="icon"
          onClick={async () => {
            const trimmedName = nameDraft.trim();
            if (!trimmedName) {
              toast.error("Column name required", {
                description: "Enter a column name before adding the row."
              });
              return;
            }
            const saved = await onAdd(trimmedName, draftField);
            if (saved === false) {
              return;
            }
            setNameDraft("");
            setTypeDraft("string");
            setChooseDraft("single");
            setOptionsDraft([]);
            setRequiredDraft(false);
            setEditableDraft(true);
            setDefaultDraft(undefined);
          }}
        >
          <Plus className="size-4" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function FieldRows({
  fields,
  handlers,
  typeOptions,
}: {
  fields: Array<[string, FieldDefinition]>;
  handlers: FieldRowHandlers;
  typeOptions?: FieldDefinition["type"][];
}) {
  return fields.map(([name, field]) => (
    <TableRow key={`${field.id ?? "field"}:${name}`}>
      <TableCell>
        <FieldCellAction value={name} onClick={() => handlers.onRename(name)} />
      </TableCell>
      <TableCell>
        <Select
          value={field.type}
          onValueChange={(value) => {
            const nextType = value as FieldDefinition["type"];
            const nextChooseOptions = getChooseOptionsForFieldType(nextType);
            handlers.onTypeChange(name, {
              ...field,
              choose: nextChooseOptions.includes(getFieldChoose(field)) ? getFieldChoose(field) : nextChooseOptions[0]
            }, nextType);
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(typeOptions ?? fieldTypeOptions).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select
          value={getFieldChoose(field)}
          onValueChange={(value) => handlers.onChooseChange(name, field, value as NonNullable<FieldDefinition["choose"]>)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {getChooseOptionsForFieldType(field.type).map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Switch checked={Boolean(field.required)} onCheckedChange={(checked) => handlers.onRequiredChange(name, field, checked)} />
      </TableCell>
      <TableCell>
        <Switch checked={field.editable !== false} onCheckedChange={(checked) => handlers.onEditableChange(name, field, checked)} />
      </TableCell>
      <TableCell>
        <button type="button" className="inline-flex items-center gap-2 text-left hover:text-foreground" onClick={() => handlers.onDefaultEdit(name, field)}>
          <Pencil className="size-3.5 text-muted-foreground" />
          <span>{field.default === undefined || field.default === null ? "—" : formatMetadataFieldValue(field, field.default)}</span>
        </button>
      </TableCell>
      <TableCell>
        {supportsOptions(field) ? (
          <FieldCellAction
            value={getFieldOptions(field).map((option) => getFieldOptionDisplayValue(option)).join(", ") || "—"}
            onClick={() => handlers.onOptionsEdit(name, field)}
          />
        ) : (
          <span className="text-sm text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button variant="ghost" size="icon" onClick={() => handlers.onDelete(name)}>
          <Trash2 className="size-4" />
        </Button>
      </TableCell>
    </TableRow>
  ));
}

export function DatabaseSection() {
  const {
    file,
    openFile,
    unloadFile,
    createFileFromTemplate,
    addField,
    renameField,
    updateField,
    updateFieldAttributeReferences,
    deleteField,
    fillMissingFieldValues,
    addAttributeReferenceGroup,
    renameAttributeReferenceGroup,
    deleteAttributeReferenceGroup,
    addAttributeReferenceField,
    renameAttributeReferenceField,
    updateAttributeReferenceField,
    deleteAttributeReferenceField
  } = useAppStore(
    useShallow((state) => ({
      file: state.file,
      openFile: state.openFile,
      unloadFile: state.unloadFile,
      createFileFromTemplate: state.createFileFromTemplate,
      addField: state.addField,
      renameField: state.renameField,
      updateField: state.updateField,
      updateFieldAttributeReferences: state.updateFieldAttributeReferences,
      deleteField: state.deleteField,
      fillMissingFieldValues: state.fillMissingFieldValues,
      addAttributeReferenceGroup: state.addAttributeReferenceGroup,
      renameAttributeReferenceGroup: state.renameAttributeReferenceGroup,
      deleteAttributeReferenceGroup: state.deleteAttributeReferenceGroup,
      addAttributeReferenceField: state.addAttributeReferenceField,
      renameAttributeReferenceField: state.renameAttributeReferenceField,
      updateAttributeReferenceField: state.updateAttributeReferenceField,
      deleteAttributeReferenceField: state.deleteAttributeReferenceField
    }))
  );

  const [editDialog, setEditDialog] = useState<EditDialogState>(null);
  const [valueDialog, setValueDialog] = useState<ValueDialogState>(null);
  const [optionsDialog, setOptionsDialog] = useState<OptionsDialogState>(null);
  const [attributeReferenceOptionsDialog, setAttributeReferenceOptionsDialog] = useState<AttributeReferenceOptionsDialogState>(null);
  const templates = useMemo(() => TemplateService.listTemplates(), []);
  const regularFields = useMemo(() => getMetadataFields(file?.fields ?? {}), [file]);
  const groupFieldTypes = useMemo(() => fieldTypeOptions.filter((option) => option !== "attribute_reference"), []);

  function openEditDialog(nextDialog: EditDialogState) {
    setEditDialog(nextDialog);
  }

  function openValueDialog(nextDialog: ValueDialogState) {
    setValueDialog(nextDialog);
  }

  function openOptionsDialog(nextDialog: OptionsDialogState) {
    setOptionsDialog(nextDialog);
  }

  function openAttributeReferenceOptionsDialog(nextDialog: AttributeReferenceOptionsDialogState) {
    setAttributeReferenceOptionsDialog(nextDialog);
  }

  function showDatabaseError(title: string, fallback: string) {
    toast.error(title, {
      description: useAppStore.getState().errors[0] ?? fallback
    });
  }

  function openDefaultEditor(save: (value: MetadataValue) => Promise<void> | void, field: FieldDefinition, title: string) {
    openValueDialog({
      title,
      description: "Set the stored value.",
      field,
      initialValue: field.default ?? undefined,
      allowClear: true,
      onSave: async (value) => {
        await save(value);
        setValueDialog(null);
      }
    });
  }

  function openOptionsEditor(save: (options: string[]) => Promise<void> | void, field: FieldDefinition, title: string) {
    openOptionsDialog({
      title,
      description: "Set the display label and saved value for each option.",
      field,
      initialOptions: field.options ?? [],
      onSave: save
    });
  }

  async function createRegularField(name: string, field: FieldDefinition) {
    if (!file) {
      showDatabaseError("Can't add column", "Open or create a database before adding columns.");
      return false;
    }
    if (file.fields[name]) {
      showDatabaseError("Column already exists", `A column named "${name}" already exists.`);
      return false;
    }
    const attributeReferenceLabels =
      field.type === "attribute_reference" ? getFieldOptions(field).map((option) => option.value) : [];
    const fieldToCreate =
      field.type === "attribute_reference"
        ? {
            ...field,
            options: undefined,
          }
        : field;
    const nextFile = TimeLogDatabase.addField(file, name, fieldToCreate);
    const missingCount = field.required ? TimeLogDatabase.countMissingFieldValues(nextFile, name) : 0;
    const saved = await addField(name, {
      ...fieldToCreate,
      required: Boolean(field.required) && missingCount === 0
    });
    if (!saved) {
      showDatabaseError("Couldn't add column", `The column "${name}" could not be created.`);
      return false;
    }
    if (saved && field.type === "attribute_reference" && attributeReferenceLabels.length > 0) {
      const linked = await updateFieldAttributeReferences(name, attributeReferenceLabels);
      if (!linked) {
        showDatabaseError("Couldn't link attribute references", `The references for "${name}" could not be saved.`);
        return false;
      }
    }
    if (saved && field.required && missingCount > 0) {
      openValueDialog({
        title: `Set missing values for ${name}`,
        description: `This required field is missing in ${missingCount} rows. Enter a value to fill them before continuing.`,
        field,
        initialValue: field.default ?? undefined,
        onSave: async (value) => {
          const updated = await updateField(name, { ...field, required: true });
          if (updated) {
            await fillMissingFieldValues(name, value);
          }
          setValueDialog(null);
        }
      });
    }
    return true;
  }

  function openAttributeReferenceFieldEditor(
    name: string,
    field: FieldDefinition,
    choose: NonNullable<FieldDefinition["choose"]> = getFieldChoose(field)
  ) {
    openAttributeReferenceOptionsDialog({
      title: `Attribute References for ${name}`,
      description: "Enter the attribute reference group names this field should offer in Track. Existing names are reused, new ones are created automatically.",
      initialLabels: getFieldOptionsWithAttributeReferences(field, file).map((option) => option.display ?? option.value),
      onSave: async (labels) => {
        const savedReferences = await updateFieldAttributeReferences(name, labels);
        if (savedReferences) {
          const savedField = await updateField(name, { ...field, choose });
          if (savedField) {
            setAttributeReferenceOptionsDialog(null);
          }
        }
      }
    });
  }

  function openAttributeReferenceDraftEditor(
    field: FieldDefinition,
    setOptions: (value: string[]) => void
  ) {
    openAttributeReferenceOptionsDialog({
      title: "Attribute References",
      description: "Enter the attribute reference group names this field should offer in Track. Existing names are reused, new ones are created automatically.",
      initialLabels: (field.options ?? []).map((option) => parseFieldOption(option).display ?? parseFieldOption(option).value),
      onSave: async (labels) => {
        setOptions(
          labels.map((label) =>
            serializeFieldOption({
              display: label,
              value: label,
              raw: ""
            })
          )
        );
        setAttributeReferenceOptionsDialog(null);
      }
    });
  }

  const regularHandlers: FieldRowHandlers = {
    onRename: (name) =>
      openEditDialog({
        title: "Rename Column",
        value: name,
        placeholder: "Column name",
        onSave: (value) => renameField(name, value)
      }),
    onTypeChange: (name, field, type) => void updateField(name, withSupportedFieldOptions({ ...field, type })),
    onChooseChange: (name, field, choose) =>
      void updateField(name, withSupportedFieldOptions({ ...field, choose, options: choose === "single" ? undefined : field.options })),
    onRequiredChange: (name, field, required) => {
      if (!required) {
        void updateField(name, { ...field, required: false });
        return;
      }
      const missingCount = file ? TimeLogDatabase.countMissingFieldValues(file, name) : 0;
      if (missingCount === 0) {
        void updateField(name, { ...field, required: true });
        return;
      }
      openValueDialog({
        title: `Fill required field ${name}`,
        description: `This field is missing in ${missingCount} rows. Enter a value to fill them before saving.`,
        field,
        initialValue: field.default ?? undefined,
        onSave: async (value) => {
          const updated = await updateField(name, { ...field, required: true });
          if (updated) {
            await fillMissingFieldValues(name, value);
          }
          setValueDialog(null);
        }
      });
    },
    onEditableChange: (name, field, editable) => void updateField(name, { ...field, editable }),
    onDefaultEdit: (name, field) =>
      openDefaultEditor(async (value) => {
        await updateField(name, { ...field, default: value });
      }, field, `Default for ${name}`),
    onOptionsEdit: (name, field) => {
      if (field.type === "attribute_reference") {
        openAttributeReferenceFieldEditor(name, field);
        return;
      }
      openOptionsEditor(async (options) => {
        await updateField(name, { ...field, options });
      }, field, `Options for ${name}`);
    },
    onDelete: (name) => void deleteField(name)
  };

  function groupHandlers(group: AttributeReferenceGroup): FieldRowHandlers {
    return {
      onRename: (name) =>
        openEditDialog({
          title: `Rename ${group.label} field`,
          value: name,
          placeholder: "Field name",
          onSave: (value) => renameAttributeReferenceField(group.label, name, value)
        }),
      onTypeChange: (name, field, type) =>
        void updateAttributeReferenceField(group.label, name, withSupportedFieldOptions({ ...field, type })),
      onChooseChange: (name, field, choose) =>
        void updateAttributeReferenceField(
          group.label,
          name,
          withSupportedFieldOptions({ ...field, choose, options: choose === "single" ? undefined : field.options })
        ),
      onRequiredChange: (name, field, required) => void updateAttributeReferenceField(group.label, name, { ...field, required }),
      onEditableChange: (name, field, editable) => void updateAttributeReferenceField(group.label, name, { ...field, editable }),
      onDefaultEdit: (name, field) =>
        openDefaultEditor(
          async (value) => {
            await updateAttributeReferenceField(group.label, name, { ...field, default: value });
          },
          field,
          `${group.label} · ${name}`
        ),
      onOptionsEdit: (name, field) =>
        openOptionsEditor(
          async (options) => {
            await updateAttributeReferenceField(group.label, name, { ...field, options });
          },
          field,
          `${group.label} · ${name}`
        ),
      onDelete: (name) => void deleteAttributeReferenceField(group.label, name)
    };
  }

  return (
    <>
      <Card className="mt-6 border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <CardTitle>Database</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void openFile()}>
              Select
            </Button>
            <div className="flex">
              <Button variant="outline" className="rounded-r-none" onClick={() => void createFileFromTemplate(templates[0]?.id ?? "default")}>
                Create
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger render={<Button variant="outline" className="rounded-l-none border-l-0 px-3" />}>
                  <ChevronDown className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {templates.length > 0 ? templates.map((template) => (
                    <DropdownMenuItem key={template.id} onClick={() => void createFileFromTemplate(template.id)}>
                      {template.name}
                    </DropdownMenuItem>
                  )) : <DropdownMenuItem disabled>No templates available</DropdownMenuItem>}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Button variant="ghost" onClick={unloadFile} disabled={!file}>
              Unload
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!file ? <p className="mb-4 text-sm text-muted-foreground">Select or create a database to load metadata columns from the CSDB file.</p> : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Column</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Choose</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Editable</TableHead>
                <TableHead>Default</TableHead>
                <TableHead>Options</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <FieldRows fields={regularFields} handlers={regularHandlers} />
              <FieldCreationRow
                onAdd={createRegularField}
                onEditDefault={(field, setValue) =>
                  openValueDialog({
                    title: "Set default value",
                    description: "Choose the default value for new entries.",
                    field,
                    initialValue: field.default ?? undefined,
                    allowClear: true,
                    onSave: async (value) => {
                      setValue(value);
                      setValueDialog(null);
                    }
                  })
                }
                onEditOptions={(field, setOptions) =>
                  field.type === "attribute_reference"
                    ? openAttributeReferenceDraftEditor(field, setOptions)
                    : openOptionsDialog({
                        title: "Set options",
                        description: "Set the display label and saved value for each option.",
                        field,
                        initialOptions: field.options ?? [],
                        onSave: async (options) => {
                          setOptions(options);
                        }
                      })
                }
              />
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-6 border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <CardTitle>Attribute References</CardTitle>
          <Button
            variant="outline"
            onClick={() =>
              openEditDialog({
                title: "New Attribute Reference",
                value: "",
                placeholder: "Reference label",
                onSave: (value) => addAttributeReferenceGroup(value)
              })
            }
            disabled={!file}
          >
            <Plus className="mr-2 size-4" />
            Add Reference
          </Button>
        </CardHeader>
        <CardContent className="grid gap-6">
          {(file?.attributeReferenceGroups ?? []).map((group) => (
            <Card key={group.label} className="border-border/70 bg-background/50">
              <CardHeader className="flex flex-row items-start justify-between gap-3">
                <CardTitle className="text-base">{group.label}</CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() =>
                      openEditDialog({
                        title: "Rename Attribute Reference",
                        value: group.label,
                        placeholder: "Reference label",
                        onSave: (value) => renameAttributeReferenceGroup(group.label, value)
                      })
                    }
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => void deleteAttributeReferenceGroup(group.label)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Field</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Choose</TableHead>
                      <TableHead>Required</TableHead>
                      <TableHead>Editable</TableHead>
                      <TableHead>Default</TableHead>
                      <TableHead>Options</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <FieldRows fields={Object.entries(group.fields)} handlers={groupHandlers(group)} typeOptions={groupFieldTypes} />
                    <FieldCreationRow
                      typeOptions={groupFieldTypes}
                      onAdd={async (name, field) => {
                        const saved = await addAttributeReferenceField(group.label, name, field);
                        if (!saved) {
                          showDatabaseError(
                            "Couldn't add attribute reference field",
                            `The field "${name}" could not be added to "${group.label}".`
                          );
                          return false;
                        }
                        return true;
                      }}
                      onEditDefault={(field, setValue) =>
                        openValueDialog({
                          title: `Set default value for ${group.label}`,
                          description: "Choose the default value this reference will apply to sessions.",
                          field,
                          initialValue: field.default ?? undefined,
                          allowClear: true,
                          onSave: async (value) => {
                            setValue(value);
                            setValueDialog(null);
                          }
                        })
                      }
                      onEditOptions={(field, setOptions) =>
                        openOptionsDialog({
                          title: `Set ${group.label} options`,
                          description: "Set the display label and saved value for each option.",
                          field,
                          initialOptions: field.options ?? [],
                          onSave: async (options) => {
                            setOptions(options);
                          }
                        })
                      }
                    />
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
          {!file?.attributeReferenceGroups.length ? (
            <p className="text-sm text-muted-foreground">No attribute references yet. Add one to define reusable field groups.</p>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={Boolean(editDialog)} onOpenChange={(open) => !open && setEditDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editDialog?.title}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <Input
              value={editDialog?.value ?? ""}
              onChange={(event) => setEditDialog((current) => (current ? { ...current, value: event.target.value } : null))}
              placeholder={editDialog?.placeholder ?? ""}
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditDialog(null)}>
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  if (!editDialog) {
                    return;
                  }
                  const saved = await editDialog.onSave(editDialog.value.trim());
                  if (saved) {
                    setEditDialog(null);
                  }
                }}
              >
                Save
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {valueDialog ? (
        <MetadataValueDialog
          open
          title={valueDialog.title}
          description={valueDialog.description}
          field={valueDialog.field}
          attributeReferenceGroups={file?.attributeReferenceGroups ?? []}
          initialValue={valueDialog.initialValue}
          allowClear={valueDialog.allowClear}
          saveLabel="Save"
          onOpenChange={(open) => !open && setValueDialog(null)}
          onSave={async (value) => {
            await valueDialog.onSave(value);
          }}
        />
      ) : null}

      {optionsDialog ? (
        <FieldOptionsDialog
          open
          title={optionsDialog.title}
          description={optionsDialog.description}
          field={optionsDialog.field}
          initialOptions={optionsDialog.initialOptions}
          onOpenChange={(open) => !open && setOptionsDialog(null)}
          onSave={async (options) => {
            await optionsDialog.onSave(options);
          }}
        />
      ) : null}

      {attributeReferenceOptionsDialog ? (
        <AttributeReferenceOptionsDialog
          open
          title={attributeReferenceOptionsDialog.title}
          description={attributeReferenceOptionsDialog.description}
          initialLabels={attributeReferenceOptionsDialog.initialLabels}
          onOpenChange={(open) => !open && setAttributeReferenceOptionsDialog(null)}
          onSave={async (labels) => {
            await attributeReferenceOptionsDialog.onSave(labels);
          }}
        />
      ) : null}
    </>
  );
}
