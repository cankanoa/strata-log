import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TaskDisplayRow, TaskSourceType } from "@/lib/types";

export type TaskItemTypeFilter = TaskSourceType | "Markdown via Github";

const UNSET_VALUE = "__unset_parent_task__";

function taskItemKind(task: TaskDisplayRow): TaskItemTypeFilter {
  const rawObjectType = task.data.__strata && typeof task.data.__strata === "object"
    ? (task.data.__strata as { rawObjectType?: string }).rawObjectType
    : undefined;
  return rawObjectType === "github_checklist_task" ? "Markdown via Github" : task.type;
}

function taskOptionLabel(task: TaskDisplayRow): string {
  return task.url;
}

export function ChooseTaskItem({
  disabled,
  excludeUrl,
  placeholder = "Parent task",
  tasks,
  typeFilter,
  value,
  onChange
}: {
  disabled?: boolean;
  excludeUrl?: string;
  placeholder?: string;
  tasks: TaskDisplayRow[];
  typeFilter?: TaskItemTypeFilter | TaskItemTypeFilter[];
  value?: string;
  onChange: (value: string | undefined) => void;
}) {
  const filters = typeFilter ? new Set(Array.isArray(typeFilter) ? typeFilter : [typeFilter]) : null;
  const options = tasks
    .filter((task) => task.url !== excludeUrl)
    .filter((task) => !filters || filters.has(taskItemKind(task)))
    .sort((left, right) => taskOptionLabel(left).localeCompare(taskOptionLabel(right)));
  const selected = options.find((task) => task.url === value);

  return (
    <Select
      value={value ?? UNSET_VALUE}
      disabled={disabled}
      onValueChange={(nextValue) => onChange(nextValue === UNSET_VALUE ? undefined : nextValue)}
    >
      <SelectTrigger className="w-full min-w-48">
        <SelectValue>
          <span className={selected ? "min-w-0 truncate" : "min-w-0 truncate text-muted-foreground"}>
            {selected ? selected.url : placeholder}
          </span>
        </SelectValue>
      </SelectTrigger>
      <SelectContent className="min-w-[var(--radix-select-trigger-width)]">
        <SelectItem value={UNSET_VALUE}>Unset</SelectItem>
        {options.map((task) => (
          <SelectItem key={task.url} value={task.url}>
            <span className="min-w-0 truncate" title={task.url}>{task.url}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
