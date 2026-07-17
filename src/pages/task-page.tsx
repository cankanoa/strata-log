import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  ArrowDown,
  ArrowDownWideNarrow,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Columns3Cog,
  Filter,
  LayoutList,
  Plus,
  X
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { taskSourceLabel } from "@/lib/task-query";
import type { TaskRow, TaskSource } from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import { useShallow } from "zustand/react/shallow";

type TaskTreeRow = {
  task: TaskRow;
  depth: number;
  children: TaskRow[];
};

type TaskTableValueType = "string" | "number" | "bool" | "datetime" | "multi";

type TaskTableColumn = {
  id: string;
  title: string;
  type: TaskTableValueType;
  defaultVisible?: boolean;
  value: (task: TaskRow, sourcesById: Map<string, TaskSource>) => unknown;
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

type TaskViewMode = "small-table" | "large-table";

function sortTasks(tasks: TaskRow[], sourcesById: Map<string, TaskSource>): TaskRow[] {
  return [...tasks].sort((left, right) => {
    const sourceCompare = taskSourceLabel(sourcesById.get(left.sourceId)).localeCompare(taskSourceLabel(sourcesById.get(right.sourceId)));
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

function taskColumns(tasks: TaskRow[]): TaskTableColumn[] {
  const standardColumns: TaskTableColumn[] = [
    { id: "type", title: "Type", type: "string", defaultVisible: true, value: (task) => task.type },
    { id: "contents", title: "Title", type: "string", defaultVisible: true, value: (task) => task.contents },
    { id: "source", title: "Source", type: "string", defaultVisible: true, value: (task, sourcesById) => taskSourceLabel(sourcesById.get(task.sourceId)) },
    { id: "status", title: "Status", type: "string", defaultVisible: true, value: (task) => task.status ?? "open" },
    { id: "url", title: "URL", type: "string", defaultVisible: true, value: (task) => task.url },
    { id: "uuid", title: "UUID", type: "string", defaultVisible: false, value: (task) => task.id },
    { id: "parentTaskId", title: "Parent Task", type: "string", defaultVisible: false, value: (task) => task.parentTaskId },
    { id: "rank", title: "Rank", type: "string", defaultVisible: false, value: (task) => task.rank },
    { id: "data", title: "Data", type: "string", defaultVisible: false, value: (task) => task.data }
  ];
  const dataPaths = [...new Set(tasks.flatMap((task) => flattenPaths(task.data)))].sort((left, right) => left.localeCompare(right));
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
  tasks: TaskRow[],
  sourcesById: Map<string, TaskSource>,
  expandedIds: Set<string>
): { rows: TaskTreeRow[]; expandableIds: string[] } {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const childrenByParent = new Map<string, TaskRow[]>();
  tasks.forEach((task) => {
    if (!task.parentTaskId || !tasksById.has(task.parentTaskId)) {
      return;
    }
    childrenByParent.set(task.parentTaskId, [...(childrenByParent.get(task.parentTaskId) ?? []), task]);
  });

  const roots = sortTasks(tasks.filter((task) => !task.parentTaskId || !tasksById.has(task.parentTaskId)), sourcesById);
  const expandableIds = [...childrenByParent.entries()]
    .filter(([, children]) => children.length > 0)
    .map(([id]) => id);
  const rows: TaskTreeRow[] = [];
  const visited = new Set<string>();

  function append(task: TaskRow, depth: number) {
    if (visited.has(task.id)) {
      return;
    }
    visited.add(task.id);
    const children = sortTasks(childrenByParent.get(task.id) ?? [], sourcesById);
    rows.push({ task, depth, children });
    if (expandedIds.has(task.id)) {
      children.forEach((child) => append(child, depth + 1));
    }
  }

  roots.forEach((task) => append(task, 0));
  sortTasks(tasks.filter((task) => !visited.has(task.id)), sourcesById).forEach((task) => append(task, 0));
  return { rows, expandableIds };
}

function childBackground(depth: number): string | undefined {
  return depth === 0
    ? undefined
    : `color-mix(in srgb, var(--primary) ${Math.min(depth * 5, 25)}%, transparent)`;
}

function renderCell(column: TaskTableColumn, task: TaskRow, sourcesById: Map<string, TaskSource>) {
  const value = column.value(task, sourcesById);
  if (column.id === "status") {
    return value === "completed" ? <Badge variant="secondary">Completed</Badge> : <Badge variant="outline">Open</Badge>;
  }
  if (column.id === "url" && typeof value === "string" && value.startsWith("http")) {
    return (
      <a className="text-primary underline-offset-4 hover:underline" href={value} target="_blank" rel="noreferrer">
        {value}
      </a>
    );
  }
  return formatCellValue(value);
}

export function TasksPage() {
  const { file } = useAppStore(useShallow((state) => ({ file: state.file })));
  const tasks = file?.tasks ?? [];
  const sourcesById = useMemo(
    () => new Map((file?.taskSources ?? []).map((source) => [source.id, source])),
    [file?.taskSources]
  );
  const columns = useMemo(() => taskColumns(tasks), [tasks]);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<TaskViewMode>("small-table");
  const [columnState, setColumnState] = useState<ColumnState[]>([]);
  const [filters, setFilters] = useState<FilterState[]>([]);
  const [sorts, setSorts] = useState<SortState[]>([]);
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
  const allExpanded = expandableIds.length > 0 && expandableIds.every((id) => expandedIds.has(id));
  const activeFilters = hasActiveFilters(filters);
  const activeSorts = hasActiveSorts(sorts);
  const cellClassName = view === "large-table" ? "whitespace-nowrap px-4 py-3" : undefined;

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

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl p-5 xl:p-7">
      <Card className="border-white/60 bg-card/90 shadow-xl shadow-amber-950/5">
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <CardTitle>Tasks</CardTitle>
          <div className="flex flex-wrap gap-2">
            <Popover>
              <PopoverTrigger render={<Button type="button" variant="outline" />}>
                <LayoutList className="size-4" />
                View
              </PopoverTrigger>
              <PopoverContent align="end" className="w-44">
                <Button type="button" size="sm" variant={view === "small-table" ? "secondary" : "outline"} onClick={() => setView("small-table")}>
                  Small Table
                </Button>
                <Button type="button" size="sm" variant={view === "large-table" ? "secondary" : "outline"} onClick={() => setView("large-table")}>
                  Large Table
                </Button>
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
          </div>
        </CardHeader>
        <CardContent>
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
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.length > 0 ? visibleRows.map(({ task, depth, children }) => (
                <TableRow key={task.id} style={{ backgroundColor: childBackground(depth) }}>
                  <TableCell className={cellClassName}>
                    {children.length > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={expandedIds.has(task.id) ? "Collapse child tasks" : "Expand child tasks"}
                        onClick={() => toggleTask(task.id)}
                      >
                        {expandedIds.has(task.id) ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                      </Button>
                    ) : null}
                  </TableCell>
                  {visibleColumns.map((column) => (
                    <TableCell key={column.id} className={cellClassName ?? (column.id === "contents" ? "max-w-md whitespace-normal" : "max-w-72 truncate")}>
                      {renderCell(column, task, sourcesById)}
                    </TableCell>
                  ))}
                </TableRow>
              )) : (
                <TableRow>
                  <TableCell colSpan={visibleColumns.length + 1} className="py-8 text-center text-muted-foreground">
                    {rows.length > 0 ? "No tasks match the active filters." : "No tasks synced yet."}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
