import { INTERNAL_TASK_TITLE_COLUMN_NAME } from "@/lib/internal-tasks";
import { githubOwnerTarget, githubRepoSlugsForSource, githubRepoTarget, githubRepositorySlugFromTask } from "@/lib/github-task-sources";
import type { ActiveTaskReference, MetadataValue, TaskDisplayRow, TaskRow, TaskSource, TimeLogFile } from "@/lib/types";

export type TaskSourceChoice = {
  id: string;
  source: TaskSource;
  label: string;
  targetUrl?: string;
};

export type TaskSourceChoiceGroup = {
  id: string;
  label: string;
  nested: boolean;
  choices: TaskSourceChoice[];
};

export function taskSourceLabel(source: TaskSource | undefined): string {
  if (!source) {
    return "Unknown";
  }
  if (source.name?.trim()) {
    return source.name.trim();
  }
  if (source.type === "Github") {
    return source.url.replace(/^(?:https?:\/\/)?github\.com\//i, "");
  }
  if (source.type === "Internal Task") {
    return "Internal Task";
  }
  return source.url;
}

export function taskSourceLabelForTask(source: TaskSource | undefined, task: TaskRow): string {
  if (!source) {
    return "Unknown";
  }
  return source.type === "Github"
    ? githubRepositorySlugFromTask(source, task) ?? taskSourceLabel(source)
    : taskSourceLabel(source);
}

export function taskSourceCreationChoices(sources: TaskSource[]): TaskSourceChoice[] {
  return taskSourceCreationGroups(sources).flatMap((group) => group.choices);
}

export function taskSourceCreationGroups(sources: TaskSource[]): TaskSourceChoiceGroup[] {
  return sources.flatMap<TaskSourceChoiceGroup>((source) => {
    if (source.type !== "Github") {
      const choice: TaskSourceChoice = { id: source.id, source, label: taskSourceLabel(source) };
      return [{ id: source.id, label: choice.label, nested: false, choices: [choice] }];
    }
    const choices: TaskSourceChoice[] = githubRepoSlugsForSource(source).map((repo) => ({
      id: `${source.id}:${repo}`,
      source,
      targetUrl: repo,
      label: repo
    }));
    return githubOwnerTarget(source.url) && !githubRepoTarget(source.url)
      ? [{ id: source.id, label: taskSourceLabel(source), nested: true, choices }]
      : choices.map((choice) => ({ id: choice.id, label: choice.label, nested: false, choices: [choice] }));
  });
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
