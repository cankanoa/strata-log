import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { Circle, CircleCheck, CircleMinus, Download, FilePlus, Link, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { AttributeReferenceOptionsDialog } from "@/features/database/attribute-reference-options-dialog";
import { DatabaseReferenceSyncDialog } from "@/features/database/database-reference-sync-dialog";
import { FieldOptionValueResolutionDialog } from "@/features/database/field-option-value-resolution-dialog";
import { FieldOptionsDialog } from "@/features/database/field-options-dialog";
import { MetadataValueDialog } from "@/features/database/metadata-value-dialog";
import { getFieldOptionsWithAttributeReferences } from "@/lib/attribute-references";
import {
  getSelectionOptionsForFieldType,
  fieldTypeOptions,
  getFieldOptionDisplayValue,
  formatMetadataFieldValue,
  formatMetadataValue,
  getFieldSelection,
  getFieldVisibilityOptions,
  getFieldOptions,
  getMetadataFields,
  normalizeFieldVisibility,
  parseFieldOption,
  serializeFieldOption,
  supportsOptions
} from "@/lib/metadata";
import {
  TimeLogDatabase,
  type FieldOptionValueChange,
  type FieldOptionValueResolution
} from "@/lib/time-log-database";
import {
  createDatabaseRegistryEntry,
  parseDatabaseRegistry,
  serializeDatabaseRegistry,
  setActiveDatabaseEntry,
  type DatabaseLocation,
  type DatabaseRegistryEntry
} from "@/lib/database-registry";
import {
  getDatabaseReferenceStatuses,
  removeDatabaseReferences,
  type DatabaseReferenceStatus
} from "@/lib/database-registry-sync";
import { getPlatformApi } from "@/lib/platform";
import type { AttributeReferenceGroup, FieldDefinition, MetadataValue, TimeLogFile } from "@/lib/types";
import { serializeTimeLogYaml } from "@/lib/yaml";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
      onSave: (options: string[]) => Promise<boolean | void> | boolean | void;
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

type DatabaseFileInfo = {
  path: string;
  exists: boolean;
  updatedAt: string | null;
};

type FieldRowHandlers = {
  onRename: (name: string) => void;
  onTypeChange: (name: string, field: FieldDefinition, type: FieldDefinition["type"]) => void;
  onSelectionChange: (name: string, field: FieldDefinition, selection: NonNullable<FieldDefinition["selection"]>) => void;
  onIntervalChange: (name: string, field: FieldDefinition, interval: boolean) => void;
  onRequiredChange: (name: string, field: FieldDefinition, required: boolean) => void;
  onVisibilityChange: (name: string, field: FieldDefinition, visibility: NonNullable<FieldDefinition["visibility"]>) => void;
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

function fieldSettingLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function runButtonAction(event: MouseEvent<HTMLButtonElement>, action: () => Promise<void> | void) {
  event.preventDefault();
  event.stopPropagation();
  void action();
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
  const [selectionDraft, setSelectionDraft] = useState<NonNullable<FieldDefinition["selection"]>>("single");
  const [optionsDraft, setOptionsDraft] = useState<string[]>([]);
  const [intervalDraft, setIntervalDraft] = useState(false);
  const [requiredDraft, setRequiredDraft] = useState(false);
  const [visibilityDraft, setVisibilityDraft] = useState<NonNullable<FieldDefinition["visibility"]>>("editable");
  const [defaultDraft, setDefaultDraft] = useState<MetadataValue>(undefined);
  const options = typeOptions ?? fieldTypeOptions;

  const draftField: FieldDefinition = {
    type: typeDraft,
    selection: selectionDraft,
    interval: intervalDraft,
    required: requiredDraft,
    visibility: visibilityDraft,
    default: defaultDraft,
    options: supportsOptions({ type: typeDraft, selection: selectionDraft, visibility: visibilityDraft }) ? optionsDraft : undefined
  };
  const selectionOptions = getSelectionOptionsForFieldType(typeDraft);

  return (
    <TableRow>
      <TableCell>
        <Input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} placeholder="Name" />
      </TableCell>
      <TableCell>
        <Select
          value={typeDraft}
          onValueChange={(value) => {
            const nextType = value as FieldDefinition["type"];
            setTypeDraft(nextType);
            const nextSelectionOptions = getSelectionOptionsForFieldType(nextType);
            if (!nextSelectionOptions.includes(selectionDraft)) {
              setSelectionDraft(nextSelectionOptions[0]);
            }
            if (visibilityDraft === "addable" && !["select", "multiselect"].includes(nextSelectionOptions.includes(selectionDraft) ? selectionDraft : nextSelectionOptions[0])) {
              setVisibilityDraft("editable");
            }
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue>{fieldSettingLabel(typeDraft)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option} value={option}>
                {fieldSettingLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select
          value={selectionDraft}
          onValueChange={(value) => {
            const nextSelection = value as NonNullable<FieldDefinition["selection"]>;
            setSelectionDraft(nextSelection);
            if (visibilityDraft === "addable" && !["select", "multiselect"].includes(nextSelection)) {
              setVisibilityDraft("editable");
            }
          }}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue>{fieldSettingLabel(selectionDraft)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {selectionOptions.map((option) => (
              <SelectItem key={option} value={option}>
                {fieldSettingLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Switch checked={intervalDraft} onCheckedChange={setIntervalDraft} />
      </TableCell>
      <TableCell>
        <Switch checked={requiredDraft} onCheckedChange={setRequiredDraft} />
      </TableCell>
      <TableCell>
        <Select
          value={visibilityDraft}
          onValueChange={(value) => setVisibilityDraft(value as NonNullable<FieldDefinition["visibility"]>)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue>{fieldSettingLabel(visibilityDraft)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {getFieldVisibilityOptions(draftField).map((option) => (
              <SelectItem key={option} value={option}>
                {fieldSettingLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
              toast.error("Name required", {
                description: "Enter a name before adding the row."
              });
              return;
            }
            const saved = await onAdd(trimmedName, draftField);
            if (saved === false) {
              return;
            }
            setNameDraft("");
            setTypeDraft("string");
            setSelectionDraft("single");
            setOptionsDraft([]);
            setIntervalDraft(false);
            setRequiredDraft(false);
            setVisibilityDraft("editable");
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
            const nextSelectionOptions = getSelectionOptionsForFieldType(nextType);
            const nextSelection = nextSelectionOptions.includes(getFieldSelection(field)) ? getFieldSelection(field) : nextSelectionOptions[0];
            handlers.onTypeChange(name, {
              ...field,
              selection: nextSelection,
              visibility: !["select", "multiselect"].includes(nextSelection) && normalizeFieldVisibility(field) === "addable" ? "editable" : field.visibility
            }, nextType);
          }}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue>{fieldSettingLabel(field.type)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(typeOptions ?? fieldTypeOptions).map((option) => (
              <SelectItem key={option} value={option}>
                {fieldSettingLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Select
          value={getFieldSelection(field)}
          onValueChange={(value) => handlers.onSelectionChange(name, field, value as NonNullable<FieldDefinition["selection"]>)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue>{fieldSettingLabel(getFieldSelection(field))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {getSelectionOptionsForFieldType(field.type).map((option) => (
              <SelectItem key={option} value={option}>
                {fieldSettingLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Switch checked={Boolean(field.interval)} onCheckedChange={(checked) => handlers.onIntervalChange(name, field, checked)} />
      </TableCell>
      <TableCell>
        <Switch checked={Boolean(field.required)} onCheckedChange={(checked) => handlers.onRequiredChange(name, field, checked)} />
      </TableCell>
      <TableCell>
        <Select
          value={normalizeFieldVisibility(field)}
          onValueChange={(value) => handlers.onVisibilityChange(name, field, value as NonNullable<FieldDefinition["visibility"]>)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue>{fieldSettingLabel(normalizeFieldVisibility(field))}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {getFieldVisibilityOptions(field).map((option) => (
              <SelectItem key={option} value={option}>
                {fieldSettingLabel(option)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
    fileHandle,
    loadDatabaseFile,
    unloadFile,
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
      fileHandle: state.fileHandle,
      loadDatabaseFile: state.loadDatabaseFile,
      unloadFile: state.unloadFile,
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
  const [pendingOptionResolution, setPendingOptionResolution] = useState<{
    name: string;
    nextField: FieldDefinition;
    changes: FieldOptionValueChange[];
  } | null>(null);
  const [attributeReferenceOptionsDialog, setAttributeReferenceOptionsDialog] = useState<AttributeReferenceOptionsDialogState>(null);
  const [databaseEntries, setDatabaseEntries] = useState<DatabaseRegistryEntry[]>([]);
  const [databaseFileInfo, setDatabaseFileInfo] = useState<Record<string, DatabaseFileInfo>>({});
  const [missingDatabaseReferences, setMissingDatabaseReferences] = useState<DatabaseReferenceStatus[]>([]);
  const [databaseDraftLocation, setDatabaseDraftLocation] = useState<DatabaseLocation>("Internal");
  const [databaseDraftUrl, setDatabaseDraftUrl] = useState("");
  const [databaseTemplateId, setDatabaseTemplateId] = useState("blank");
  const templates = useMemo(() => TemplateService.listTemplates(), []);
  const regularFields = useMemo(() => getMetadataFields(file?.fields ?? {}), [file]);
  const groupFieldTypes = useMemo(() => fieldTypeOptions.filter((option) => option !== "attribute_reference"), []);

  function setDatabaseFileInfoFromStatuses(statuses: DatabaseReferenceStatus[]) {
    setDatabaseFileInfo(
      Object.fromEntries(
        statuses.map((status) => [
          status.entry.id,
          {
            path: status.resolvedPath,
            exists: status.exists,
            updatedAt: status.updatedAt
          }
        ])
      )
    );
  }

  async function resolveDatabaseFileInfo(entries: DatabaseRegistryEntry[]) {
    const statuses = await Promise.all(
      entries.map(async (entry): Promise<DatabaseReferenceStatus> => {
        const info = await getPlatformApi().getDatabaseFileInfo({ location: entry.location, url: entry.url });
        return {
          entry,
          resolvedPath: info?.path ?? "",
          exists: Boolean(info?.exists),
          updatedAt: info?.updatedAt ?? null
        };
      })
    );
    setDatabaseFileInfoFromStatuses(statuses);
  }

  async function saveDatabaseEntries(entries: DatabaseRegistryEntry[]) {
    await getPlatformApi().saveDatabaseRegistry(serializeDatabaseRegistry(entries));
    setDatabaseEntries(entries);
    await resolveDatabaseFileInfo(entries);
  }

  async function addManagedDatabaseReference(location: DatabaseLocation, url: string) {
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      return false;
    }
    const duplicate = databaseEntries.some((entry) => entry.location === location && entry.url === trimmedUrl);
    if (duplicate) {
      toast.error("Database already exists", {
        description: "That database is already in the manager."
      });
      return false;
    }
    await saveDatabaseEntries([...databaseEntries, createDatabaseRegistryEntry(location, trimmedUrl)]);
    return true;
  }

  async function loadDatabaseEntries() {
    const raw = await getPlatformApi().readDatabaseRegistry();
    const entries = raw.trim().length > 0 ? parseDatabaseRegistry(raw) : [];
    setDatabaseEntries(entries);
    await resolveDatabaseFileInfo(entries);
  }

  useEffect(() => {
    void loadDatabaseEntries();
  }, []);

  async function syncManagedDatabaseReferences() {
    const statuses = await getDatabaseReferenceStatuses();
    setDatabaseEntries(statuses.map((status) => status.entry));
    setDatabaseFileInfoFromStatuses(statuses);
    const missing = statuses.filter((status) => !status.exists);
    setMissingDatabaseReferences(missing);
    if (missing.length === 0) {
      toast.success("Database references are synced.");
    }
  }

  async function removeMissingManagedDatabaseReferences() {
    const removedActiveFile = missingDatabaseReferences.some((status) => status.resolvedPath && status.resolvedPath === fileHandle?.path);
    const nextEntries = await removeDatabaseReferences(missingDatabaseReferences.map((status) => status.entry));
    setDatabaseEntries(nextEntries);
    await resolveDatabaseFileInfo(nextEntries);
    setMissingDatabaseReferences([]);
    if (removedActiveFile) {
      unloadFile();
    }
    toast.success("Removed missing database references.");
  }

  function databaseTemplateRaw(): string {
    const template = TemplateService.getTemplate(databaseTemplateId) ?? TemplateService.getTemplate("blank") ?? templates[0];
    return serializeTimeLogYaml(template!.content);
  }

  function formatDatabaseUpdatedAt(updatedAt: string | null | undefined): string {
    if (!updatedAt) {
      return "—";
    }
    return new Intl.DateTimeFormat(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit"
    }).format(new Date(updatedAt));
  }

  function databaseDisplayName(entry: DatabaseRegistryEntry): string {
    const value = entry.location === "Internal" ? entry.url : entry.url.split(/[\\/]/).pop() ?? entry.url;
    return value.replace(/\.csdb$/i, "");
  }

  async function updateManagedDatabaseEntry(entry: DatabaseRegistryEntry, registryUrl: string) {
    const nextEntries = databaseEntries.map((candidate) =>
      candidate.id === entry.id
        ? {
            ...candidate,
            url: registryUrl
          }
        : candidate
    );
    await saveDatabaseEntries(nextEntries);
    return nextEntries.find((candidate) => candidate.id === entry.id);
  }

  async function renameManagedDatabase(entry: DatabaseRegistryEntry, name: string) {
    const nextName = name.trim().replace(/\.csdb$/i, "");
    if (!nextName) {
      toast.error("Database name required");
      return false;
    }
    const expectedUrl = entry.location === "Internal"
      ? nextName
      : entry.url.replace(/[^\\/]+$/, `${nextName}.csdb`);
    const duplicate = databaseEntries.some((candidate) =>
      candidate.id !== entry.id && candidate.location === entry.location && candidate.url === expectedUrl
    );
    if (duplicate) {
      toast.error("Database already exists", {
        description: "Another database already uses that name."
      });
      return false;
    }
    const wasActive = isActiveManagedDatabase(entry);
    const renamed = await getPlatformApi().renameDatabaseFile({
      location: entry.location,
      url: entry.url,
      name: nextName
    });
    if (!renamed) {
      toast.error("Couldn't rename database", {
        description: "Check that the file exists and the new name is not already in use."
      });
      return false;
    }
    const nextEntry = await updateManagedDatabaseEntry(entry, renamed.registryUrl);
    if (wasActive && nextEntry) {
      await loadDatabaseFile({ location: nextEntry.location, url: nextEntry.url });
    }
    return true;
  }

  function openDatabaseRenameDialog(entry: DatabaseRegistryEntry) {
    openEditDialog({
      title: "Rename Database",
      value: databaseDisplayName(entry),
      placeholder: "Database name",
      onSave: (value) => renameManagedDatabase(entry, value)
    });
  }

  async function chooseExternalDatabaseUrl() {
    const url = await getPlatformApi().chooseDatabaseUrl(databaseDraftUrl || "strata-log");
    if (url) {
      setDatabaseDraftUrl(url);
    }
  }

  async function importManagedDatabase() {
    const imported = await getPlatformApi().importDatabaseFile();
    if (!imported) {
      return;
    }
    await addManagedDatabaseReference("Internal", imported.registryUrl);
  }

  async function referenceManagedDatabase() {
    const referenced = await getPlatformApi().referenceDatabaseFile();
    if (!referenced) {
      return;
    }
    await addManagedDatabaseReference("Path", referenced.registryUrl);
  }

  async function exportManagedDatabase(entry: DatabaseRegistryEntry) {
    if (entry.location !== "Internal") {
      return;
    }
    const exported = await getPlatformApi().exportDatabaseFile({ url: entry.url });
    if (!exported) {
      toast.error("Couldn't export database", {
        description: "Check that the internal database file exists."
      });
      return;
    }
    toast.success("Database exported.");
  }

  async function createManagedDatabase() {
    const url = databaseDraftUrl.trim();
    if (!url) {
      toast.error(databaseDraftLocation === "Internal" ? "Database name required" : "Database URL required");
      return;
    }
    const registryUrl = databaseDraftLocation === "Internal" ? url.replace(/\.csdb$/i, "") : url;
    if (databaseEntries.some((entry) => entry.location === databaseDraftLocation && entry.url === registryUrl)) {
      toast.error("Database already exists", {
        description: "That database is already in the manager."
      });
      return;
    }
    const created = await getPlatformApi().createDatabaseFile({
      location: databaseDraftLocation,
      url,
      raw: databaseTemplateRaw()
    });
    if (!created) {
      return;
    }
    const entry = createDatabaseRegistryEntry(databaseDraftLocation, created.registryUrl);
    const loaded = await loadDatabaseFile({ location: entry.location, url: entry.url });
    await saveDatabaseEntries(setActiveDatabaseEntry([...databaseEntries, entry], loaded ? entry.id : null));
    setDatabaseDraftUrl("");
  }

  async function removeManagedDatabase(entry: DatabaseRegistryEntry) {
    const wasActive = isActiveManagedDatabase(entry);
    await saveDatabaseEntries(databaseEntries.filter((candidate) => candidate.id !== entry.id));
    if (wasActive) {
      unloadFile();
    }
  }

  function isActiveManagedDatabase(entry: DatabaseRegistryEntry) {
    return Boolean(entry.activeDatabase && fileHandle?.path && databaseFileInfo[entry.id]?.path === fileHandle.path);
  }

  async function loadManagedDatabase(entry: DatabaseRegistryEntry) {
    if (isActiveManagedDatabase(entry)) {
      unloadFile();
      await saveDatabaseEntries(setActiveDatabaseEntry(databaseEntries, null));
      return;
    }
    const loaded = await loadDatabaseFile({ location: entry.location, url: entry.url });
    if (!loaded) {
      showDatabaseError("Couldn't load database", `The database "${entry.url}" could not be loaded.`);
      return;
    }
    await saveDatabaseEntries(setActiveDatabaseEntry(databaseEntries, entry.id));
  }

  async function deleteManagedDatabase(entry: DatabaseRegistryEntry) {
    const wasActive = isActiveManagedDatabase(entry);
    await getPlatformApi().deleteDatabaseFile({ location: entry.location, url: entry.url });
    await removeManagedDatabase(entry);
    if (wasActive) {
      unloadFile();
    }
  }

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

  function openOptionsEditor(
    save: (options: string[]) => Promise<boolean | void> | boolean | void,
    field: FieldDefinition,
    title: string
  ) {
    openOptionsDialog({
      title,
      description: "Set the display label and saved value for each option.",
      field,
      initialOptions: field.options ?? [],
      onSave: save
    });
  }

  async function saveRegularFieldOptions(name: string, field: FieldDefinition, options: string[]) {
    const nextField = { ...field, options };
    const changes = file ? TimeLogDatabase.getFieldOptionValueChanges(file, name, nextField) : [];
    if (changes.length > 0) {
      setPendingOptionResolution({ name, nextField, changes });
      return false;
    }
    const saved = await updateField(name, nextField);
    if (saved) {
      setOptionsDialog(null);
    }
    return saved;
  }

  async function resolveOptionValues(resolution: FieldOptionValueResolution) {
    if (!pendingOptionResolution) {
      return;
    }
    const saved = await updateField(
      pendingOptionResolution.name,
      pendingOptionResolution.nextField,
      {
        changes: pendingOptionResolution.changes,
        resolution
      }
    );
    if (saved) {
      setPendingOptionResolution(null);
      setOptionsDialog(null);
    }
  }

  async function createRegularField(name: string, field: FieldDefinition) {
    if (!file) {
      showDatabaseError("Can't add name", "Open or create a database before adding names.");
      return false;
    }
    if (file.fields[name]) {
      showDatabaseError("Name already exists", `A name called "${name}" already exists.`);
      return false;
    }
    const nextFile = TimeLogDatabase.addField(file, name, field);
    const missingCount = field.required ? TimeLogDatabase.countMissingFieldValues(nextFile, name) : 0;
    const saved = await addField(name, {
      ...field,
      required: Boolean(field.required) && missingCount === 0
    });
    if (!saved) {
      showDatabaseError("Couldn't add name", `The name "${name}" could not be created.`);
      return false;
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
    field: FieldDefinition
  ) {
    openAttributeReferenceOptionsDialog({
      title: `Attribute References for ${name}`,
      description: "Enter the attribute reference group names this field should offer in Track. Existing names are reused, new ones are created automatically.",
      initialLabels: getFieldOptionsWithAttributeReferences(field, file).map((option) => option.value),
      onSave: async (labels) => {
        const savedReferences = await updateFieldAttributeReferences(name, labels);
        if (savedReferences) {
          setAttributeReferenceOptionsDialog(null);
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
      initialLabels: (field.options ?? []).map((option) => parseFieldOption(option).value),
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
        title: "Rename Name",
        value: name,
        placeholder: "Name",
        onSave: (value) => renameField(name, value)
      }),
    onTypeChange: (name, field, type) => void updateField(name, withSupportedFieldOptions({ ...field, type })),
    onSelectionChange: (name, field, selection) =>
      void updateField(name, withSupportedFieldOptions({
        ...field,
        selection,
        visibility: selection === "single" && normalizeFieldVisibility(field) === "addable" ? "editable" : field.visibility,
        options: selection === "single" ? undefined : field.options
      })),
    onIntervalChange: (name, field, interval) => void updateField(name, { ...field, interval }),
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
    onVisibilityChange: (name, field, visibility) =>
      void updateField(name, {
        ...field,
        visibility
      }),
    onDefaultEdit: (name, field) =>
      openDefaultEditor(async (value) => {
        await updateField(name, { ...field, default: value });
      }, field, `Default for ${name}`),
    onOptionsEdit: (name, field) => {
      if (field.type === "attribute_reference") {
        openAttributeReferenceFieldEditor(name, field);
        return;
      }
      openOptionsEditor((options) => saveRegularFieldOptions(name, field, options), field, `Options for ${name}`);
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
      onSelectionChange: (name, field, selection) =>
        void updateAttributeReferenceField(
          group.label,
          name,
          withSupportedFieldOptions({
            ...field,
            selection,
            visibility: selection === "single" && normalizeFieldVisibility(field) === "addable" ? "editable" : field.visibility,
            options: selection === "single" ? undefined : field.options
          })
        ),
      onIntervalChange: (name, field, interval) => void updateAttributeReferenceField(group.label, name, { ...field, interval }),
      onRequiredChange: (name, field, required) => void updateAttributeReferenceField(group.label, name, { ...field, required }),
      onVisibilityChange: (name, field, visibility) =>
        void updateAttributeReferenceField(group.label, name, {
          ...field,
          visibility
        }),
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

  function renderManagedDatabasesTable() {
    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Location</TableHead>
            <TableHead>URL</TableHead>
            <TableHead>Updated/template</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {databaseEntries.map((entry) => (
            <TableRow key={entry.id} className={isActiveManagedDatabase(entry) ? "bg-primary/5 hover:bg-primary/10" : undefined}>
              <TableCell>{entry.location}</TableCell>
              <TableCell>
                <div className="flex min-w-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    onClick={(event) => runButtonAction(event, () => openDatabaseRenameDialog(entry))}
                    title="Rename database"
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <span className="min-w-0 truncate font-mono text-xs">{entry.url}</span>
                </div>
              </TableCell>
              <TableCell className="text-sm text-muted-foreground">
                {formatDatabaseUpdatedAt(databaseFileInfo[entry.id]?.updatedAt)}
              </TableCell>
              <TableCell className="text-right">
                {entry.location === "Internal" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(event) => runButtonAction(event, () => exportManagedDatabase(entry))}
                    title="Export database"
                  >
                    <Download className="size-4" />
                  </Button>
                ) : null}
                {entry.location === "Path" ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(event) => runButtonAction(event, () => removeManagedDatabase(entry))}
                    title="Remove from app"
                  >
                    <CircleMinus className="size-4" />
                  </Button>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(event) => runButtonAction(event, () => deleteManagedDatabase(entry))}
                  title="Delete file"
                >
                  <Trash2 className="size-4" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={(event) => runButtonAction(event, () => loadManagedDatabase(entry))}
                  title={isActiveManagedDatabase(entry) ? "Unload database" : "Load database"}
                >
                  {isActiveManagedDatabase(entry) ? <CircleCheck className="size-4" /> : <Circle className="size-4" />}
                </Button>
              </TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell>
              <Select value={databaseDraftLocation} onValueChange={(value) => setDatabaseDraftLocation(value as DatabaseLocation)}>
                <SelectTrigger className="w-[140px]">
                  <SelectValue>{databaseDraftLocation}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Internal">Internal</SelectItem>
                  <SelectItem value="Path">Path</SelectItem>
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell>
              <div className="flex gap-2">
                <Input
                  value={databaseDraftUrl}
                  onChange={(event) => setDatabaseDraftUrl(event.target.value)}
                  placeholder={databaseDraftLocation === "Internal" ? "Database name" : "Database URL"}
                />
                {databaseDraftLocation === "Path" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={(event) => runButtonAction(event, chooseExternalDatabaseUrl)}
                  >
                    <FilePlus className="size-4" />
                  </Button>
                ) : null}
              </div>
            </TableCell>
            <TableCell>
              <Select value={databaseTemplateId} onValueChange={(value) => value && setDatabaseTemplateId(value)}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue>{templates.find((template) => template.id === databaseTemplateId)?.name ?? "Blank"}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {templates.map((template) => (
                    <SelectItem key={template.id} value={template.id}>
                      {template.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </TableCell>
            <TableCell className="text-right">
              <Button type="button" size="icon" onClick={(event) => runButtonAction(event, createManagedDatabase)}>
                <Plus className="size-4" />
              </Button>
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
  }

  return (
    <>
      <Card className="border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Manage Databases</CardTitle>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={(event) => runButtonAction(event, syncManagedDatabaseReferences)}
              title="Sync database references"
            >
              <RefreshCw className="size-4" />
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={(event) => runButtonAction(event, importManagedDatabase)}>
              <Upload className="size-4" />
              Import
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={(event) => runButtonAction(event, referenceManagedDatabase)}>
              <Link className="size-4" />
              Reference
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {renderManagedDatabasesTable()}
        </CardContent>
      </Card>

      <Card className="mt-6 border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
        <CardHeader className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <CardTitle>Fields</CardTitle>
        </CardHeader>
        <CardContent>
          {!file ? <p className="mb-4 text-sm text-muted-foreground">Manage databases to load metadata names from a CSDB file.</p> : null}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Selection</TableHead>
                <TableHead>Interval</TableHead>
                <TableHead>Required</TableHead>
                <TableHead>Visibility</TableHead>
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
                    description: "Select the default value for new entries.",
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
                      <TableHead>Selection</TableHead>
                      <TableHead>Interval</TableHead>
                      <TableHead>Required</TableHead>
                      <TableHead>Visibility</TableHead>
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
                          description: "Select the default value this reference will apply to sessions.",
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

      <DatabaseReferenceSyncDialog
        open={missingDatabaseReferences.length > 0}
        missingReferences={missingDatabaseReferences}
        onKeep={() => setMissingDatabaseReferences([])}
        onRemove={removeMissingManagedDatabaseReferences}
      />

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
            return optionsDialog.onSave(options);
          }}
        />
      ) : null}

      {pendingOptionResolution ? (
        <FieldOptionValueResolutionDialog
          open
          fieldName={pendingOptionResolution.name}
          changes={pendingOptionResolution.changes}
          onOpenChange={(open) => !open && setPendingOptionResolution(null)}
          onResolve={resolveOptionValues}
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
