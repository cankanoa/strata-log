import { Fragment, useEffect, useMemo, useState, type Dispatch, type DragEvent, type ReactNode, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import {
  ArrowDown,
  ArrowDownWideNarrow,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Columns3Cog,
  Filter,
  GripVertical,
  Group as GroupIcon,
  LayoutList,
  Pencil,
  Plus,
  Trash2,
  X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { SyncButton } from "@/components/ui/sync-button";
import { ChooseTaskItem, type TaskItemTypeFilter } from "@/components/task/choose-task-item";
import { MarkdownValueDialog } from "@/components/forms/markdown-value-dialog";
import { MetadataValueDialog } from "@/features/database/metadata-value-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getFieldSelection } from "@/lib/metadata";
import { INTERNAL_TASK_BODY_COLUMN_NAME, INTERNAL_TASK_STATUS_COLUMN_NAME, INTERNAL_TASK_TITLE_COLUMN_NAME } from "@/lib/internal-tasks";
import { taskDisplayRows, taskReferenceKey, taskSourceCreationGroups, taskSourceLabelForTask, type TaskSourceChoice } from "@/lib/task-query";
import { filterTaskDisplayRowsBySourceUrls, filterTaskSourceChoiceGroupsBySourceUrls, getTrackTaskSourceFilterUrls } from "@/lib/task-source-filters";
import { extractMarkdownFieldsFromData } from "@/lib/markdown-task-identity";
import type { ActiveTaskReference, FieldDefinition, MetadataValue, TaskDisplayRow, TaskFieldMetadata, TaskSource } from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";
import { getCachedSettingsRow, replaceSettingsRow, SETTINGS_ROWS } from "@/lib/app-settings";

type TaskTreeRow = {
  task: TaskDisplayRow;
  depth: number;
  children: TaskDisplayRow[];
};

type TaskTableValueType = "string" | "number" | "bool" | "datetime" | "multi";

type TaskTableColumn = {
  id: string;
  title: string;
  type: TaskTableValueType;
  defaultVisible?: boolean;
  value: (task: TaskDisplayRow, sourcesById: Map<string, TaskSource>) => unknown;
  render?: (task: TaskDisplayRow, sourcesById: Map<string, TaskSource>) => ReactNode;
};

type ColumnState = {
  id: string;
  visible: boolean;
};

type FilterLink = "where" | "and" | "or";
type FilterOperator =
  | "contains"
  | "not_contains"
  | "equals"
  | "not_equals"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "is_true"
  | "is_false";

type FilterState = {
  id: string;
  link: FilterLink;
  columnId: string | null;
  operator: FilterOperator | null;
  value: string;
  enabled: boolean;
};

type SortState = {
  id: string;
  columnId: string | null;
  direction: "asc" | "desc";
  enabled: boolean;
};

type TaskViewMode = "small-table" | "large-table" | "small-kanban" | "large-kanban";

type TaskRowGroup = {
  key: string;
  title: string;
  value: MetadataValue;
  unset: boolean;
  rows: TaskTreeRow[];
};

const UNSET_GROUP_SELECT_VALUE = "__unset__";
const UNSET_GROUP_KEY = "__unset__";
const ALL_TASKS_GROUP_KEY = "__all_tasks__";
const MARKDOWN_ADMIN_DATA_KEYS = new Set([
  "__strata",
  "checked",
  "content",
  "filePath",
  "parentIssue",
  "parentUrl",
  "rank",
  "status",
  "title",
  "url"
]);
const GITHUB_ISSUE_EDITABLE_PATHS = new Set([
  "assignees",
  "body",
  "contents",
  "labels",
  "milestone",
  "parentUrl",
  "state",
  "state_reason",
  "status",
  "title",
  "type"
]);

function sortTasks(tasks: TaskDisplayRow[], sourcesById: Map<string, TaskSource>): TaskDisplayRow[] {
  return [...tasks].sort((left, right) => {
    const sourceCompare = taskSourceLabelForTask(sourcesById.get(left.sourceId), left).localeCompare(taskSourceLabelForTask(sourcesById.get(right.sourceId), right));
    return sourceCompare === 0 ? left.rank.localeCompare(right.rank) : sourceCompare;
  });
}

function getPathValue(value: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, part) => {
    if (current === undefined || current === null) {
      return undefined;
    }
    if (Array.isArray(current)) {
      return current[Number(part)];
    }
    return typeof current === "object" ? (current as Record<string, unknown>)[part] : undefined;
  }, value);
}

function editablePathForColumn(column: TaskTableColumn): string | null {
  if (column.id === "contents") {
    return "title";
  }
  if (column.id === "body") {
    return "body";
  }
  if (column.id === "status") {
    return "status";
  }
  if (column.id.startsWith("data:")) {
    return column.id.slice("data:".length);
  }
  return null;
}

function flattenPaths(value: unknown, prefix = ""): string[] {
  if (value === null || value === undefined || typeof value !== "object") {
    return prefix ? [prefix] : [];
  }
  const ownPath = prefix ? [prefix] : [];
  if (Array.isArray(value)) {
    return [
      ...ownPath,
      ...value.flatMap((item, index) => flattenPaths(item, prefix ? `${prefix}.${index}` : String(index)))
    ];
  }
  const entries = Object.entries(value as Record<string, unknown>);
  return [
    ...ownPath,
    ...entries.flatMap(([key, child]) => flattenPaths(child, prefix ? `${prefix}.${key}` : key))
  ];
}

function inferColumnType(values: unknown[]): TaskTableValueType {
  if (values.some(Array.isArray)) {
    return "multi";
  }
  const present = values.filter((value) => value !== undefined && value !== null && value !== "");
  if (present.length === 0) {
    return "string";
  }
  if (present.every((value) => typeof value === "boolean")) {
    return "bool";
  }
  if (present.every((value) => typeof value === "number")) {
    return "number";
  }
  if (present.every((value) => typeof value === "string" && !Number.isNaN(Date.parse(value)))) {
    return "datetime";
  }
  return "string";
}

function taskColumns(
  tasks: TaskDisplayRow[],
  internalTaskColumns: Record<string, FieldDefinition>,
  activeTaskKeys: Set<string>,
  onActiveChange: (task: TaskDisplayRow, active: boolean) => void
): TaskTableColumn[] {
  const standardColumns: TaskTableColumn[] = [
    {
      id: "active",
      title: "Active",
      type: "bool",
      defaultVisible: true,
      value: (task) => activeTaskKeys.has(taskReferenceKey({ taskId: task.id, table: task.taskTable })),
      render: (task) => (
        <Switch
          checked={activeTaskKeys.has(taskReferenceKey({ taskId: task.id, table: task.taskTable }))}
          onCheckedChange={(active) => onActiveChange(task, active)}
        />
      )
    },
    { id: "status", title: "Status", type: "string", defaultVisible: true, value: (task) => task.status === false ? "Closed" : "Open" },
    { id: "contents", title: "Title", type: "string", defaultVisible: true, value: (task) => task.contents },
    { id: "body", title: "Body", type: "string", defaultVisible: true, value: (task) => getPathValue(task.data, "body") },
    { id: "source", title: "Source", type: "string", defaultVisible: true, value: (task, sourcesById) => taskSourceLabelForTask(sourcesById.get(task.sourceId), task) },
    { id: "url", title: "URL", type: "string", defaultVisible: true, value: (task) => task.url },
    { id: "uuid", title: "UUID", type: "string", defaultVisible: false, value: (task) => task.id },
    { id: "parentUrl", title: "Parent URL", type: "string", defaultVisible: false, value: (task) => task.parentUrl },
    { id: "rank", title: "Rank", type: "string", defaultVisible: false, value: (task) => task.rank },
    { id: "hash", title: "Hash", type: "string", defaultVisible: false, value: (task) => task.hash },
    { id: "byteLength", title: "Byte Length", type: "number", defaultVisible: false, value: (task) => task.byteLength },
    { id: "data", title: "Data", type: "string", defaultVisible: false, value: (task) => task.data }
  ];
  const standardDataPaths = new Set<string>([
    INTERNAL_TASK_TITLE_COLUMN_NAME,
    INTERNAL_TASK_STATUS_COLUMN_NAME,
    INTERNAL_TASK_BODY_COLUMN_NAME
  ]);
  const dataPaths = [
    ...new Set([
      ...tasks.flatMap((task) => flattenPaths(task.data)),
      ...Object.keys(internalTaskColumns)
    ])
  ].filter((path) => !standardDataPaths.has(path)).sort((left, right) => left.localeCompare(right));
  const dataColumns = dataPaths.map<TaskTableColumn>((path) => ({
    id: `data:${path}`,
    title: path,
    type: inferColumnType(tasks.map((task) => getPathValue(task.data, path))),
    defaultVisible: false,
    value: (task) => getPathValue(task.data, path)
  }));
  return [...standardColumns, ...dataColumns];
}

function formatCellValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "—";
  }
  if (Array.isArray(value)) {
    return value.map(formatCellValue).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function metadataValueFromUnknown(value: unknown): MetadataValue {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) =>
      typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? [item] : []
    );
  }
  return JSON.stringify(value);
}

function groupValueForRow(row: TaskTreeRow, column: TaskTableColumn, sourcesById: Map<string, TaskSource>): MetadataValue {
  if (column.id === "status") {
    return row.task.status === false ? false : true;
  }
  return metadataValueFromUnknown(column.value(row.task, sourcesById));
}

function isUnsetGroupValue(value: MetadataValue): boolean {
  return value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

function groupTitle(column: TaskTableColumn, value: MetadataValue, unset: boolean): string {
  if (unset) {
    return "Unset";
  }
  if (column.id === "status") {
    return value === false ? "Closed" : "Open";
  }
  return formatCellValue(value);
}

function groupKey(value: MetadataValue, unset: boolean): string {
  return unset ? UNSET_GROUP_KEY : normalizeScalar(value);
}

function taskRowGroups(
  rows: TaskTreeRow[],
  column: TaskTableColumn | null,
  sourcesById: Map<string, TaskSource>,
  createUnsetGroup: boolean
): TaskRowGroup[] {
  if (!column) {
    return [{ key: ALL_TASKS_GROUP_KEY, title: "Tasks", value: undefined, unset: false, rows }];
  }
  const groups = new Map<string, TaskRowGroup>();
  if (createUnsetGroup) {
    groups.set(UNSET_GROUP_KEY, { key: UNSET_GROUP_KEY, title: "Unset", value: undefined, unset: true, rows: [] });
  }
  rows.forEach((row) => {
    const value = groupValueForRow(row, column, sourcesById);
    const unset = isUnsetGroupValue(value);
    const key = groupKey(value, unset);
    const group = groups.get(key) ?? {
      key,
      title: groupTitle(column, value, unset),
      value,
      unset,
      rows: []
    };
    group.rows.push(row);
    groups.set(key, group);
  });
  return [...groups.values()];
}

function fieldMetadataToDefinition(field: TaskFieldMetadata): FieldDefinition {
  return {
    type: field.type === "markdown" ? "markdown" : field.type === "number" ? "float" : field.type === "bool" ? "bool" : field.type === "datetime" ? "datetime" : "string",
    selection: field.type === "multiselect" ? "multiselect" : field.type === "select" ? "select" : "single",
    visibility: "editable",
    options: field.options
  };
}

function draftInputText(value: MetadataValue): string {
  if (value === undefined || value === null) {
    return "";
  }
  return Array.isArray(value) ? value.map(String).join(", ") : String(value);
}

function parseDraftInput(field: TaskFieldMetadata, value: string): MetadataValue {
  if (field.type === "number") {
    const parsed = Number.parseFloat(value);
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  if (field.type === "multiselect") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return value;
}

function getFieldTypeFromSelection(field: FieldDefinition): TaskFieldMetadata["type"] {
  if (field.type === "markdown") {
    return "markdown";
  }
  const selection = getFieldSelection(field);
  return selection === "multiselect" ? "multiselect" : selection === "select" ? "select" : "string";
}

function taskFieldValue(task: TaskDisplayRow, path: string): MetadataValue {
  const raw = path === "title"
    ? task.contents
    : path === "status"
      ? task.status ?? true
      : getPathValue(task.data, path);
  if (Array.isArray(raw)) {
    return raw.map((item) => {
      if (item && typeof item === "object" && "name" in item) {
        return String((item as { name?: unknown }).name ?? "");
      }
      if (item && typeof item === "object" && "login" in item) {
        return String((item as { login?: unknown }).login ?? "");
      }
      return typeof item === "string" || typeof item === "number" || typeof item === "boolean" ? item : JSON.stringify(item);
    }).filter((item): item is string | number | boolean => item !== "");
  }
  if (raw && typeof raw === "object") {
    if ("title" in raw) {
      return String((raw as { title?: unknown }).title ?? "");
    }
    if ("name" in raw) {
      return String((raw as { name?: unknown }).name ?? "");
    }
    if ("login" in raw) {
      return String((raw as { login?: unknown }).login ?? "");
    }
  }
  return typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean" ? raw : undefined;
}

function controlId() {
  return globalThis.crypto?.randomUUID?.() ?? Math.random().toString(16).slice(2);
}

function createFilterRow(link: FilterLink = "or"): FilterState {
  return {
    id: controlId(),
    link,
    columnId: null,
    operator: null,
    value: "",
    enabled: true
  };
}

function createSortRow(): SortState {
  return {
    id: controlId(),
    columnId: null,
    direction: "asc",
    enabled: true
  };
}

function updateFilter(filters: FilterState[], id: string, patch: Partial<FilterState>) {
  return filters.map((filter) => filter.id === id ? { ...filter, ...patch } : filter);
}

function removeFilter(filters: FilterState[], id: string) {
  return filters
    .filter((filter) => filter.id !== id)
    .map((filter, index) => index === 0 ? { ...filter, link: "where" as const } : filter);
}

function updateSort(sorts: SortState[], id: string, patch: Partial<SortState>) {
  return sorts.map((sort) => sort.id === id ? { ...sort, ...patch } : sort);
}

function getOperatorsForType(type: TaskTableValueType): FilterOperator[] {
  if (type === "number" || type === "datetime") {
    return ["equals", "not_equals", "gt", "gte", "lt", "lte"];
  }
  if (type === "bool") {
    return ["is_true", "is_false"];
  }
  if (type === "multi") {
    return ["equals", "not_equals"];
  }
  return ["equals", "not_equals", "contains", "not_contains"];
}

function defaultOperatorForType(type: TaskTableValueType): FilterOperator {
  return type === "bool" ? "is_true" : "equals";
}

function operatorLabel(operator: FilterOperator) {
  switch (operator) {
    case "contains":
      return "in";
    case "not_contains":
      return "not in";
    case "equals":
      return "=";
    case "not_equals":
      return "!=";
    case "gt":
      return ">";
    case "gte":
      return ">=";
    case "lt":
      return "<";
    case "lte":
      return "<=";
    case "is_true":
      return "is true";
    case "is_false":
      return "is false";
  }
}

function valuePlaceholder(type: TaskTableValueType) {
  switch (type) {
    case "number":
      return "Number";
    case "datetime":
      return "Date time";
    case "multi":
      return "List item";
    case "bool":
      return "True false";
    case "string":
      return "Value";
  }
}

function normalizeScalar(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (Array.isArray(value)) {
    return value.map(normalizeScalar).join(", ");
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return String(value);
}

function compareNumeric(operator: FilterOperator, rowValue: unknown, value: string) {
  const left = Number(rowValue);
  const right = Number(value);
  if (!Number.isFinite(left) || !Number.isFinite(right)) {
    return false;
  }
  switch (operator) {
    case "equals":
      return left === right;
    case "not_equals":
      return left !== right;
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    default:
      return false;
  }
}

function compareDateTime(operator: FilterOperator, rowValue: unknown, value: string) {
  const left = Date.parse(normalizeScalar(rowValue));
  const right = Date.parse(value);
  if (Number.isNaN(left) || Number.isNaN(right)) {
    return false;
  }
  switch (operator) {
    case "equals":
      return left === right;
    case "not_equals":
      return left !== right;
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
    default:
      return false;
  }
}

function compareText(operator: FilterOperator, rowValue: unknown, value: string) {
  const haystack = normalizeScalar(rowValue).toLowerCase();
  const needle = value.trim().toLowerCase();
  switch (operator) {
    case "contains":
      return haystack.includes(needle);
    case "not_contains":
      return !haystack.includes(needle);
    case "equals":
      return haystack === needle;
    case "not_equals":
      return haystack !== needle;
    default:
      return false;
  }
}

function compareBoolean(operator: FilterOperator, rowValue: unknown) {
  const normalized = rowValue === true || String(rowValue).toLowerCase() === "true";
  return operator === "is_true" ? normalized : !normalized;
}

function compareMulti(operator: FilterOperator, rowValue: unknown, value: string) {
  const values = Array.isArray(rowValue) ? rowValue : [rowValue];
  const needle = value.trim().toLowerCase();
  const contains = values.some((item) => normalizeScalar(item).toLowerCase() === needle);
  return operator === "equals" ? contains : !contains;
}

function rowMatchesFilter(
  row: TaskTreeRow,
  filter: FilterState,
  columnMap: Map<string, TaskTableColumn>,
  sourcesById: Map<string, TaskSource>
) {
  if (!filter.columnId || !filter.operator) {
    return true;
  }
  const column = columnMap.get(filter.columnId);
  if (!column) {
    return true;
  }
  const rowValue = column.value(row.task, sourcesById);
  if (column.type === "datetime") {
    return compareDateTime(filter.operator, rowValue, filter.value);
  }
  if (column.type === "number") {
    return compareNumeric(filter.operator, rowValue, filter.value);
  }
  if (column.type === "bool") {
    return compareBoolean(filter.operator, rowValue);
  }
  if (column.type === "multi") {
    return compareMulti(filter.operator, rowValue, filter.value);
  }
  return compareText(filter.operator, rowValue, filter.value);
}

function isConfiguredFilter(filter: FilterState) {
  return filter.columnId !== null && filter.operator !== null;
}

function hasActiveFilters(filters: FilterState[]) {
  return filters.some((filter) => filter.enabled && isConfiguredFilter(filter));
}

function hasActiveSorts(sorts: SortState[]) {
  return sorts.some((sort) => sort.enabled && sort.columnId !== null);
}

function applyFilters(rows: TaskTreeRow[], columns: TaskTableColumn[], sourcesById: Map<string, TaskSource>, filters: FilterState[]) {
  const activeFilters = filters.filter((filter) => filter.enabled && isConfiguredFilter(filter));
  if (!activeFilters.length) {
    return rows;
  }
  const columnMap = new Map(columns.map((column) => [column.id, column] as const));
  const groups: FilterState[][] = [];
  for (const filter of activeFilters) {
    if (!groups.length || filter.link === "or") {
      groups.push([filter]);
    } else {
      groups[groups.length - 1]?.push(filter);
    }
  }
  return rows.filter((row) =>
    groups.some((group) => group.every((filter) => rowMatchesFilter(row, filter, columnMap, sourcesById)))
  );
}

function compareSortValues(left: unknown, right: unknown, type: TaskTableValueType) {
  if (type === "datetime") {
    const leftTime = Date.parse(normalizeScalar(left));
    const rightTime = Date.parse(normalizeScalar(right));
    return Number.isNaN(leftTime) || Number.isNaN(rightTime) ? 0 : leftTime - rightTime;
  }
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "boolean" && typeof right === "boolean") {
    return Number(left) - Number(right);
  }
  const leftText = normalizeScalar(left).toLowerCase();
  const rightText = normalizeScalar(right).toLowerCase();
  return leftText.localeCompare(rightText, undefined, { numeric: true, sensitivity: "base" });
}

function applySorts(rows: TaskTreeRow[], columns: TaskTableColumn[], sourcesById: Map<string, TaskSource>, sorts: SortState[]) {
  const activeSorts = sorts.filter((sort) => sort.enabled && sort.columnId !== null);
  if (!activeSorts.length) {
    return rows;
  }
  const columnMap = new Map(columns.map((column) => [column.id, column] as const));
  return [...rows].sort((left, right) => {
    for (const sort of activeSorts) {
      const column = sort.columnId ? columnMap.get(sort.columnId) : undefined;
      if (!column) {
        continue;
      }
      const comparison = compareSortValues(
        column.value(left.task, sourcesById),
        column.value(right.task, sourcesById),
        column.type
      );
      if (comparison !== 0) {
        return sort.direction === "asc" ? comparison : comparison * -1;
      }
    }
    return 0;
  });
}

function filterOptions(column: TaskTableColumn | undefined, rows: TaskTreeRow[], sourcesById: Map<string, TaskSource>) {
  if (!column) {
    return [];
  }
  const options = new Set<string>();
  rows.forEach((row) => {
    const value = column.value(row.task, sourcesById);
    const values = Array.isArray(value) ? value : [value];
    values.forEach((item) => {
      if (item === undefined || item === null || typeof item === "object") {
        return;
      }
      const text = normalizeScalar(item).trim();
      if (text && text.length <= 120) {
        options.add(text);
      }
    });
  });
  return [...options].sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" })).slice(0, 100);
}

function SelectTriggerText({ value, placeholder }: { value?: string; placeholder: string }) {
  return <span className={value ? "min-w-0 flex-1 truncate text-left" : "min-w-0 flex-1 truncate text-left text-muted-foreground"}>{value ?? placeholder}</span>;
}

function MarkdownDraftButton({
  field,
  value,
  onChange
}: {
  field: TaskFieldMetadata;
  value: MetadataValue;
  onChange: (value: MetadataValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const preview = typeof value === "string" && value.trim().length > 0 ? value : undefined;

  return (
    <>
      <Button type="button" variant="outline" className="w-full min-w-32 justify-start" onClick={() => setOpen(true)}>
        <SelectTriggerText value={preview} placeholder={field.label} />
      </Button>
      <MarkdownValueDialog
        open={open}
        title={field.label}
        description="Edit this markdown value."
        initialValue={value}
        onOpenChange={setOpen}
        onSave={(nextValue) => {
          onChange(nextValue);
          setOpen(false);
        }}
      />
    </>
  );
}

function TaskDraftInput({
  field,
  value,
  onChange
}: {
  field: TaskFieldMetadata;
  value: MetadataValue;
  onChange: (value: MetadataValue) => void;
}) {
  if (field.type === "markdown") {
    return <MarkdownDraftButton field={field} value={value} onChange={onChange} />;
  }

  if (field.type === "bool") {
    const trueLabel = field.options?.[0] ?? "True";
    const falseLabel = field.options?.[1] ?? "False";
    return (
      <Select value={typeof value === "boolean" ? String(value) : undefined} onValueChange={(nextValue) => onChange(nextValue === "true")}>
        <SelectTrigger className="w-full min-w-28">
          <SelectTriggerText value={typeof value === "boolean" ? (value ? trueLabel : falseLabel) : undefined} placeholder={field.label} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true">{trueLabel}</SelectItem>
          <SelectItem value="false">{falseLabel}</SelectItem>
        </SelectContent>
      </Select>
    );
  }

  if (field.type === "select" && field.options?.length) {
    const selected = typeof value === "string" ? value : undefined;
    return (
      <Select value={selected} onValueChange={(nextValue) => nextValue !== null && onChange(nextValue)}>
        <SelectTrigger className="w-full min-w-32">
          <SelectTriggerText value={selected} placeholder={field.label} />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return (
    <Input
      className="min-w-32"
      type={field.type === "number" ? "number" : field.type === "datetime" ? "datetime-local" : "text"}
      value={draftInputText(value)}
      placeholder={field.type === "multiselect" ? `${field.label}, ...` : field.label}
      onChange={(event) => onChange(parseDraftInput(field, event.target.value))}
    />
  );
}

function statusFieldForSource(source: TaskSource): TaskFieldMetadata {
  return {
    sourceId: source.id,
    path: "status",
    label: "Status",
    type: "bool",
    editable: true,
    options: ["Open", "Closed"],
    updateKind: source.type === "Github" ? "github_issue" : "markdown_field"
  };
}

function parentFieldForSource(source: TaskSource): TaskFieldMetadata {
  return {
    sourceId: source.id,
    path: "parentUrl",
    label: "Parent Task",
    type: "string",
    editable: true,
    updateKind: source.type === "Github" ? "github_issue" : "markdown_field"
  };
}

function parentFilterForSource(source: TaskSource | undefined): TaskItemTypeFilter[] | undefined {
  if (!source) {
    return undefined;
  }
  return source.type === "Github"
    ? ["Github"]
    : [source.type];
}

function parentFilterForTask(task: TaskDisplayRow): TaskItemTypeFilter[] {
  const rawObjectType = task.data.__strata && typeof task.data.__strata === "object"
    ? (task.data.__strata as { rawObjectType?: string }).rawObjectType
    : undefined;
  return rawObjectType === "github_checklist_task" ? ["Github", "Markdown via Github"] : [task.type];
}

function isGithubChecklistTask(task: TaskDisplayRow): boolean {
  const rawObjectType = task.data.__strata && typeof task.data.__strata === "object"
    ? (task.data.__strata as { rawObjectType?: string }).rawObjectType
    : undefined;
  return rawObjectType === "github_checklist_task";
}

function isGithubEditableField(field: TaskFieldMetadata): boolean {
  return field.path === "parentUrl"
    || (field.updateKind === "github_issue_field" && field.fieldId !== undefined)
    || GITHUB_ISSUE_EDITABLE_PATHS.has(field.path);
}

function isMarkdownEditablePath(path: string, task?: TaskDisplayRow): boolean {
  const dataPath = path.replace(/^data:/, "");
  if (["contents", "parentUrl", "status", "title"].includes(dataPath)) {
    return true;
  }
  if (MARKDOWN_ADMIN_DATA_KEYS.has(dataPath) || dataPath.startsWith("__strata.")) {
    return false;
  }
  if (!task) {
    return true;
  }
  return Object.hasOwn(extractMarkdownFieldsFromData(task.data), dataPath);
}

function TaskStatusSelect({
  disabled,
  task,
  onChange
}: {
  disabled?: boolean;
  task: TaskDisplayRow;
  onChange: (open: boolean) => void;
}) {
  const value = task.status === false ? "closed" : "open";
  return (
    <Select value={value} disabled={disabled} onValueChange={(nextValue) => onChange(nextValue === "open")}>
      <SelectTrigger className="w-full min-w-28">
        <SelectTriggerText value={value === "open" ? "Open" : "Closed"} placeholder="Status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="open">Open</SelectItem>
        <SelectItem value="closed">Closed</SelectItem>
      </SelectContent>
    </Select>
  );
}

function FilterValueField({
  column,
  filter,
  options,
  onChange
}: {
  column: TaskTableColumn | undefined;
  filter: FilterState;
  options: string[];
  onChange: (value: string) => void;
}) {
  if (!column) {
    return <Input className="w-[240px]" disabled value={filter.value} placeholder="Value" onChange={(event) => onChange(event.target.value)} />;
  }
  if (column.type === "bool") {
    return null;
  }
  const canSelectValue = options.length > 0 && (column.type === "multi" || filter.operator === "equals" || filter.operator === "not_equals");
  if (canSelectValue) {
    return (
      <Select value={options.includes(filter.value) ? filter.value : undefined} onValueChange={(value) => value !== null && onChange(value)}>
        <SelectTrigger className="w-[240px]">
          <SelectTriggerText value={filter.value || undefined} placeholder={valuePlaceholder(column.type)} />
        </SelectTrigger>
        <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {option}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return (
    <Input
      className="w-[240px]"
      type={column.type === "number" ? "number" : "text"}
      value={filter.value}
      placeholder={valuePlaceholder(column.type)}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function FilterPanel({
  columns,
  rows,
  sourcesById,
  filters,
  onChange
}: {
  columns: TaskTableColumn[];
  rows: TaskTreeRow[];
  sourcesById: Map<string, TaskSource>;
  filters: FilterState[];
  onChange: Dispatch<SetStateAction<FilterState[]>>;
}) {
  const columnMap = useMemo(() => new Map(columns.map((column) => [column.id, column] as const)), [columns]);

  return (
    <div className="overflow-x-auto rounded-lg bg-card p-3">
      <div className="space-y-3">
        {filters.map((filter, index) => {
          const column = filter.columnId ? columnMap.get(filter.columnId) : undefined;
          const operators = column ? getOperatorsForType(column.type) : [];
          const options = filterOptions(column, rows, sourcesById);
          return (
            <div key={filter.id} className="flex min-w-max items-center gap-2">
              {index === 0 ? (
                <div className="flex h-9 w-[56px] items-center px-1 text-sm text-foreground">Where</div>
              ) : (
                <Select value={filter.link} onValueChange={(link) => link !== null && onChange((current) => updateFilter(current, filter.id, { link: link as FilterLink }))}>
                  <SelectTrigger className="w-[64px] border-0 bg-transparent px-1 shadow-none hover:bg-accent">
                    <SelectTriggerText value={filter.link === "and" ? "And" : "Or"} placeholder="And" />
                  </SelectTrigger>
                  <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                    <SelectItem value="and">And</SelectItem>
                    <SelectItem value="or">Or</SelectItem>
                  </SelectContent>
                </Select>
              )}

              <Select
                value={filter.columnId ?? undefined}
                onValueChange={(columnId) => {
                  if (columnId === null) {
                    return;
                  }
                  const nextColumn = columnMap.get(columnId);
                  onChange((current) =>
                    updateFilter(current, filter.id, {
                      columnId,
                      operator: nextColumn ? defaultOperatorForType(nextColumn.type) : null,
                      value: ""
                    })
                  );
                }}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectTriggerText value={column?.title} placeholder="Column" />
                </SelectTrigger>
                <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                  {columns.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filter.operator ?? undefined}
                disabled={!column}
                onValueChange={(operator) => operator !== null && onChange((current) => updateFilter(current, filter.id, { operator: operator as FilterOperator }))}
              >
                <SelectTrigger className="w-[72px]">
                  <SelectTriggerText value={filter.operator ? operatorLabel(filter.operator) : undefined} placeholder="=" />
                </SelectTrigger>
                <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                  {operators.map((operator) => (
                    <SelectItem key={operator} value={operator}>
                      {operatorLabel(operator)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <FilterValueField
                column={column}
                filter={filter}
                options={options}
                onChange={(value) => onChange((current) => updateFilter(current, filter.id, { value }))}
              />

              <div className="flex h-9 items-center">
                <Switch
                  checked={filter.enabled}
                  onCheckedChange={(enabled) => onChange((current) => updateFilter(current, filter.id, { enabled }))}
                  aria-label={filter.enabled ? "Disable filter" : "Enable filter"}
                />
              </div>

              <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => onChange((current) => removeFilter(current, filter.id))}>
                <X className="size-4" />
              </Button>
            </div>
          );
        })}

        <Button type="button" variant="ghost" className="justify-start" onClick={() => onChange((current) => [...current, createFilterRow(current.length ? "or" : "where")])}>
          <Plus className="size-4" />
          Add filter
        </Button>
      </div>
    </div>
  );
}

function SortPanel({
  columns,
  sorts,
  onChange
}: {
  columns: TaskTableColumn[];
  sorts: SortState[];
  onChange: Dispatch<SetStateAction<SortState[]>>;
}) {
  const columnMap = useMemo(() => new Map(columns.map((column) => [column.id, column] as const)), [columns]);

  return (
    <div className="overflow-x-auto rounded-lg bg-card p-3">
      <div className="space-y-3">
        {sorts.map((sort) => {
          const column = sort.columnId ? columnMap.get(sort.columnId) : undefined;
          return (
            <div key={sort.id} className="flex min-w-max items-center gap-2">
              <Select value={sort.columnId ?? undefined} onValueChange={(columnId) => columnId !== null && onChange((current) => updateSort(current, sort.id, { columnId }))}>
                <SelectTrigger className="w-[220px]">
                  <SelectTriggerText value={column?.title} placeholder="Column" />
                </SelectTrigger>
                <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                  {columns.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={sort.direction} onValueChange={(direction) => direction !== null && onChange((current) => updateSort(current, sort.id, { direction: direction === "desc" ? "desc" : "asc" }))}>
                <SelectTrigger className="w-[72px]">
                  {sort.direction === "asc" ? <ArrowUp className="size-4" /> : <ArrowDown className="size-4" />}
                </SelectTrigger>
                <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                  <SelectItem value="asc">
                    <ArrowUp className="size-4" />
                  </SelectItem>
                  <SelectItem value="desc">
                    <ArrowDown className="size-4" />
                  </SelectItem>
                </SelectContent>
              </Select>

              <div className="flex h-9 items-center">
                <Switch
                  checked={sort.enabled}
                  onCheckedChange={(enabled) => onChange((current) => updateSort(current, sort.id, { enabled }))}
                  aria-label={sort.enabled ? "Disable sort" : "Enable sort"}
                />
              </div>

              <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={() => onChange((current) => current.filter((item) => item.id !== sort.id))}>
                <X className="size-4" />
              </Button>
            </div>
          );
        })}

        <Button type="button" variant="ghost" className="justify-start" onClick={() => onChange((current) => [...current, createSortRow()])}>
          <Plus className="size-4" />
          Add sort
        </Button>
      </div>
    </div>
  );
}

function moveColumn(columnState: ColumnState[], id: string, direction: -1 | 1): ColumnState[] {
  const index = columnState.findIndex((entry) => entry.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= columnState.length) {
    return columnState;
  }
  const next = [...columnState];
  const [entry] = next.splice(index, 1);
  if (entry) {
    next.splice(nextIndex, 0, entry);
  }
  return next;
}

function syncColumnState(columns: TaskTableColumn[], state: ColumnState[]): ColumnState[] {
  const current = new Map(state.map((entry) => [entry.id, entry]));
  return columns.map((column) => current.get(column.id) ?? { id: column.id, visible: column.defaultVisible ?? true });
}

function buildTaskTreeRows(
  tasks: TaskDisplayRow[],
  sourcesById: Map<string, TaskSource>,
  expandedIds: Set<string>
): { rows: TaskTreeRow[]; expandableIds: string[] } {
  const tasksByUrl = new Map(tasks.map((task) => [task.url, task]));
  const childrenByParent = new Map<string, TaskDisplayRow[]>();
  tasks.forEach((task) => {
    if (!task.parentUrl || !tasksByUrl.has(task.parentUrl)) {
      return;
    }
    childrenByParent.set(task.parentUrl, [...(childrenByParent.get(task.parentUrl) ?? []), task]);
  });

  const roots = sortTasks(tasks.filter((task) => !task.parentUrl || !tasksByUrl.has(task.parentUrl)), sourcesById);
  const expandableIds = [...childrenByParent.entries()]
    .filter(([, children]) => children.length > 0)
    .map(([id]) => id);
  const rows: TaskTreeRow[] = [];
  const visited = new Set<string>();

  function append(task: TaskDisplayRow, depth: number) {
    if (visited.has(task.url)) {
      return;
    }
    visited.add(task.url);
    const children = sortTasks(childrenByParent.get(task.url) ?? [], sourcesById);
    rows.push({ task, depth, children });
    if (expandedIds.has(task.url)) {
      children.forEach((child) => append(child, depth + 1));
    }
  }

  roots.forEach((task) => append(task, 0));
  return { rows, expandableIds };
}

function childBackground(depth: number): string | undefined {
  return depth === 0
    ? undefined
    : `color-mix(in srgb, var(--primary) ${Math.min(depth * 5, 25)}%, transparent)`;
}

function renderCell(column: TaskTableColumn, task: TaskDisplayRow, sourcesById: Map<string, TaskSource>) {
  if (column.render) {
    return column.render(task, sourcesById);
  }
  const value = column.value(task, sourcesById);
  if (column.id === "url" && typeof value === "string") {
    return value.startsWith("http") ? (
      <a className="text-primary underline-offset-4 hover:underline" href={value} title={value} target="_blank" rel="noreferrer">
        {value}
      </a>
    ) : (
      <span title={value}>{value}</span>
    );
  }
  return formatCellValue(value);
}

export function TasksPage() {
  const navigate = useNavigate();
  const { file, trackDraftMetadata, createTask, deleteTask, updateActiveTasks, updateTaskField, syncTaskSource } = useAppStore(useShallow((state) => ({
    file: state.file,
    trackDraftMetadata: state.trackDraftMetadata,
    createTask: state.createTask,
    deleteTask: state.deleteTask,
    updateActiveTasks: state.updateActiveTasks,
    updateTaskField: state.updateTaskField,
    syncTaskSource: state.syncTaskSource
  })));
  const taskSourceFilterUrls = useMemo(
    () => file ? getTrackTaskSourceFilterUrls(file, trackDraftMetadata) : new Set<string>(),
    [file, trackDraftMetadata]
  );
  const allTasks = useMemo(() => file ? taskDisplayRows(file) : [], [file]);
  const tasks = useMemo(() => {
    if (!file) {
      return [];
    }
    const rows = allTasks;
    return taskSourceFilterUrls.size > 0
      ? filterTaskDisplayRowsBySourceUrls(file, rows, taskSourceFilterUrls)
      : rows;
  }, [allTasks, file, taskSourceFilterUrls]);
  const sourcesById = useMemo(
    () => new Map((file?.taskSources ?? []).map((source) => [source.id, source])),
    [file?.taskSources]
  );
  const activeTaskKeys = useMemo(
    () => new Set((file?.activeTasks ?? []).map(taskReferenceKey)),
    [file?.activeTasks]
  );
  const initialTableRow = getCachedSettingsRow(SETTINGS_ROWS.tasksTableRow);
  const initialViewRow = getCachedSettingsRow(SETTINGS_ROWS.tasksViewSelection);
  const initialGroupRow = getCachedSettingsRow(SETTINGS_ROWS.tasksGroup);
  const initialFieldsRow = getCachedSettingsRow(SETTINGS_ROWS.tasksFields);
  const initialFilterRow = getCachedSettingsRow(SETTINGS_ROWS.tasksFilter);
  const initialSortRow = getCachedSettingsRow(SETTINGS_ROWS.tasksSort);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() =>
    new Set(Array.isArray(initialTableRow.expanded_ids) ? initialTableRow.expanded_ids.map(String) : [])
  );
  const [view, setView] = useState<TaskViewMode>(() =>
    ["small-table", "large-table", "small-kanban", "large-kanban"].includes(String(initialViewRow.view))
      ? initialViewRow.view as TaskViewMode
      : "small-table"
  );
  const [columnState, setColumnState] = useState<ColumnState[]>(() =>
    Array.isArray(initialFieldsRow.columns) ? initialFieldsRow.columns as ColumnState[] : []
  );
  const [filters, setFilters] = useState<FilterState[]>(() =>
    Array.isArray(initialFilterRow.filters) ? initialFilterRow.filters as FilterState[] : []
  );
  const [sorts, setSorts] = useState<SortState[]>(() =>
    Array.isArray(initialSortRow.sorts) ? initialSortRow.sorts as SortState[] : []
  );
  const [groupColumnId, setGroupColumnId] = useState<string | null>(() =>
    typeof initialGroupRow.column_id === "string" ? initialGroupRow.column_id : null
  );
  const [createUnsetGroup, setCreateUnsetGroup] = useState(initialGroupRow.create_unset_group === true);
  const [newTaskChoiceId, setNewTaskChoiceId] = useState("");
  const [newTaskValues, setNewTaskValues] = useState<Record<string, MetadataValue>>({ status: true });
  const [newTaskActive, setNewTaskActive] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);
  const [updatingStatusTaskId, setUpdatingStatusTaskId] = useState<string | null>(null);
  const [syncingSources, setSyncingSources] = useState(false);
  const [draggingTaskId, setDraggingTaskId] = useState<string | null>(null);
  const settingsHydrated = true;
  const [editField, setEditField] = useState<{
    task: TaskDisplayRow;
    field: TaskFieldMetadata;
    value: MetadataValue;
  } | null>(null);

  useEffect(() => { if (settingsHydrated) void replaceSettingsRow(SETTINGS_ROWS.tasksTableRow, expandedIds.size ? { expanded_ids: [...expandedIds] } : undefined); }, [expandedIds, settingsHydrated]);
  useEffect(() => { if (settingsHydrated) void replaceSettingsRow(SETTINGS_ROWS.tasksViewSelection, view === "small-table" ? undefined : { view }); }, [settingsHydrated, view]);
  useEffect(() => { if (settingsHydrated) void replaceSettingsRow(SETTINGS_ROWS.tasksGroup, groupColumnId || createUnsetGroup ? { ...(groupColumnId ? { column_id: groupColumnId } : {}), ...(createUnsetGroup ? { create_unset_group: true } : {}) } : undefined); }, [createUnsetGroup, groupColumnId, settingsHydrated]);
  useEffect(() => { if (settingsHydrated) void replaceSettingsRow(SETTINGS_ROWS.tasksFields, columnState.length ? { columns: columnState } : undefined); }, [columnState, settingsHydrated]);
  useEffect(() => { if (settingsHydrated) void replaceSettingsRow(SETTINGS_ROWS.tasksFilter, filters.length ? { filters } : undefined); }, [filters, settingsHydrated]);
  useEffect(() => { if (settingsHydrated) void replaceSettingsRow(SETTINGS_ROWS.tasksSort, sorts.length ? { sorts } : undefined); }, [settingsHydrated, sorts]);
  function setTaskActive(task: TaskDisplayRow, active: boolean) {
    if (!file) {
      return;
    }
    const reference: ActiveTaskReference = { taskId: task.id, table: task.taskTable };
    const key = taskReferenceKey(reference);
    const next = active
      ? [...file.activeTasks.filter((item) => taskReferenceKey(item) !== key), reference]
      : file.activeTasks.filter((item) => taskReferenceKey(item) !== key);
    void updateActiveTasks(next);
  }

  const columns = useMemo(
    () => taskColumns(tasks, file?.internalTaskColumns ?? {}, activeTaskKeys, setTaskActive),
    [activeTaskKeys, file?.internalTaskColumns, tasks]
  );
  const { rows, expandableIds } = useMemo(
    () => buildTaskTreeRows(tasks, sourcesById, expandedIds),
    [expandedIds, sourcesById, tasks]
  );
  const syncedColumnState = useMemo(() => syncColumnState(columns, columnState), [columnState, columns]);
  const visibleColumns = useMemo(() => {
    const columnMap = new Map(columns.map((column) => [column.id, column]));
    const visibleIds = new Set(syncedColumnState.filter((entry) => entry.visible).map((entry) => entry.id));
    return syncedColumnState
      .map((entry) => columnMap.get(entry.id))
      .filter((column): column is TaskTableColumn => column !== undefined && visibleIds.has(column.id));
  }, [columns, syncedColumnState]);
  const visibleRows = useMemo(
    () => applySorts(applyFilters(rows, columns, sourcesById, filters), columns, sourcesById, sorts),
    [columns, filters, rows, sorts, sourcesById]
  );
  const groupColumn = columns.find((column) => column.id === groupColumnId) ?? null;
  const groupedRows = useMemo(
    () => taskRowGroups(visibleRows, groupColumn, sourcesById, createUnsetGroup),
    [createUnsetGroup, groupColumn, sourcesById, visibleRows]
  );
  const allExpanded = expandableIds.length > 0 && expandableIds.every((id) => expandedIds.has(id));
  const activeFilters = hasActiveFilters(filters);
  const activeSorts = hasActiveSorts(sorts);
  const activeGroup = Boolean(groupColumn);
  const isKanbanView = view === "small-kanban" || view === "large-kanban";
  const compactKanban = view === "small-kanban";
  const cellClassName = view === "large-table" ? "whitespace-nowrap px-4 py-3" : undefined;
  const allNewTaskSourceGroups = useMemo(
    () => taskSourceCreationGroups(file?.taskSources ?? []),
    [file?.taskSources]
  );
  const newTaskSourceGroups = useMemo(
    () => taskSourceFilterUrls.size > 0
      ? filterTaskSourceChoiceGroupsBySourceUrls(allNewTaskSourceGroups, taskSourceFilterUrls)
      : allNewTaskSourceGroups,
    [allNewTaskSourceGroups, taskSourceFilterUrls]
  );
  const newTaskSourceOptions = useMemo(() => newTaskSourceGroups.flatMap((group) => group.choices), [newTaskSourceGroups]);
  const newTaskChoice = newTaskSourceOptions.find((choice) => choice.id === newTaskChoiceId) ?? newTaskSourceOptions[0];
  const newTaskSource = newTaskChoice?.source;

  function updateColumnState(updater: (current: ColumnState[]) => ColumnState[]) {
    setColumnState(updater(syncedColumnState));
  }

  function toggleTask(taskId: string) {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(taskId)) {
        next.delete(taskId);
      } else {
        next.add(taskId);
      }
      return next;
    });
  }

  function toggleAll() {
    setExpandedIds(allExpanded ? new Set() : new Set(expandableIds));
  }

  function editableFieldForSource(source: TaskSource | undefined, column: TaskTableColumn): TaskFieldMetadata | null {
    const path = editablePathForColumn(column);
    if (!path || !source || ["source", "url", "uuid", "parentUrl", "rank", "data"].includes(column.id)) {
      return null;
    }
    if (path === "status") {
      return null;
    }
    const storedField = (file?.settings?.taskFieldMetadata[source.id] ?? []).find((field) => field.path === path && field.editable);
    const normalizedStoredField = storedField && storedField.path === "body"
      ? { ...storedField, type: "markdown" as const }
      : storedField;
    if (source.type === "Github") {
      if (normalizedStoredField) {
        return isGithubEditableField(normalizedStoredField) ? normalizedStoredField : null;
      }
      return (
        path === "body"
          ? {
              sourceId: source.id,
              path: "body",
              label: "Body",
              type: "markdown",
              editable: true,
              updateKind: "github_issue"
            }
          : null
      );
    }
    if (source.type === "Internal Task") {
      const columnName = path === "title" ? "title" : path;
      const field = file?.internalTaskColumns[columnName];
      if (!field) {
        return null;
      }
      return {
        sourceId: source.id,
        path: columnName,
        label: columnName,
        type: field.type === "float" || field.type === "int" ? "number" : field.type === "bool" ? "bool" : field.type === "datetime" ? "datetime" : getFieldTypeFromSelection(field),
        editable: true,
        options: field.options,
        updateKind: "markdown_field"
      };
    }
    if (!isMarkdownEditablePath(path)) {
      return null;
    }
    if (normalizedStoredField) {
      return normalizedStoredField;
    }
    return {
      sourceId: source.id,
      path,
      label: path === "title" ? "Title" : path,
      type: path === "body" ? "markdown" : "string",
      editable: true,
      updateKind: "markdown_field"
    };
  }

  function editableFieldFor(task: TaskDisplayRow, column: TaskTableColumn): TaskFieldMetadata | null {
    const source = sourcesById.get(task.sourceId);
    const path = editablePathForColumn(column);
    if (!path || !source) {
      return null;
    }
    if (isGithubChecklistTask(task)) {
      return isMarkdownEditablePath(path, task)
        ? {
            sourceId: source.id,
            path,
            label: path === "contents" ? "Title" : path.replace(/^data:/, ""),
            type: path === "status" ? "bool" : "string",
            editable: true,
            options: path === "status" ? ["Open", "Closed"] : undefined,
            updateKind: "github_issue"
          }
        : null;
    }
    if (source.type === "Markdown" && !isMarkdownEditablePath(path, task)) {
      return null;
    }
    return editableFieldForSource(source, column);
  }

  function setNewTaskValue(path: string, value: MetadataValue) {
    setNewTaskValues((current) => ({ ...current, [path]: value }));
  }

  function changeNewTaskSource(choiceId: string) {
    setNewTaskChoiceId(choiceId);
    setNewTaskValues({ status: true });
  }

  function renderTaskSourceMenuItem(choice: TaskSourceChoice) {
    const selected = choice.id === newTaskChoice?.id;
    return (
      <DropdownMenuItem key={choice.id} onClick={() => changeNewTaskSource(choice.id)}>
        <span className="min-w-0 flex-1 truncate">{choice.label}</span>
        {selected ? <Check className="size-4 text-primary" /> : null}
      </DropdownMenuItem>
    );
  }

  async function handleCreateTask() {
    if (!newTaskSource) {
      return;
    }
    setCreatingTask(true);
    const ok = await createTask({
      sourceId: newTaskSource.id,
      sourceUrl: newTaskChoice?.targetUrl,
      values: newTaskValues,
      active: newTaskActive
    });
    setCreatingTask(false);
    if (ok) {
      setNewTaskValues({ status: true });
      setNewTaskActive(false);
    }
  }

  async function handleDeleteTask(task: TaskDisplayRow) {
    setDeletingTaskId(task.id);
    await deleteTask(task.id);
    setDeletingTaskId(null);
  }

  async function updateTaskStatus(task: TaskDisplayRow, open: boolean) {
    const source = sourcesById.get(task.sourceId);
    if (!source || task.status === open) {
      return;
    }
    setUpdatingStatusTaskId(task.id);
    await updateTaskField(task.id, statusFieldForSource(source), open);
    setUpdatingStatusTaskId(null);
  }

  async function syncTaskSources() {
    if (!file) {
      return;
    }
    setSyncingSources(true);
    try {
      for (const source of file.taskSources) {
        if (source.type !== "Internal Task") {
          await syncTaskSource(source.id);
        }
      }
    } finally {
      setSyncingSources(false);
    }
  }

  function renderCreateCell(column: TaskTableColumn): ReactNode {
    if (column.id === "active") {
      return <Switch checked={newTaskActive} onCheckedChange={setNewTaskActive} disabled={!newTaskSource} />;
    }
    if (column.id === "source") {
      return (
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button type="button" variant="outline" className="w-full min-w-40 justify-between" disabled={newTaskSourceGroups.length === 0} />}>
            <span className={`min-w-0 truncate ${newTaskChoice ? "" : "text-muted-foreground"}`}>{newTaskChoice?.label ?? "Task Source"}</span>
            <ChevronDown className="size-4 opacity-70" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            {newTaskSourceGroups.map((group) =>
              group.nested ? (
                <DropdownMenuSub key={group.id}>
                  <DropdownMenuSubTrigger>
                    <span className="min-w-0 truncate">{group.label}</span>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-56">
                    {group.choices.length > 0
                      ? group.choices.map((choice) => renderTaskSourceMenuItem(choice))
                      : <DropdownMenuItem disabled>No synced repos</DropdownMenuItem>}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              ) : group.choices.map((choice) => renderTaskSourceMenuItem(choice))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      );
    }
    if (column.id === "url") {
      return <span className="text-muted-foreground">Generated</span>;
    }
    if (column.id === "parentUrl") {
      return (
        <ChooseTaskItem
          disabled={!newTaskSource}
          placeholder="Parent task"
          tasks={allTasks}
          typeFilter={parentFilterForSource(newTaskSource)}
          value={typeof newTaskValues.parentUrl === "string" ? newTaskValues.parentUrl : undefined}
          onChange={(value) => setNewTaskValue("parentUrl", value)}
        />
      );
    }
    const editable = column.id === "status" && newTaskSource ? statusFieldForSource(newTaskSource) : editableFieldForSource(newTaskSource, column);
    return editable ? (
      <TaskDraftInput
        field={editable}
        value={newTaskValues[editable.path] ?? (editable.path === "status" ? true : undefined)}
        onChange={(value) => setNewTaskValue(editable.path, value)}
      />
    ) : <span className="text-muted-foreground">—</span>;
  }

  function groupingFieldForTask(task: TaskDisplayRow, column: TaskTableColumn): TaskFieldMetadata | null {
    const source = sourcesById.get(task.sourceId);
    if (!source) {
      return null;
    }
    if (column.id === "status") {
      return statusFieldForSource(source);
    }
    return editableFieldFor(task, column);
  }

  function canMoveTaskToGroup(task: TaskDisplayRow, group: TaskRowGroup): boolean {
    if (!groupColumn) {
      return false;
    }
    if (group.unset && ["active", "status"].includes(groupColumn.id)) {
      return false;
    }
    return groupColumn.id === "active" || Boolean(groupingFieldForTask(task, groupColumn));
  }

  async function moveTaskToGroup(task: TaskDisplayRow, group: TaskRowGroup) {
    if (!groupColumn || !canMoveTaskToGroup(task, group)) {
      return;
    }
    if (groupColumn.id === "active") {
      setTaskActive(task, group.value === true);
      return;
    }
    const field = groupingFieldForTask(task, groupColumn);
    if (field) {
      await updateTaskField(task.id, field, group.unset ? undefined : group.value);
    }
  }

  function draggedTaskRow(): TaskTreeRow | undefined {
    return visibleRows.find((row) => row.task.id === draggingTaskId);
  }

  function handleKanbanDragStart(event: DragEvent<HTMLElement>, task: TaskDisplayRow) {
    event.stopPropagation();
    setDraggingTaskId(task.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
  }

  function handleKanbanDragOver(event: DragEvent<HTMLElement>, group: TaskRowGroup) {
    const row = draggedTaskRow();
    if (row && canMoveTaskToGroup(row.task, group)) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
    }
  }

  function handleKanbanDrop(event: DragEvent<HTMLElement>, group: TaskRowGroup) {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || draggingTaskId;
    const row = visibleRows.find((candidate) => candidate.task.id === taskId);
    setDraggingTaskId(null);
    if (row) {
      void moveTaskToGroup(row.task, group);
    }
  }

  function taskValueClassName(truncate: boolean) {
    return truncate ? "min-w-0 truncate" : "min-w-0 whitespace-normal break-words";
  }

  function renderTaskField(task: TaskDisplayRow, column: TaskTableColumn, truncate: boolean) {
    const editable = editableFieldFor(task, column);
    if (column.id === "status") {
      return (
        <TaskStatusSelect
          task={task}
          disabled={updatingStatusTaskId === task.id}
          onChange={(open) => void updateTaskStatus(task, open)}
        />
      );
    }
    if (column.id === "parentUrl") {
      const source = sourcesById.get(task.sourceId);
      return source ? (
        <ChooseTaskItem
          excludeUrl={task.url}
          tasks={allTasks}
          typeFilter={parentFilterForTask(task)}
          value={task.parentUrl}
          onChange={(value) => void updateTaskField(task.id, parentFieldForSource(source), value)}
        />
      ) : <span className="text-muted-foreground">—</span>;
    }
    return (
      <span className="inline-flex max-w-full items-center gap-1">
        {editable ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => setEditField({ task, field: editable, value: taskFieldValue(task, editable.path) })}
          >
            <Pencil className="size-3.5" />
          </Button>
        ) : null}
        <span className={taskValueClassName(truncate)}>{renderCell(column, task, sourcesById)}</span>
      </span>
    );
  }

  function renderTaskTableRow({ task, depth, children }: TaskTreeRow) {
    return (
      <TableRow key={task.id} style={{ backgroundColor: childBackground(depth) }}>
        <TableCell className={cellClassName}>
          {children.length > 0 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={expandedIds.has(task.url) ? "Collapse child tasks" : "Expand child tasks"}
              onClick={() => toggleTask(task.url)}
            >
              {expandedIds.has(task.url) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </Button>
          ) : null}
        </TableCell>
        {visibleColumns.map((column) => (
          <TableCell key={column.id} className={cellClassName ?? (column.id === "contents" ? "max-w-md whitespace-normal" : "max-w-72 truncate")}>
            {renderTaskField(task, column, true)}
          </TableCell>
        ))}
        <TableCell className={cellClassName}>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={deletingTaskId === task.id}
            aria-label="Delete task"
            onClick={() => void handleDeleteTask(task)}
          >
            <Trash2 className="size-4" />
          </Button>
        </TableCell>
      </TableRow>
    );
  }

  function renderKanbanCard(row: TaskTreeRow) {
    const canDrag = groupColumn ? canMoveTaskToGroup(row.task, { key: "", title: "", value: undefined, unset: false, rows: [] }) : false;
    return (
      <div
        key={row.task.id}
        className={`rounded-lg border border-border bg-card p-3 shadow-sm ${draggingTaskId === row.task.id ? "opacity-60" : ""}`}
        style={{ backgroundColor: childBackground(row.depth) }}
      >
        <div className="mb-2 flex justify-end">
          <div className="flex shrink-0 items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={!canDrag}
              draggable={canDrag}
              aria-label="Drag task"
              className={canDrag ? "cursor-grab active:cursor-grabbing" : undefined}
              onDragStart={(event) => handleKanbanDragStart(event, row.task)}
              onDragEnd={(event) => {
                event.stopPropagation();
                setDraggingTaskId(null);
              }}
            >
              <GripVertical className="size-3.5" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              disabled={deletingTaskId === row.task.id}
              aria-label="Delete task"
              onClick={() => void handleDeleteTask(row.task)}
            >
              <Trash2 className="size-3.5" />
            </Button>
          </div>
        </div>
        <div className="grid gap-2">
          {visibleColumns.map((column) => (
            <div key={column.id} className="grid min-w-0 gap-1 text-xs">
              <div className="text-muted-foreground">{column.title}</div>
              <div className={`min-w-0 text-sm ${compactKanban ? "truncate" : "whitespace-normal break-words"}`}>
                {renderTaskField(row.task, column, compactKanban)}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderKanbanBoard() {
    const groups = activeGroup ? groupedRows : taskRowGroups(visibleRows, null, sourcesById, false);
    const columnWidthClass = compactKanban ? "auto-cols-[minmax(17rem,1fr)]" : "auto-cols-[minmax(23rem,1fr)]";
    return (
      <div className="h-full overflow-x-auto">
        <div className={`grid h-full grid-flow-col gap-0 ${columnWidthClass}`}>
          {groups.map((group, index) => {
            const row = draggedTaskRow();
            const canDrop = Boolean(row && canMoveTaskToGroup(row.task, group));
            return (
              <section
                key={group.key}
                className={`flex h-full min-h-72 flex-col bg-transparent transition-colors hover:bg-muted/30 ${index < groups.length - 1 ? "border-r border-border/70" : ""} ${canDrop ? "bg-primary/5" : ""}`}
                onDragOver={(event) => handleKanbanDragOver(event, group)}
                onDrop={(event) => handleKanbanDrop(event, group)}
              >
                <div className="flex items-center justify-between border-b border-border px-3 py-2">
                  <h3 className="min-w-0 truncate text-sm font-medium">{group.title}</h3>
                  <span className="text-xs text-muted-foreground">{group.rows.length}</span>
                </div>
                <div className="grid gap-3 overflow-y-auto p-3">
                  {group.rows.length > 0
                    ? group.rows.map((row) => renderKanbanCard(row))
                    : <div className="px-3 py-8 text-center text-sm text-muted-foreground">No tasks</div>}
                </div>
              </section>
            );
          })}
          {groups.length === 0 ? (
            <section className="flex min-h-72 items-center justify-center p-6 text-sm text-muted-foreground">
              {rows.length > 0 ? "No tasks match the active filters." : "No tasks synced yet."}
            </section>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <main className="flex h-screen min-h-0 w-full min-w-0 flex-col bg-background">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-end gap-2 border-b border-border/70 px-4 py-2">
        <SyncButton
          type="button"
          variant="outline"
          syncing={syncingSources}
          disabled={!file || file.taskSources.every((source) => source.type === "Internal Task")}
          onClick={() => void syncTaskSources()}
        >
          Refresh
        </SyncButton>
        <Popover>
          <PopoverTrigger render={<Button type="button" variant="outline" />}>
            <LayoutList className="size-4" />
            View
          </PopoverTrigger>
          <PopoverContent align="end" className="grid w-44 gap-2">
            <Button type="button" size="sm" variant={view === "small-table" ? "secondary" : "outline"} onClick={() => setView("small-table")}>
              Small Table
            </Button>
            <Button type="button" size="sm" variant={view === "large-table" ? "secondary" : "outline"} onClick={() => setView("large-table")}>
              Large Table
            </Button>
            <Button type="button" size="sm" variant={view === "small-kanban" ? "secondary" : "outline"} onClick={() => setView("small-kanban")}>
              Small Kanban
            </Button>
            <Button type="button" size="sm" variant={view === "large-kanban" ? "secondary" : "outline"} onClick={() => setView("large-kanban")}>
              Large Kanban
            </Button>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger render={<Button type="button" variant={activeGroup ? "secondary" : "outline"} />}>
            <GroupIcon className="size-4" />
            Group
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <div className="grid gap-3">
              <label className="flex h-8 items-center justify-between gap-3 text-sm">
                <span>Create Unset Group</span>
                <Switch checked={createUnsetGroup} onCheckedChange={setCreateUnsetGroup} />
              </label>
              <Select
                value={groupColumnId ?? UNSET_GROUP_SELECT_VALUE}
                onValueChange={(value) => setGroupColumnId(value === UNSET_GROUP_SELECT_VALUE ? null : value)}
              >
                <SelectTrigger className="w-full">
                  <SelectTriggerText value={groupColumn?.title} placeholder="Unset" />
                </SelectTrigger>
                <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
                  <SelectItem value={UNSET_GROUP_SELECT_VALUE}>Unset</SelectItem>
                  {columns.map((column) => (
                    <SelectItem key={column.id} value={column.id}>
                      {column.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger render={<Button type="button" variant="outline" />}>
            <Columns3Cog className="size-4" />
            Fields
          </PopoverTrigger>
          <PopoverContent align="end" className="max-h-[70vh] w-80 overflow-y-auto">
            {syncedColumnState.map((state, index) => {
              const column = columns.find((candidate) => candidate.id === state.id);
              if (!column) {
                return null;
              }
              return (
                <div key={state.id} className="flex items-center gap-2">
                  <Switch
                    checked={state.visible}
                    onCheckedChange={(visible) =>
                      updateColumnState((current) =>
                        current.map((entry) => entry.id === state.id ? { ...entry, visible } : entry)
                      )
                    }
                  />
                  <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => updateColumnState((current) => moveColumn(current, state.id, -1))}>
                    <ArrowUp className="size-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" disabled={index === syncedColumnState.length - 1} onClick={() => updateColumnState((current) => moveColumn(current, state.id, 1))}>
                    <ArrowDown className="size-4" />
                  </Button>
                  <span className="min-w-0 truncate text-sm">{column.title}</span>
                </div>
              );
            })}
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger render={<Button type="button" variant={activeFilters ? "secondary" : "outline"} />}>
            <Filter className="size-4" />
            Filter
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto max-w-[92vw] p-0">
            <FilterPanel columns={columns} rows={rows} sourcesById={sourcesById} filters={filters} onChange={setFilters} />
          </PopoverContent>
        </Popover>

        <Popover>
          <PopoverTrigger render={<Button type="button" variant={activeSorts ? "secondary" : "outline"} />}>
            <ArrowDownWideNarrow className="size-4" />
            Sort
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto max-w-[92vw] p-0">
            <SortPanel columns={columns} sorts={sorts} onChange={setSorts} />
          </PopoverContent>
        </Popover>
        <Button type="button" onClick={() => navigate("/focus")}>
          Continue
        </Button>
      </div>
      <div className={isKanbanView ? "min-h-0 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-auto"}>
        {isKanbanView ? renderKanbanBoard() : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={expandableIds.length === 0}
                    aria-label={allExpanded ? "Collapse all tasks" : "Expand all tasks"}
                    onClick={toggleAll}
                  >
                    {allExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                  </Button>
                </TableHead>
                {visibleColumns.map((column) => (
                  <TableHead key={column.id} className={cellClassName}>{column.title}</TableHead>
                ))}
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.length > 0 || (activeGroup && createUnsetGroup) ? groupedRows.map((group) => (
                <Fragment key={group.key}>
                  {activeGroup ? (
                    <TableRow>
                      <TableCell colSpan={visibleColumns.length + 2} className="bg-muted/60 py-2 text-sm font-medium">
                        <span>{group.title}</span>
                        <span className="ml-2 text-xs text-muted-foreground">{group.rows.length}</span>
                      </TableCell>
                    </TableRow>
                  ) : null}
                  {group.rows.map((row) => renderTaskTableRow(row))}
                </Fragment>
              )) : (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length + 2} className="py-8 text-center text-muted-foreground">
                    {rows.length > 0 ? "No tasks match the active filters." : "No tasks synced yet."}
                  </TableCell>
                </TableRow>
              )}
              <TableRow>
                <TableCell className={cellClassName} />
                {visibleColumns.map((column) => (
                  <TableCell key={`new-${column.id}`} className={cellClassName ?? (column.id === "contents" ? "max-w-md whitespace-normal" : "max-w-72")}>
                    {renderCreateCell(column)}
                  </TableCell>
                ))}
                <TableCell className={cellClassName}>
                  <Button
                    type="button"
                    size="icon"
                    disabled={!file || !newTaskSource || creatingTask}
                    aria-label="Add task"
                    onClick={() => void handleCreateTask()}
                  >
                    <Plus className="size-4" />
                  </Button>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>
      {editField ? (
        <MetadataValueDialog
          open
          title={`Edit ${editField.field.label}`}
          description="Update this task field."
          field={fieldMetadataToDefinition(editField.field)}
          initialValue={editField.value}
          allowClear
          onOpenChange={(open) => !open && setEditField(null)}
          onSave={async (value) => {
            await updateTaskField(editField.task.id, editField.field, value);
            setEditField(null);
          }}
        />
      ) : null}
    </main>
  );
}
