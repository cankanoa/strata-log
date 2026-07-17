import { v4 as uuidv4 } from "uuid";
import { LexoRank } from "lexorank";
import { Octokit } from "@octokit/rest";
import type { OnlineAccount, TaskRow, TaskSource, TimeLogFile } from "@/lib/types";

type ParsedMarkdownTask = {
  filePath: string;
  contents: string;
  status?: "completed";
  rank: string;
  parentIndex?: number;
};

export type MarkdownTaskFile = {
  path: string;
  markdown: string;
};

const TASK_BULLET_PATTERN = /^(\s*)[-*+]\s*\[\s*([xX]?)\s*\]\s+(.*)$/;
const STANDARD_FIELD_ALIASES = {
  title: ["title", "name", "contents", "content", "text", "summary"],
  status: ["status", "state", "completed", "done", "checked"],
  url: ["html_url", "url", "link", "path", "filePath"]
};

function toJsonObject(value: unknown): Record<string, unknown> {
  try {
    const parsed = JSON.parse(JSON.stringify(value ?? {}));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function findAliasedValue(value: unknown, aliases: string[], depth = 0): unknown {
  if (!value || typeof value !== "object" || depth > 4) {
    return undefined;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  for (const alias of aliases) {
    const direct = entries.find(([key]) => alias.toLowerCase() === key.toLowerCase());
    if (direct) {
      return direct[1];
    }
  }
  for (const [, child] of entries) {
    const found = findAliasedValue(child, aliases, depth + 1);
    if (found !== undefined) {
      return found;
    }
  }
  return undefined;
}

function valueText(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function standardStatus(value: unknown): "completed" | undefined {
  if (value === true) {
    return "completed";
  }
  const text = valueText(value)?.toLowerCase();
  return text && ["x", "true", "completed", "complete", "closed", "done"].includes(text) ? "completed" : undefined;
}

function standardTaskFields(data: Record<string, unknown>, fallback: { title: string; url: string; status?: "completed" }) {
  return {
    contents: valueText(findAliasedValue(data, STANDARD_FIELD_ALIASES.title)) ?? fallback.title,
    url: valueText(findAliasedValue(data, STANDARD_FIELD_ALIASES.url)) ?? fallback.url,
    status: standardStatus(findAliasedValue(data, STANDARD_FIELD_ALIASES.status)) ?? fallback.status
  };
}

export function parseMarkdownTasks(filePath: string, markdown: string): ParsedMarkdownTask[] {
  let rank = LexoRank.middle();
  const tasks: ParsedMarkdownTask[] = [];
  const parentStack: Array<{ indent: number; index: number }> = [];

  markdown.split(/\r?\n/).forEach((line) => {
    const match = line.match(TASK_BULLET_PATTERN);
    if (!match) {
      return;
    }
    const contents = match[3].trim();
    if (!contents) {
      return;
    }

    const indent = match[1].replace(/\t/g, "    ").length;
    while (parentStack.length > 0 && parentStack.at(-1)!.indent >= indent) {
      parentStack.pop();
    }
    const task: ParsedMarkdownTask = {
      filePath,
      contents,
      status: match[2] ? "completed" as const : undefined,
      rank: rank.toString(),
      parentIndex: parentStack.at(-1)?.index
    };
    tasks.push(task);
    parentStack.push({ indent, index: tasks.length - 1 });
    rank = rank.genNext();
  });

  return tasks;
}

function sourceTasks(file: TimeLogFile, sourceId: string): TaskRow[] {
  return file.tasks.filter((task) => task.sourceId === sourceId);
}

function takeFirst(map: Map<string, TaskRow[]>, key: string): TaskRow | undefined {
  const rows = map.get(key);
  const row = rows?.shift();
  if (rows && rows.length === 0) {
    map.delete(key);
  }
  return row;
}

export function syncMarkdownTaskSource(file: TimeLogFile, source: TaskSource, files: MarkdownTaskFile[]): TaskRow[] {
  const existingByFileAndContents = new Map<string, TaskRow[]>();
  const existingByContents = new Map<string, TaskRow[]>();
  sourceTasks(file, source.id).forEach((task) => {
    const filePath = task.url.replace(/:[^:]+$/, "");
    const fileKey = `${filePath}\0${task.contents}`;
    existingByFileAndContents.set(fileKey, [...(existingByFileAndContents.get(fileKey) ?? []), task]);
    existingByContents.set(task.contents, [...(existingByContents.get(task.contents) ?? []), task]);
  });

  return files.flatMap((taskFile) => {
    const parsedTasks = parseMarkdownTasks(taskFile.path, taskFile.markdown);
    const syncedTasks = parsedTasks.map((parsed) => {
      const existing =
        takeFirst(existingByFileAndContents, `${parsed.filePath}\0${parsed.contents}`) ??
        takeFirst(existingByContents, parsed.contents);
      const data = {
        title: parsed.contents,
        content: parsed.contents,
        status: parsed.status,
        checked: parsed.status === "completed",
        filePath: parsed.filePath,
        url: `${parsed.filePath}:${parsed.rank}`,
        rank: parsed.rank,
        __strata: { sourceType: "Markdown" }
      };
      const standard = standardTaskFields(data, {
        title: parsed.contents,
        url: `${parsed.filePath}:${parsed.rank}`,
        status: parsed.status
      });
      return {
        id: existing?.id ?? uuidv4(),
        sourceId: source.id,
        type: "Markdown" as const,
        url: standard.url,
        contents: standard.contents,
        status: standard.status,
        rank: parsed.rank,
        data
      };
    });

    return syncedTasks.map((task, index) => ({
      ...task,
      parentTaskId: parsedTasks[index]?.parentIndex === undefined
        ? undefined
        : syncedTasks[parsedTasks[index].parentIndex!]?.id
    }));
  });
}

export function isGithubAuthError(error: unknown): boolean {
  const status = typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
  return [401, 403, 404].includes(status);
}

export async function fetchGithubIssueTasks(
  file: TimeLogFile,
  source: TaskSource,
  account?: OnlineAccount
): Promise<TaskRow[]> {
  const match = source.url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/.*)?$/i);
  if (!match) {
    return [];
  }

  const octokit = new Octokit(account?.token ? { auth: account.token } : {});
  const issues = await octokit.paginate(octokit.rest.issues.listForRepo, {
    owner: match[1],
    repo: match[2],
    state: "open",
    per_page: 100
  });

  let rank = LexoRank.middle();
  const existingByUrl = new Map(sourceTasks(file, source.id).map((task) => [task.url, task]));
  const existingByContents = new Map<string, TaskRow[]>();
  sourceTasks(file, source.id).forEach((task) => {
    existingByContents.set(task.contents, [...(existingByContents.get(task.contents) ?? []), task]);
  });

  return issues
    .filter((issue) => !issue.pull_request)
    .flatMap((issue) => {
      const url = issue.html_url ?? `${source.url}/issues/${issue.number}`;
      const rawIssue = toJsonObject(issue);
      const issueData = {
        ...rawIssue,
        __strata: { sourceType: "Github", rawObjectType: "github_issue" }
      };
      const issueStandard = standardTaskFields(issueData, {
        title: issue.title,
        url,
        status: undefined
      });
      const existing = existingByUrl.get(issueStandard.url) ?? takeFirst(existingByContents, issueStandard.contents);
      const issueTask: TaskRow = {
        id: existing?.id ?? uuidv4(),
        sourceId: source.id,
        type: "Github",
        url: issueStandard.url,
        contents: issueStandard.contents,
        status: issueStandard.status,
        rank: rank.toString(),
        data: issueData
      };
      rank = rank.genNext();
      const parsedChildren = parseMarkdownTasks(url, issue.body ?? "");
      const childTasks = parsedChildren.map((parsed) => {
        const childUrl = `${url}:${parsed.rank}`;
        const childData = {
          title: parsed.contents,
          content: parsed.contents,
          status: parsed.status,
          checked: parsed.status === "completed",
          url: childUrl,
          parentUrl: url,
          parentIssue: issueData,
          rank: parsed.rank,
          __strata: { sourceType: "GithubChecklist", rawObjectType: "github_checklist_task" }
        };
        const childStandard = standardTaskFields(childData, {
          title: parsed.contents,
          url: childUrl,
          status: parsed.status
        });
        const existingChild = existingByUrl.get(childStandard.url) ?? takeFirst(existingByContents, childStandard.contents);
        return {
          id: existingChild?.id ?? uuidv4(),
          sourceId: source.id,
          parentTaskId: issueTask.id,
          type: "Github" as const,
          url: childStandard.url,
          contents: childStandard.contents,
          status: childStandard.status,
          rank: parsed.rank,
          data: childData
        };
      });

      return [
        issueTask,
        ...childTasks.map((task, index) => ({
          ...task,
          parentTaskId: parsedChildren[index]?.parentIndex === undefined
            ? issueTask.id
            : childTasks[parsedChildren[index].parentIndex!]?.id
        }))
      ];
    });
}
