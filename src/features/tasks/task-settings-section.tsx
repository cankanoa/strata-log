import { useEffect, useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { Github, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FieldOptionsDialog } from "@/features/database/field-options-dialog";
import { MetadataValueDialog } from "@/features/database/metadata-value-dialog";
import { INTERNAL_TASK_BODY_COLUMN_NAME, INTERNAL_TASK_STATUS_COLUMN_NAME, INTERNAL_TASK_TITLE_COLUMN_NAME } from "@/lib/internal-tasks";
import {
  formatMetadataFieldValue,
  getFieldOptionDisplayValue,
  getFieldOptions,
  getFieldSelection,
  getSelectionOptionsForFieldType,
  internalTaskColumnTypeOptions,
  normalizeFieldDefinition,
  parseFieldOption,
  supportsOptions
} from "@/lib/metadata";
import { taskSourceLabel } from "@/lib/task-query";
import type { FieldDefinition, MetadataValue, OnlineAccount, TaskSource, TaskSourceType } from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";

const NO_ACCOUNT = "__none__";
const MANDATORY_INTERNAL_TASK_COLUMNS = [
  INTERNAL_TASK_TITLE_COLUMN_NAME,
  INTERNAL_TASK_STATUS_COLUMN_NAME,
  INTERNAL_TASK_BODY_COLUMN_NAME
];

type ColumnAccessDialogState = {
  title: string;
  selected: string[];
  onSave: (columnNames: string[]) => Promise<void> | void;
} | null;

type ValueDialogState = {
  title: string;
  field: FieldDefinition;
  initialValue: MetadataValue;
  onSave: (value: MetadataValue) => Promise<void> | void;
} | null;

type OptionsDialogState = {
  title: string;
  field: FieldDefinition;
  initialOptions: string[];
  onSave: (options: string[]) => Promise<void> | void;
} | null;

type TaskSettingsSectionGroup = "tasks" | "accounts";

function internalTaskSourceUrl(id: string): string {
  return `internal-task:${id}`;
}

function sourceLabel(type: TaskSourceType): string {
  if (type === "Github") {
    return "Github";
  }
  return type === "Internal Task" ? "Internal Task" : "Markdown";
}

function taskSourceDisplayName(source: TaskSource): string {
  return taskSourceLabel(source);
}

function taskSourceUrlPlaceholder(type: TaskSourceType): string {
  if (type === "Github") {
    return "https://github.com/owner/repo";
  }
  return type === "Internal Task" ? "Columns" : "**/*.md";
}

function fieldSettingLabel(value: string): string {
  return value
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function normalizeInternalColumn(field: FieldDefinition): FieldDefinition {
  const selectionOptions = getSelectionOptionsForFieldType(field.type);
  const selection = selectionOptions.includes(getFieldSelection(field))
    ? getFieldSelection(field)
    : selectionOptions[0];
  return normalizeFieldDefinition({
    ...field,
    selection,
    interval: false,
    visibility: "editable",
    options: supportsOptions({ ...field, selection }) ? field.options : undefined
  });
}

function columnSummary(columnNames: string[]): string {
  return columnNames.length > 0 ? columnNames.join(", ") : "No columns";
}

function ColumnAccessDialog({
  state,
  allColumnNames,
  onOpenChange
}: {
  state: ColumnAccessDialogState;
  allColumnNames: string[];
  onOpenChange: (open: boolean) => void;
}) {
  const [draft, setDraft] = useState<string[]>(state?.selected ?? []);

  useEffect(() => {
    setDraft(state ? [...MANDATORY_INTERNAL_TASK_COLUMNS, ...state.selected.filter((name) => !MANDATORY_INTERNAL_TASK_COLUMNS.includes(name))] : []);
  }, [state]);

  return (
    <Dialog open={Boolean(state)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{state?.title}</DialogTitle>
          <DialogDescription>Select the internal task columns this source can use.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="flex min-h-8 flex-wrap gap-2 rounded-md border border-border p-px">
            {allColumnNames.length > 0 ? allColumnNames.map((name) => {
              const pinned = MANDATORY_INTERNAL_TASK_COLUMNS.includes(name);
              const selected = pinned || draft.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  className={selected ? "inline-flex h-7 items-center rounded-md border border-primary bg-primary px-3 text-sm text-primary-foreground disabled:opacity-70" : "inline-flex h-7 items-center rounded-md border border-border px-3 text-sm"}
                  disabled={pinned}
                  onClick={() => setDraft((current) => selected ? current.filter((item) => item !== name) : [...current, name])}
                >
                  {name}
                </button>
              );
            }) : <span className="text-sm text-muted-foreground">No internal task columns yet.</span>}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={async () => {
              await state?.onSave([...MANDATORY_INTERNAL_TASK_COLUMNS, ...draft.filter((name) => !MANDATORY_INTERNAL_TASK_COLUMNS.includes(name))]);
              onOpenChange(false);
            }}>
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TaskSettingsSection({ sections = ["tasks", "accounts"] }: { sections?: TaskSettingsSectionGroup[] }) {
  const showTasks = sections.includes("tasks");
  const showAccounts = sections.includes("accounts");
  const { file, updateTaskSources, updateInternalTaskColumns, renameInternalTaskColumn, updateAccounts, syncTaskSource } = useAppStore(
    useShallow((state) => ({
      file: state.file,
      updateTaskSources: state.updateTaskSources,
      updateInternalTaskColumns: state.updateInternalTaskColumns,
      renameInternalTaskColumn: state.renameInternalTaskColumn,
      updateAccounts: state.updateAccounts,
      syncTaskSource: state.syncTaskSource
    }))
  );
  const sources = file?.taskSources ?? [];
  const accounts = file?.accounts ?? [];
  const internalColumns = file?.internalTaskColumns ?? {};
  const internalColumnNames = useMemo(() => Object.keys(internalColumns), [internalColumns]);

  const [newSourceType, setNewSourceType] = useState<TaskSourceType>("Markdown");
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceUrl, setNewSourceUrl] = useState("");
  const [newSourceColumnNames, setNewSourceColumnNames] = useState<string[]>(MANDATORY_INTERNAL_TASK_COLUMNS);
  const [newAccountName, setNewAccountName] = useState("");
  const [newAccountToken, setNewAccountToken] = useState("");
  const [newColumnName, setNewColumnName] = useState("");
  const [newColumnType, setNewColumnType] = useState<FieldDefinition["type"]>("string");
  const [newColumnSelection, setNewColumnSelection] = useState<NonNullable<FieldDefinition["selection"]>>("single");
  const [newColumnRequired, setNewColumnRequired] = useState(false);
  const [newColumnDefault, setNewColumnDefault] = useState<MetadataValue>(undefined);
  const [newColumnOptions, setNewColumnOptions] = useState<string[]>([]);
  const [columnAccessDialog, setColumnAccessDialog] = useState<ColumnAccessDialogState>(null);
  const [valueDialog, setValueDialog] = useState<ValueDialogState>(null);
  const [optionsDialog, setOptionsDialog] = useState<OptionsDialogState>(null);

  const newColumnField = normalizeInternalColumn({
    type: newColumnType,
    selection: newColumnSelection,
    required: newColumnRequired,
    visibility: "editable",
    default: newColumnDefault,
    options: newColumnOptions
  });

  async function saveSource(source: TaskSource, patch: Partial<TaskSource>) {
    await updateTaskSources(sources.map((candidate) => candidate.id === source.id ? { ...candidate, ...patch } : candidate));
  }

  async function changeSourceType(source: TaskSource, type: TaskSourceType) {
    await saveSource(source, {
      type,
      url: type === "Internal Task" ? internalTaskSourceUrl(source.id) : source.type === "Internal Task" ? "" : source.url,
      accountId: type === "Github" ? source.accountId : undefined,
      columnNames: type === "Internal Task" ? source.columnNames ?? [] : undefined
    });
  }

  async function addSource() {
    if (newSourceType !== "Internal Task" && !newSourceUrl.trim()) {
      return;
    }
    const id = uuidv4();
    await updateTaskSources([
      ...sources,
      {
        id,
        name: newSourceName.trim() || undefined,
        type: newSourceType,
        url: newSourceType === "Internal Task" ? internalTaskSourceUrl(id) : newSourceUrl.trim(),
        columnNames: newSourceType === "Internal Task" ? newSourceColumnNames : undefined
      }
    ]);
    setNewSourceName("");
    setNewSourceUrl("");
    setNewSourceColumnNames(MANDATORY_INTERNAL_TASK_COLUMNS);
  }

  function openSourceColumnsEditor(source: TaskSource) {
    setColumnAccessDialog({
      title: `Columns for ${taskSourceDisplayName(source)}`,
      selected: source.columnNames ?? [],
      onSave: (columnNames) => saveSource(source, { columnNames })
    });
  }

  function openNewSourceColumnsEditor() {
    setColumnAccessDialog({
      title: "Columns for New Source",
      selected: newSourceColumnNames,
      onSave: setNewSourceColumnNames
    });
  }

  async function syncSource(sourceId: string) {
    const source = sources.find((candidate) => candidate.id === sourceId);
    if (source?.type === "Internal Task") {
      return;
    }
    const result = await syncTaskSource(sourceId);
    if (!result.authRequired) {
      return;
    }
    const token = window.prompt("GitHub token");
    if (token?.trim()) {
      await syncTaskSource(sourceId, token);
    }
  }

  async function syncAllSources() {
    for (const source of sources) {
      await syncSource(source.id);
    }
  }

  async function saveColumn(name: string, patch: Partial<FieldDefinition>) {
    const field = internalColumns[name];
    if (!field) {
      return;
    }
    await updateInternalTaskColumns({
      ...internalColumns,
      [name]: normalizeInternalColumn({
        ...field,
        ...patch
      })
    });
  }

  async function addInternalColumn() {
    const name = newColumnName.trim();
    if (!name || name === "task_source_id" || MANDATORY_INTERNAL_TASK_COLUMNS.includes(name) || internalColumns[name]) {
      return;
    }
    await updateInternalTaskColumns({
      ...internalColumns,
      [name]: newColumnField
    });
    setNewColumnName("");
    setNewColumnType("string");
    setNewColumnSelection("single");
    setNewColumnRequired(false);
    setNewColumnDefault(undefined);
    setNewColumnOptions([]);
  }

  async function saveAccount(account: OnlineAccount, patch: Partial<OnlineAccount>) {
    await updateAccounts(accounts.map((candidate) => candidate.id === account.id ? { ...candidate, ...patch } : candidate));
  }

  async function addAccount() {
    if (!newAccountName.trim() || !newAccountToken.trim()) {
      return;
    }
    await updateAccounts([
      ...accounts,
      {
        id: uuidv4(),
        type: "Github",
        name: newAccountName.trim(),
        token: newAccountToken.trim()
      }
    ]);
    setNewAccountName("");
    setNewAccountToken("");
  }

  return (
    <div className="grid gap-6">
      {showTasks ? (
      <Card className="border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
        <CardHeader>
          <CardTitle>Task Sources</CardTitle>
          <CardAction>
            <Button type="button" variant="outline" size="sm" disabled={!file || sources.every((source) => source.type === "Internal Task")} onClick={() => void syncAllSources()}>
              <RefreshCw className="size-4" />
              Sync
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">Type</TableHead>
                <TableHead className="w-48">Name</TableHead>
                <TableHead>URL</TableHead>
                <TableHead className="w-48">Account</TableHead>
                <TableHead className="w-36 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sources.map((source) => (
                <TableRow key={source.id}>
                  <TableCell>
                    <Select value={source.type} onValueChange={(value) => void changeSourceType(source, value as TaskSourceType)}>
                      <SelectTrigger className="w-full">
                        <SelectValue>{sourceLabel(source.type)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Markdown">Markdown</SelectItem>
                        <SelectItem value="Github">Github</SelectItem>
                        <SelectItem value="Internal Task">Internal Task</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Input
                      key={source.name ?? ""}
                      defaultValue={source.name ?? ""}
                      onBlur={(event) => void saveSource(source, { name: event.target.value.trim() || undefined })}
                      placeholder={taskSourceDisplayName(source)}
                    />
                  </TableCell>
                  <TableCell>
                    {source.type === "Internal Task" ? (
                      <div className="flex min-w-0 items-center gap-2">
                        <Button type="button" variant="ghost" size="icon-xs" onClick={() => openSourceColumnsEditor(source)}>
                          <Pencil className="size-3.5" />
                        </Button>
                        <span className="min-w-0 truncate text-sm text-muted-foreground">{columnSummary(source.columnNames ?? [])}</span>
                      </div>
                    ) : (
                      <Input
                        key={source.url}
                        defaultValue={source.url}
                        onBlur={(event) => {
                          const url = event.target.value.trim();
                          if (url && url !== source.url) {
                            void saveSource(source, { url });
                          }
                        }}
                        placeholder={taskSourceUrlPlaceholder(source.type)}
                      />
                    )}
                  </TableCell>
                  <TableCell>
                    {source.type === "Github" ? (
                      <Select
                        value={source.accountId ?? NO_ACCOUNT}
                        onValueChange={(value) => {
                          const accountId = value && value !== NO_ACCOUNT ? String(value) : undefined;
                          void saveSource(source, { accountId });
                        }}
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue>{accounts.find((account) => account.id === source.accountId)?.name ?? "None"}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_ACCOUNT}>None</SelectItem>
                          {accounts.map((account) => (
                            <SelectItem key={account.id} value={account.id}>
                              {account.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span className="text-muted-foreground">None</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end gap-1">
                      {source.type !== "Internal Task" ? (
                        <Button type="button" variant="ghost" size="icon" onClick={() => void syncSource(source.id)}>
                          <RefreshCw className="size-4" />
                        </Button>
                      ) : null}
                      <Button type="button" variant="ghost" size="icon" onClick={() => void updateTaskSources(sources.filter((candidate) => candidate.id !== source.id))}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell>
                  <Select value={newSourceType} onValueChange={(value) => setNewSourceType(value as TaskSourceType)} disabled={!file}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{sourceLabel(newSourceType)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Markdown">Markdown</SelectItem>
                      <SelectItem value="Github">Github</SelectItem>
                      <SelectItem value="Internal Task">Internal Task</SelectItem>
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Input
                    value={newSourceName}
                    disabled={!file}
                    onChange={(event) => setNewSourceName(event.target.value)}
                    placeholder="Optional"
                  />
                </TableCell>
                <TableCell>
                  {newSourceType === "Internal Task" ? (
                    <div className="flex min-w-0 items-center gap-2">
                      <Button type="button" variant="outline" size="icon" disabled={!file} onClick={openNewSourceColumnsEditor}>
                        <Pencil className="size-4" />
                      </Button>
                      <span className="min-w-0 truncate text-sm text-muted-foreground">{columnSummary(newSourceColumnNames)}</span>
                    </div>
                  ) : (
                    <Input
                      value={newSourceUrl}
                      disabled={!file}
                      onChange={(event) => setNewSourceUrl(event.target.value)}
                      placeholder={taskSourceUrlPlaceholder(newSourceType)}
                    />
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">New source</TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button type="button" size="icon" disabled={!file || (newSourceType !== "Internal Task" && !newSourceUrl.trim())} onClick={() => void addSource()}>
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      ) : null}

      {showTasks ? (
      <Card className="border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
        <CardHeader>
          <CardTitle>Internal Task Columns</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead className="w-40">Type</TableHead>
                <TableHead className="w-40">Selection</TableHead>
                <TableHead className="w-24">Required</TableHead>
                <TableHead>Default</TableHead>
                <TableHead>Options</TableHead>
                <TableHead className="w-20 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Object.entries(internalColumns).map(([name, field]) => {
                const isMandatoryColumn = MANDATORY_INTERNAL_TASK_COLUMNS.includes(name);
                return (
                <TableRow key={`${field.id ?? "column"}:${name}`} className={isMandatoryColumn ? "bg-muted/40 text-muted-foreground" : undefined}>
                  <TableCell>
                    <Input
                      key={name}
                      defaultValue={name}
                      disabled={isMandatoryColumn}
                      onBlur={(event) => {
                        const nextName = event.target.value.trim();
                        if (nextName && nextName !== name) {
                          void renameInternalTaskColumn(name, nextName);
                        }
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <Select
                      value={field.type}
                      disabled={isMandatoryColumn}
                      onValueChange={(value) => {
                        const type = value as FieldDefinition["type"];
                        const selection = getSelectionOptionsForFieldType(type)[0];
                        void saveColumn(name, { type, selection, options: undefined, default: null });
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>{fieldSettingLabel(field.type)}</SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {internalTaskColumnTypeOptions.map((option) => (
                          <SelectItem key={option} value={option}>
                            {fieldSettingLabel(option)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Select value={getFieldSelection(field)} disabled={isMandatoryColumn} onValueChange={(value) => void saveColumn(name, { selection: value as NonNullable<FieldDefinition["selection"]>, options: value === "single" ? undefined : field.options })}>
                      <SelectTrigger className="w-full">
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
                    <Switch checked={Boolean(field.required)} disabled={isMandatoryColumn} onCheckedChange={(required) => void saveColumn(name, { required })} />
                  </TableCell>
                  <TableCell>
                    <button type="button" className="inline-flex items-center gap-2 text-left hover:text-foreground disabled:opacity-60" disabled={isMandatoryColumn} onClick={() => setValueDialog({ title: `Default for ${name}`, field, initialValue: field.default ?? undefined, onSave: (value) => saveColumn(name, { default: value }) })}>
                      <Pencil className="size-3.5 text-muted-foreground" />
                      <span>{field.default === undefined || field.default === null ? "—" : formatMetadataFieldValue(field, field.default)}</span>
                    </button>
                  </TableCell>
                  <TableCell>
                    {supportsOptions(field) ? (
                      <button type="button" className="inline-flex items-center gap-2 text-left hover:text-foreground disabled:opacity-60" disabled={isMandatoryColumn} onClick={() => setOptionsDialog({ title: `Options for ${name}`, field, initialOptions: field.options ?? [], onSave: (options) => saveColumn(name, { options }) })}>
                        <Pencil className="size-3.5 text-muted-foreground" />
                        <span>{getFieldOptions(field).map((option) => getFieldOptionDisplayValue(option)).join(", ") || "—"}</span>
                      </button>
                    ) : (
                      <span className="text-sm text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button type="button" variant="ghost" size="icon" disabled={isMandatoryColumn} onClick={() => {
                        const { [name]: _removed, ...nextColumns } = internalColumns;
                        void updateInternalTaskColumns(nextColumns);
                      }}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
                );
              })}
              <TableRow>
                <TableCell>
                  <Input value={newColumnName} disabled={!file} onChange={(event) => setNewColumnName(event.target.value)} placeholder="Column name" />
                </TableCell>
                <TableCell>
                  <Select
                    value={newColumnType}
                    disabled={!file}
                    onValueChange={(value) => {
                      const type = value as FieldDefinition["type"];
                      setNewColumnType(type);
                      setNewColumnSelection(getSelectionOptionsForFieldType(type)[0]);
                      setNewColumnOptions([]);
                      setNewColumnDefault(undefined);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>{fieldSettingLabel(newColumnType)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {internalTaskColumnTypeOptions.map((option) => (
                        <SelectItem key={option} value={option}>
                          {fieldSettingLabel(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Select value={newColumnSelection} disabled={!file} onValueChange={(value) => setNewColumnSelection(value as NonNullable<FieldDefinition["selection"]>)}>
                    <SelectTrigger className="w-full">
                      <SelectValue>{fieldSettingLabel(newColumnSelection)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {getSelectionOptionsForFieldType(newColumnType).map((option) => (
                        <SelectItem key={option} value={option}>
                          {fieldSettingLabel(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Switch checked={newColumnRequired} disabled={!file} onCheckedChange={setNewColumnRequired} />
                </TableCell>
                <TableCell>
                  <button type="button" className="inline-flex items-center gap-2 text-left hover:text-foreground disabled:opacity-50" disabled={!file} onClick={() => setValueDialog({ title: "Default for New Column", field: newColumnField, initialValue: newColumnDefault, onSave: setNewColumnDefault })}>
                    <Pencil className="size-3.5 text-muted-foreground" />
                    <span>{newColumnDefault === undefined || newColumnDefault === null ? "—" : formatMetadataFieldValue(newColumnField, newColumnDefault)}</span>
                  </button>
                </TableCell>
                <TableCell>
                  {supportsOptions(newColumnField) ? (
                    <button type="button" className="inline-flex items-center gap-2 text-left hover:text-foreground disabled:opacity-50" disabled={!file} onClick={() => setOptionsDialog({ title: "Options for New Column", field: newColumnField, initialOptions: newColumnOptions, onSave: setNewColumnOptions })}>
                      <Pencil className="size-3.5 text-muted-foreground" />
                      <span>{newColumnOptions.map((option) => getFieldOptionDisplayValue(parseFieldOption(option))).join(", ") || "—"}</span>
                    </button>
                  ) : (
                    <span className="text-sm text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button type="button" size="icon" disabled={!file || !newColumnName.trim() || MANDATORY_INTERNAL_TASK_COLUMNS.includes(newColumnName.trim())} onClick={() => void addInternalColumn()}>
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      ) : null}

      {showAccounts ? (
      <Card className="border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
        <CardHeader>
          <CardTitle>Online Accounts</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">Type</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Username</TableHead>
                <TableHead>Token</TableHead>
                <TableHead className="w-20 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map((account) => (
                <TableRow key={account.id}>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <Github className="size-4" />
                      Github
                    </span>
                  </TableCell>
                  <TableCell>
                    <Input key={account.name} defaultValue={account.name} onBlur={(event) => void saveAccount(account, { name: event.target.value.trim() || account.name })} />
                  </TableCell>
                  <TableCell>
                    <Input key={account.username} defaultValue={account.username ?? ""} onBlur={(event) => void saveAccount(account, { username: event.target.value.trim() || undefined })} />
                  </TableCell>
                  <TableCell>
                    <Input key={account.token} type="password" defaultValue={account.token ?? ""} onBlur={(event) => void saveAccount(account, { token: event.target.value.trim() || undefined })} />
                  </TableCell>
                  <TableCell>
                    <div className="flex justify-end">
                      <Button type="button" variant="ghost" size="icon" onClick={() => void updateAccounts(accounts.filter((candidate) => candidate.id !== account.id))}>
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <Github className="size-4" />
                    Github
                  </span>
                </TableCell>
                <TableCell>
                  <Input value={newAccountName} disabled={!file} onChange={(event) => setNewAccountName(event.target.value)} placeholder="Personal" />
                </TableCell>
                <TableCell className="text-muted-foreground">Optional</TableCell>
                <TableCell>
                  <Input type="password" value={newAccountToken} disabled={!file} onChange={(event) => setNewAccountToken(event.target.value)} placeholder="Token" />
                </TableCell>
                <TableCell>
                  <div className="flex justify-end">
                    <Button type="button" size="icon" disabled={!file || !newAccountName.trim() || !newAccountToken.trim()} onClick={() => void addAccount()}>
                      <Plus className="size-4" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      ) : null}

      <ColumnAccessDialog
        state={columnAccessDialog}
        allColumnNames={internalColumnNames}
        onOpenChange={(open) => !open && setColumnAccessDialog(null)}
      />

      {valueDialog ? (
        <MetadataValueDialog
          open
          title={valueDialog.title}
          description="Set the default value for this internal task column."
          field={valueDialog.field}
          initialValue={valueDialog.initialValue}
          allowClear
          onOpenChange={(open) => !open && setValueDialog(null)}
          onSave={async (value) => {
            await valueDialog.onSave(value);
            setValueDialog(null);
          }}
        />
      ) : null}

      {optionsDialog ? (
        <FieldOptionsDialog
          open
          title={optionsDialog.title}
          description="Set the display label and saved value for each option."
          field={optionsDialog.field}
          initialOptions={optionsDialog.initialOptions}
          onOpenChange={(open) => !open && setOptionsDialog(null)}
          onSave={async (options) => {
            await optionsDialog.onSave(options);
          }}
        />
      ) : null}
    </div>
  );
}
