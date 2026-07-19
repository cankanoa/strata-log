import { INTERNAL_TASK_TITLE_COLUMN_NAME } from "@/lib/internal-tasks";
import type { ActiveTaskReference, MetadataValue, TaskDisplayRow, TaskRow, TaskSource, TimeLogFile } from "@/lib/types";

export function taskSourceLabel(source: TaskSource | undefined): string {
  if (!source) {
    return "Unknown";
  }
  if (source.name?.trim()) {
    return source.name.trim();
  }
  if (source.type === "Github") {
    return source.url.replace(/^https:\/\/github\.com\//i, "");
  }
  if (source.type === "Internal Task") {
    return "Internal Task";
  }
  return source.url;
}

export function taskReferenceKey(reference: ActiveTaskReference): string {
  return `${reference.table}:${reference.taskId}`;
}

function textValue(value: MetadataValue): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function internalTaskStatus(values: Record<string, MetadataValue>): boolean | undefined {
  const raw = values.status ?? values.Status;
  if (typeof raw === "boolean") {
    return raw;
  }
  const value = String(raw ?? "").toLowerCase();
  if (["open", "active", "true", "1"].includes(value)) {
    return true;
  }
  if (["closed", "completed", "complete", "done", "false", "0", "x"].includes(value)) {
    return false;
  }
  return undefined;
}

function taskDisplayRow(task: TaskRow, file: TimeLogFile): TaskDisplayRow {
  if (task.type !== "Internal Task") {
    return {
      ...task,
      taskTable: "tasks"
    };
  }
  const internalTask = file.internalTasks.find((candidate) => candidate.id === task.id);
  const title = textValue(internalTask?.values[INTERNAL_TASK_TITLE_COLUMN_NAME]) ?? task.contents;
  return {
    ...task,
    taskTable: "tasks",
    contents: title,
    status: internalTask ? internalTaskStatus(internalTask.values) : task.status,
    data: {
      ...task.data,
      ...(internalTask?.values ?? {})
    }
  };
}

export function taskDisplayRows(file: TimeLogFile): TaskDisplayRow[] {
  return file.tasks.map((task) => taskDisplayRow(task, file));
}

export function activeTaskDisplayRows(file: TimeLogFile): TaskDisplayRow[] {
  const rowsByKey = new Map(taskDisplayRows(file).map((task) => [taskReferenceKey({ taskId: task.id, table: task.taskTable }), task]));
  return file.activeTasks.flatMap((reference) => {
    const task = rowsByKey.get(taskReferenceKey(reference));
    return task ? [task] : [];
  });
}
