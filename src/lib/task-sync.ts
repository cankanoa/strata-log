import { v4 as uuidv4 } from "uuid";
import { LexoRank } from "lexorank";
import { Octokit } from "@octokit/rest";
import {
  githubOwnerTarget,
  githubRepoSlug,
  githubRepoSlugsForSource,
  githubRepoTarget,
  githubRepoUrl,
  githubRepositoryFromTask,
  normalizeGithubRepoSlugs,
  type GithubRepoTarget
} from "@/lib/github-task-sources";
import { extractMarkdownFieldsFromData, hashMarkdownTask } from "@/lib/markdown-task-identity";
import type { MetadataValue, OnlineAccount, TaskFieldMetadata, TaskRow, TaskSource, TimeLogFile } from "@/lib/types";

type ParsedMarkdownTask = {
  filePath: string;
  contents: string;
  status: boolean;
  rank: string;
  parentIndex?: number;
  fields: Record<string, string>;
  hash: string;
  byteLength: number;
  startByte: number;
  endByte: number;
  startIndex: number;
  endIndex: number;
  indent: string;
  marker: string;
  prefix: string;
  checked: boolean;
  lineEnd: string;
};

type GithubClient = InstanceType<typeof Octokit>;

type GithubRepoApiItem = {
  name?: string | null;
  full_name?: string | null;
  owner?: { login?: string | null } | null;
};

type GithubIssueApiItem = {
  number: number;
  title: string;
  body?: string | null;
  html_url?: string | null;
  state?: string | null;
  updated_at?: string | null;
  pull_request?: unknown;
} & Record<string, unknown>;

export type MarkdownTaskFile = {
  path: string;
  markdown: string;
  updatedAt?: string;
};

const TASK_FIELD_PATTERN = /\s*\[([^\[\]:]+)::\s*([^\]]*)\]/g;
const STANDARD_FIELD_ALIASES = {
  title: ["title", "name", "contents", "content", "text", "summary"],
  status: ["status", "state", "completed", "done", "checked"],
  url: ["html_url", "url", "link", "path", "filePath"],
  parentUrl: ["parentUrl", "parent_url", "parentIssueUrl", "parent_issue_url", "parent", "parentIssue", "parent_issue"]
};

const GITHUB_ISSUE_STATE_OPTIONS = ["open", "closed"];
const GITHUB_ISSUE_STATE_REASON_OPTIONS = ["completed", "not_planned", "duplicate", "reopened"];
const textEncoder = new TextEncoder();

function githubRepoFromApiItem(repo: GithubRepoApiItem, fallbackOwner: string): GithubRepoTarget | null {
  const fullNameTarget = typeof repo.full_name === "string" ? githubRepoTarget(repo.full_name) : null;
  const owner = fullNameTarget?.owner ?? repo.owner?.login ?? fallbackOwner;
  const name = fullNameTarget?.repo ?? repo.name;
  return owner && name ? { owner, repo: name } : null;
}

function uniqueText(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort((left, right) => left.localeCompare(right));
}

function errorStatus(error: unknown): number {
  return typeof error === "object" && error && "status" in error ? Number(error.status) : 0;
}

function byteLength(text: string): number {
  return textEncoder.encode(text).length;
}

function markdownLines(markdown: string): Array<{
  line: string;
  lineEnd: string;
  startIndex: number;
  endIndex: number;
  startByte: number;
  endByte: number;
}> {
  const lines: Array<{
    line: string;
    lineEnd: string;
    startIndex: number;
    endIndex: number;
    startByte: number;
    endByte: number;
  }> = [];
  let startIndex = 0;
  let startByte = 0;
  const matcher = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(markdown))) {
    if (match[0] === "" && match.index === markdown.length) {
      break;
    }
    const raw = match[0];
    const rawByteLength = byteLength(raw);
    lines.push({
      line: match[1],
      lineEnd: match[2],
      startIndex,
      endIndex: startIndex + raw.length,
      startByte,
      endByte: startByte + rawByteLength
    });
    startIndex += raw.length;
    startByte += rawByteLength;
  }
  return lines;
}

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
    const direct = entries.find(([key, child]) =>
      alias.toLowerCase() === key.toLowerCase() && child !== undefined && child !== null
    );
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

function standardStatus(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  const text = valueText(value)?.toLowerCase();
  if (!text) {
    return undefined;
  }
  if (["open", "active", "true", "1"].includes(text)) {
    return true;
  }
  if (["x", "false", "0", "closed", "completed", "complete", "done"].includes(text)) {
    return false;
  }
  return undefined;
}

function standardTaskFields(data: Record<string, unknown>, fallback: { title: string; url: string; status: boolean }) {
  return {
    contents: valueText(findAliasedValue(data, STANDARD_FIELD_ALIASES.title)) ?? fallback.title,
    url: valueText(findAliasedValue(data, STANDARD_FIELD_ALIASES.url)) ?? fallback.url,
    status: standardStatus(findAliasedValue(data, STANDARD_FIELD_ALIASES.status)) ?? fallback.status
  };
}

function githubIssueUrlFromUnknown(value: unknown, repository?: string): string | undefined {
  if (typeof value === "string") {
    if (/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+/i.test(value)) {
      return value;
    }
    const number = Number(value.match(/#?(\d+)$/)?.[1]);
    return repository && Number.isFinite(number) && number > 0
      ? `https://github.com/${repository}/issues/${number}`
      : undefined;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const direct = valueText(record.html_url) ?? valueText(record.url);
  if (direct) {
    return githubIssueUrlFromUnknown(direct, repository);
  }
  const fullName = valueText(record.repository) ?? valueText(record.repository_full_name) ?? repository;
  const number = typeof record.number === "number" ? record.number : Number(valueText(record.number));
  return fullName && Number.isFinite(number) && number > 0
    ? `https://github.com/${fullName}/issues/${number}`
    : undefined;
}

function parentUrlFromData(data: Record<string, unknown>, repository?: string): string | undefined {
  return githubIssueUrlFromUnknown(findAliasedValue(data, STANDARD_FIELD_ALIASES.parentUrl), repository);
}

function parseMarkdownTaskContents(rawContents: string): { contents: string; fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  const contents = rawContents.replace(TASK_FIELD_PATTERN, (_match, key: string, value: string) => {
    const name = key.trim();
    if (name) {
      fields[name] = value.trim();
    }
    return "";
  }).replace(/\s{2,}/g, " ").trim();
  return { contents, fields };
}

function parseMarkdownTaskLine(line: string): {
  body: string;
  checked: boolean;
  indent: string;
  marker: string;
  prefix: string;
} | null {
  const indentLength = line.match(/^\s*/)?.[0].length ?? 0;
  let index = indentLength;
  const indent = line.slice(0, indentLength);
  let marker = "";
  let prefix = indent;
  if (line[index] && "-*+".includes(line[index]) && /\s/.test(line[index + 1] ?? "")) {
    marker = line[index];
    index += 2;
    while (line[index] === " " || line[index] === "\t") {
      index += 1;
    }
    prefix = line.slice(0, index);
  }
  if (line[index] !== "[") {
    return null;
  }
  const check = line[index + 1];
  let checked = false;
  let bodyStart = -1;
  if ((check === "x" || check === "X") && line[index + 2] === "]") {
    checked = true;
    bodyStart = index + 3;
  } else if (check === "]") {
    bodyStart = index + 2;
  } else if ((check === " " || check === "\t") && line[index + 2] === "]") {
    bodyStart = index + 3;
  }
  if (bodyStart < 0) {
    return null;
  }
  return {
    body: line.slice(bodyStart).trim(),
    checked,
    indent,
    marker,
    prefix
  };
}

export function parseMarkdownTasks(filePath: string, markdown: string): ParsedMarkdownTask[] {
  let rank = LexoRank.middle();
  const tasks: ParsedMarkdownTask[] = [];
  const parentStack: Array<{ indent: number; index: number }> = [];
  let previousTaskEndByte = 0;

  markdownLines(markdown).forEach((line) => {
    const match = parseMarkdownTaskLine(line.line);
    if (!match) {
      return;
    }
    const parsedContents = parseMarkdownTaskContents(match.body);
    const contents = parsedContents.contents;
    if (!contents) {
      return;
    }

    const indent = match.indent.replace(/\t/g, "    ").length;
    while (parentStack.length > 0 && parentStack.at(-1)!.indent >= indent) {
      parentStack.pop();
    }
    const taskHash = hashMarkdownTask(contents, parsedContents.fields);
    const task: ParsedMarkdownTask = {
      filePath,
      contents,
      status: !match.checked,
      rank: rank.toString(),
      parentIndex: parentStack.at(-1)?.index,
      fields: parsedContents.fields,
      hash: taskHash,
      byteLength: line.endByte - previousTaskEndByte,
      startByte: line.startByte,
      endByte: line.endByte,
      startIndex: line.startIndex,
      endIndex: line.endIndex,
      indent: match.indent,
      marker: match.marker,
      prefix: match.prefix,
      checked: match.checked,
      lineEnd: line.lineEnd
    };
    tasks.push(task);
    parentStack.push({ indent, index: tasks.length - 1 });
    rank = rank.genNext();
    previousTaskEndByte = line.endByte;
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

function markdownTaskFilePath(task: TaskRow): string {
  return typeof task.data.filePath === "string" ? task.data.filePath : task.url.replace(/:[^:]+$/, "");
}

function markdownTaskHash(task: TaskRow): string {
  return task.hash ?? hashMarkdownTask(task.contents, extractMarkdownFieldsFromData(task.data));
}

function markdownTaskSort(left: TaskRow, right: TaskRow): number {
  return left.url.localeCompare(right.url) || left.rank.localeCompare(right.rank);
}

export function syncMarkdownTaskSource(file: TimeLogFile, source: TaskSource, files: MarkdownTaskFile[]): TaskRow[] {
  const existingByFileAndHash = new Map<string, TaskRow[]>();
  [...sourceTasks(file, source.id)].sort(markdownTaskSort).forEach((task) => {
    const fileKey = `${markdownTaskFilePath(task)}\0${markdownTaskHash(task)}`;
    existingByFileAndHash.set(fileKey, [...(existingByFileAndHash.get(fileKey) ?? []), task]);
  });

  return files.flatMap((taskFile) => {
    const parsedTasks = parseMarkdownTasks(taskFile.path, taskFile.markdown);
    const syncedTasks = parsedTasks.map((parsed) => {
      const existing = takeFirst(existingByFileAndHash, `${parsed.filePath}\0${parsed.hash}`);
      const data = {
        title: parsed.contents,
        content: parsed.contents,
        status: parsed.status,
        checked: parsed.checked,
        filePath: parsed.filePath,
        url: `${parsed.filePath}:${parsed.rank}`,
        rank: parsed.rank,
        ...parsed.fields,
        __strata: { sourceType: "Markdown", markdownFields: parsed.fields }
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
        hash: parsed.hash,
        byteLength: parsed.byteLength,
        updatedAt: taskFile.updatedAt ?? existing?.updatedAt,
        data
      };
    });

    return syncedTasks.map((task, index) => ({
      ...task,
      parentUrl: parsedTasks[index]?.parentIndex === undefined
        ? undefined
        : syncedTasks[parsedTasks[index].parentIndex!]?.url
    }));
  });
}

export function isGithubAuthError(error: unknown): boolean {
  return [401, 404].includes(errorStatus(error));
}

async function githubReposForOwner(octokit: GithubClient, owner: string): Promise<GithubRepoTarget[]> {
  let repos: GithubRepoApiItem[];
  try {
    repos = await octokit.paginate(octokit.rest.repos.listForOrg, {
      org: owner,
      type: "all",
      per_page: 100
    }) as GithubRepoApiItem[];
  } catch (error) {
    if (![403, 404].includes(errorStatus(error))) {
      throw error;
    }
    repos = await octokit.paginate(octokit.rest.repos.listForUser, {
      username: owner,
      type: "owner",
      per_page: 100
    }) as GithubRepoApiItem[];
  }

  return repos
    .flatMap((repo) => {
      const target = githubRepoFromApiItem(repo, owner);
      return target ? [target] : [];
    })
    .filter((repo) => repo.owner.toLowerCase() === owner.toLowerCase())
    .sort((left, right) => `${left.owner}/${left.repo}`.localeCompare(`${right.owner}/${right.repo}`));
}

async function githubReposForSource(source: TaskSource, octokit: GithubClient): Promise<GithubRepoTarget[]> {
  const storedRepos = githubRepoSlugsForSource(source).flatMap((repository) => {
    const repo = githubRepoTarget(repository);
    return repo ? [repo] : [];
  });
  if (storedRepos.length > 0) {
    return storedRepos;
  }
  const repo = githubRepoTarget(source.url);
  if (repo) {
    return [repo];
  }
  const owner = githubOwnerTarget(source.url);
  return owner ? githubReposForOwner(octokit, owner.owner) : [];
}

export async function fetchGithubTaskSourceRepositories(source: TaskSource, account?: OnlineAccount): Promise<TaskSource> {
  const owner = githubOwnerTarget(source.url);
  if (source.type !== "Github" || !owner) {
    return source.type === "Github" ? { ...source, repositoryUrls: undefined } : source;
  }
  const octokit = new Octokit(account?.token ? { auth: account.token } : {});
  return {
    ...source,
    repositoryUrls: normalizeGithubRepoSlugs(
      (await githubReposForOwner(octokit, owner.owner)).map(githubRepoSlug),
      owner.owner
    )
  };
}

export async function fetchGithubIssueTasks(
  file: TimeLogFile,
  source: TaskSource,
  account?: OnlineAccount
): Promise<TaskRow[]> {
  const octokit = new Octokit(account?.token ? { auth: account.token } : {});
  const repoIssues = await Promise.all(
    (await githubReposForSource(source, octokit)).map(async (repo) => {
      const openIssues = await octokit.paginate(octokit.rest.issues.listForRepo, {
        owner: repo.owner,
        repo: repo.repo,
        state: "open",
        per_page: 100
      }) as GithubIssueApiItem[];
      const issuesByNumber = new Map<number, { issue: GithubIssueApiItem; parentIssue?: GithubIssueApiItem }>();
      async function addIssueWithParents(issue: GithubIssueApiItem) {
        if (issue.pull_request || issuesByNumber.has(issue.number)) {
          return;
        }
        const parentIssue = await getGithubParentIssue(octokit, repo, issue.number) as GithubIssueApiItem | undefined;
        issuesByNumber.set(issue.number, { issue, parentIssue });
        if (parentIssue) {
          await addIssueWithParents(parentIssue);
        }
      }
      for (const issue of openIssues) {
        await addIssueWithParents(issue);
      }
      return {
        repo,
        issues: [...issuesByNumber.values()]
      };
    })
  );

  let rank = LexoRank.middle();
  const existingByUrl = new Map(sourceTasks(file, source.id).map((task) => [task.url, task]));
  const existingByContents = new Map<string, TaskRow[]>();
  sourceTasks(file, source.id).forEach((task) => {
    existingByContents.set(task.contents, [...(existingByContents.get(task.contents) ?? []), task]);
  });

  return repoIssues.flatMap(({ repo, issues }) => issues
    .flatMap(({ issue, parentIssue }) => {
      const repository = `${repo.owner}/${repo.repo}`;
      const url = issue.html_url ?? `${githubRepoUrl(repo)}/issues/${issue.number}`;
      const rawIssue = toJsonObject(issue);
      const rawParentIssue = parentIssue ? toJsonObject(parentIssue) : undefined;
      const issueData = {
        ...rawIssue,
        parentIssue: rawParentIssue,
        repository,
        repository_owner: repo.owner,
        repository_name: repo.repo,
        __strata: { sourceType: "Github", rawObjectType: "github_issue", repository }
      };
      const issueStandard = standardTaskFields(issueData, {
        title: issue.title,
        url,
        status: issue.state !== "closed"
      });
      const existing = existingByUrl.get(issueStandard.url) ?? takeFirst(existingByContents, issueStandard.contents);
      const issueTask: TaskRow = {
        id: existing?.id ?? uuidv4(),
        sourceId: source.id,
        type: "Github",
        parentUrl: parentUrlFromData(issueData, repository),
        url: issueStandard.url,
        contents: issueStandard.contents,
        status: issueStandard.status,
        rank: rank.toString(),
        updatedAt: issue.updated_at ?? existing?.updatedAt,
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
          checked: parsed.checked,
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
          parentUrl: issueTask.url,
          type: "Github" as const,
          url: childStandard.url,
          contents: childStandard.contents,
          status: childStandard.status,
          rank: parsed.rank,
          updatedAt: issue.updated_at ?? existingChild?.updatedAt,
          data: childData
        };
      });

      return [
        issueTask,
        ...childTasks.map((task, index) => ({
          ...task,
          parentUrl: parsedChildren[index]?.parentIndex === undefined
            ? issueTask.url
            : childTasks[parsedChildren[index].parentIndex!]?.url
        }))
      ];
    }));
}

async function getGithubParentIssue(octokit: GithubClient, repo: GithubRepoTarget, issueNumberValue: number): Promise<unknown | undefined> {
  try {
    const response = await octokit.request("GET /repos/{owner}/{repo}/issues/{issue_number}/parent", {
      owner: repo.owner,
      repo: repo.repo,
      issue_number: issueNumberValue
    });
    return response.data;
  } catch {
    return undefined;
  }
}

async function optionalPaginated<T>(callback: () => Promise<T[]>): Promise<T[]> {
  try {
    return await callback();
  } catch {
    return [];
  }
}

export async function fetchGithubTaskFieldMetadata(
  source: TaskSource,
  account?: OnlineAccount
): Promise<TaskFieldMetadata[]> {
  const octokit = new Octokit(account?.token ? { auth: account.token } : {});
  const repos = await githubReposForSource(source, octokit);
  if (repos.length === 0) {
    return [];
  }

  const repoOptions = await Promise.all(repos.map(async (repo) => {
    const [labels, assignees, milestones, issueTypes] = await Promise.all([
      optionalPaginated(() => octokit.paginate(octokit.rest.issues.listLabelsForRepo, {
        owner: repo.owner,
        repo: repo.repo,
        per_page: 100
      })),
      optionalPaginated(() => octokit.paginate(octokit.rest.issues.listAssignees, {
        owner: repo.owner,
        repo: repo.repo,
        per_page: 100
      })),
      optionalPaginated(() => octokit.paginate(octokit.rest.issues.listMilestones, {
        owner: repo.owner,
        repo: repo.repo,
        state: "all",
        per_page: 100
      })),
      optionalPaginated(() => octokit.paginate("GET /repos/{owner}/{repo}/issue-types", {
        owner: repo.owner,
        repo: repo.repo,
        per_page: 100
      } as never) as Promise<Array<{ name?: string }>>)
    ]);
    return { labels, assignees, milestones, issueTypes };
  }));
  const issueFields = (await Promise.all(
    uniqueText(repos.map((repo) => repo.owner)).map((org) => optionalPaginated(() => octokit.paginate("GET /orgs/{org}/issue-fields", {
      org,
      per_page: 100
    } as never) as Promise<Array<{
      id?: number;
      name?: string;
      data_type?: string;
      options?: Array<{ name?: string }>;
    }>>))
  )).flat();

  const baseFields: TaskFieldMetadata[] = [
    { sourceId: source.id, path: "title", label: "Title", type: "string", editable: true, updateKind: "github_issue" },
    { sourceId: source.id, path: "body", label: "Body", type: "markdown", editable: true, updateKind: "github_issue" },
    { sourceId: source.id, path: "state", label: "State", type: "select", editable: true, options: GITHUB_ISSUE_STATE_OPTIONS, updateKind: "github_issue" },
    { sourceId: source.id, path: "state_reason", label: "State Reason", type: "select", editable: true, options: GITHUB_ISSUE_STATE_REASON_OPTIONS, updateKind: "github_issue" },
    {
      sourceId: source.id,
      path: "labels",
      label: "Labels",
      type: "multiselect",
      editable: true,
      options: uniqueText(repoOptions.flatMap((options) => options.labels.map((label) => label.name))),
      updateKind: "github_issue"
    },
    {
      sourceId: source.id,
      path: "assignees",
      label: "Assignees",
      type: "multiselect",
      editable: true,
      options: uniqueText(repoOptions.flatMap((options) => options.assignees.map((assignee) => assignee.login))),
      updateKind: "github_issue"
    },
    {
      sourceId: source.id,
      path: "milestone",
      label: "Milestone",
      type: "select",
      editable: true,
      options: uniqueText(repoOptions.flatMap((options) => options.milestones.map((milestone) => milestone.title))),
      updateKind: "github_issue"
    },
    {
      sourceId: source.id,
      path: "type",
      label: "Issue Type",
      type: "select",
      editable: true,
      options: uniqueText(repoOptions.flatMap((options) => options.issueTypes.map((type) => type.name))),
      updateKind: "github_issue"
    }
  ];

  const customFields = [...issueFields.reduce<Map<string, TaskFieldMetadata>>((fields, field) => {
    const path = `issue_field_values.${field.name ?? field.id}`;
    const existing = fields.get(path);
    fields.set(path, {
      sourceId: source.id,
      path,
      label: field.name ?? `Field ${field.id}`,
      type: field.data_type === "number"
        ? "number"
        : field.data_type === "date"
          ? "datetime"
          : field.data_type === "single_select"
            ? "select"
            : field.data_type === "multi_select"
              ? "multiselect"
              : "string",
      editable: true,
      options: uniqueText([...(existing?.options ?? []), ...(field.options?.map((option) => option.name) ?? [])]),
      fieldId: existing?.fieldId ?? field.id,
      updateKind: "github_issue_field"
    });
    return fields;
  }, new Map()).values()];

  return [...baseFields, ...customFields];
}

function issueNumber(task: TaskRow): number | null {
  const raw = typeof task.data.number === "number"
    ? task.data.number
    : Number(String(task.url.match(/\/issues\/(\d+)/)?.[1] ?? ""));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function issueUrlNumber(url: string): number | null {
  const raw = Number(String(url.match(/\/issues\/(\d+)/)?.[1] ?? ""));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function githubIssueId(task: TaskRow): number | null {
  const raw = typeof task.data.id === "number" ? task.data.id : Number(String(task.data.id ?? ""));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

function parentIssueNumber(task: TaskRow): number | null {
  const parentIssue = task.data.parentIssue;
  const raw = parentIssue && typeof parentIssue === "object" && "number" in parentIssue
    ? Number((parentIssue as { number?: unknown }).number)
    : Number(String(task.url.match(/\/issues\/(\d+)/)?.[1] ?? ""));
  return Number.isFinite(raw) && raw > 0 ? raw : null;
}

async function removeGithubSubIssueParent(octokit: GithubClient, childRepo: GithubRepoTarget, task: TaskRow, subIssueId: number): Promise<void> {
  const childIssueNumber = issueNumber(task);
  if (!childIssueNumber) {
    return;
  }
  const currentParent = await getGithubParentIssue(octokit, childRepo, childIssueNumber);
  const parentUrl = githubIssueUrlFromUnknown(currentParent);
  const parentRepo = parentUrl ? githubRepoTarget(parentUrl) : childRepo;
  const parentNumber = parentUrl ? issueUrlNumber(parentUrl) : null;
  if (!parentRepo || !parentNumber) {
    return;
  }
  await octokit.request("DELETE /repos/{owner}/{repo}/issues/{issue_number}/sub_issue", {
    owner: parentRepo.owner,
    repo: parentRepo.repo,
    issue_number: parentNumber,
    sub_issue_id: subIssueId
  } as never);
}

export async function updateGithubTaskParent(
  source: TaskSource,
  task: TaskRow,
  parentUrl: string | undefined,
  account?: OnlineAccount
): Promise<void> {
  const childRepo = githubRepositoryFromTask(source, task);
  const subIssueId = githubIssueId(task);
  const rawObjectType = task.data.__strata && typeof task.data.__strata === "object"
    ? (task.data.__strata as { rawObjectType?: string }).rawObjectType
    : undefined;
  if (!childRepo || !subIssueId || rawObjectType !== "github_issue") {
    return;
  }
  const octokit = new Octokit(account?.token ? { auth: account.token } : {});
  if (!parentUrl) {
    await removeGithubSubIssueParent(octokit, childRepo, task, subIssueId);
    return;
  }
  const parentRepo = githubRepoTarget(parentUrl);
  const parentNumber = issueUrlNumber(parentUrl);
  if (!parentRepo || !parentNumber) {
    throw new Error("GitHub parent task must be a GitHub issue URL.");
  }
  await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/sub_issues", {
    owner: parentRepo.owner,
    repo: parentRepo.repo,
    issue_number: parentNumber,
    sub_issue_id: subIssueId,
    replace_parent: true
  } as never);
}

function valueArray(value: MetadataValue): string[] {
  return Array.isArray(value)
    ? value.map(String).filter((item) => item.trim().length > 0)
    : typeof value === "string" && value.trim()
      ? [value.trim()]
      : [];
}

function valueString(value: MetadataValue): string | null {
  if (value === undefined || Array.isArray(value)) {
    return null;
  }
  return value === null ? null : String(value);
}

function valueRecordText(value: MetadataValue): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (Array.isArray(value)) {
    const text = value.map(String).filter((item) => item.trim()).join(", ");
    return text || null;
  }
  const text = String(value).trim();
  return text || null;
}

function openStatusFromValue(value: MetadataValue): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  return openStatusFromText(valueRecordText(value) ?? "") ?? true;
}

function markdownTaskLineFromValues(values: Record<string, MetadataValue>, prefix = "- "): string {
  const contents = valueRecordText(values.title) ?? valueRecordText(values.contents) ?? "Untitled task";
  const checked = !openStatusFromValue(values.status);
  const fields = Object.entries(values)
    .filter(([key]) => !["contents", "parentUrl", "status", "title"].includes(key))
    .flatMap(([key, value]) => {
      const text = valueRecordText(value);
      return text ? [` [${key.replace(/^data:/, "")}:: ${text}]`] : [];
    })
    .join("");
  return `${prefix}[${checked ? "x" : " "}] ${contents}${fields}`;
}

export function createMarkdownTaskText(
  markdown: string,
  values: Record<string, MetadataValue>,
  options: { parentUrl?: string; tasks?: TaskRow[]; filePath?: string } = {}
): string {
  if (options.parentUrl && options.tasks?.length && options.filePath) {
    const parent = options.tasks.find((task) => task.url === options.parentUrl);
    if (!parent) {
      throw new Error("Parent task was not found.");
    }
    const parentTask = locateMarkdownTask(markdown, parent, options.tasks);
    if (!parentTask) {
      throw new Error("Parent markdown task could not be found in the source file.");
    }
    const parsedTasks = parseMarkdownTasks(options.filePath, markdown);
    const parentIndent = parentTask.indent.replace(/\t/g, "    ").length;
    const insertIndex = parsedTasks
      .filter((task) => task.startIndex > parentTask.startIndex)
      .find((task) => task.indent.replace(/\t/g, "    ").length <= parentIndent)?.startIndex ?? parentTask.endIndex;
    const line = markdownTaskLineFromValues(values, `${parentTask.indent}\t${parentTask.marker || "-"} `);
    const before = markdown.slice(0, insertIndex);
    return `${before}${before.endsWith("\n") || before.endsWith("\r") ? "" : "\n"}${line}\n${markdown.slice(insertIndex)}`;
  }
  const line = markdownTaskLineFromValues(values);
  if (!markdown.trim()) {
    return `${line}\n`;
  }
  return `${markdown}${markdown.endsWith("\n") ? "" : "\n"}${line}\n`;
}

export async function updateGithubTaskField(
  source: TaskSource,
  task: TaskRow,
  field: TaskFieldMetadata,
  value: MetadataValue,
  account?: OnlineAccount,
  tasks: TaskRow[] = [task]
): Promise<boolean> {
  const repo = githubRepositoryFromTask(source, task);
  const number = issueNumber(task);
  const rawObjectType = task.data.__strata && typeof task.data.__strata === "object"
    ? (task.data.__strata as { rawObjectType?: string }).rawObjectType
    : undefined;
  if (!repo) {
    return false;
  }
  const octokit = new Octokit(account?.token ? { auth: account.token } : {});
  if (field.path === "parentUrl") {
    if (rawObjectType === "github_checklist_task") {
      const parentNumber = parentIssueNumber(task);
      if (!parentNumber) {
        return false;
      }
      const issue = await octokit.rest.issues.get({ owner: repo.owner, repo: repo.repo, issue_number: parentNumber });
      await octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
        owner: repo.owner,
        repo: repo.repo,
        issue_number: parentNumber,
        body: updateMarkdownTaskParentText(issue.data.body ?? "", task, tasks, valueRecordText(value) ?? undefined)
      });
      return true;
    }
    await updateGithubTaskParent(source, task, valueRecordText(value) ?? undefined, account);
    return true;
  }
  if (field.path === "status" && rawObjectType === "github_checklist_task") {
    const parentNumber = parentIssueNumber(task);
    if (!parentNumber) {
      return false;
    }
    const issue = await octokit.rest.issues.get({ owner: repo.owner, repo: repo.repo, issue_number: parentNumber });
    await octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
        owner: repo.owner,
        repo: repo.repo,
        issue_number: parentNumber,
      body: updateMarkdownTaskText(issue.data.body ?? "", task, tasks, "status", value === false ? "closed" : "open")
    });
    return true;
  }
  if (rawObjectType === "github_checklist_task") {
    const parentNumber = parentIssueNumber(task);
    if (!parentNumber) {
      return false;
    }
    const issue = await octokit.rest.issues.get({ owner: repo.owner, repo: repo.repo, issue_number: parentNumber });
    await octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
      owner: repo.owner,
      repo: repo.repo,
      issue_number: parentNumber,
      body: updateMarkdownTaskText(
        issue.data.body ?? "",
        task,
        tasks,
        field.path,
        Array.isArray(value) ? value.join(", ") : String(value ?? "")
      )
    });
    return true;
  }
  if (!number || rawObjectType !== "github_issue") {
    return false;
  }
  if (field.updateKind === "github_issue_field" && field.fieldId !== undefined) {
    await octokit.request("POST /repos/{owner}/{repo}/issues/{issue_number}/issue-field-values", {
      owner: repo.owner,
      repo: repo.repo,
      issue_number: number,
      issue_field_values: [{
        field_id: Number(field.fieldId),
        value: field.type === "multiselect" ? valueArray(value) : valueString(value) ?? ""
      }]
    } as never);
    return true;
  }

  const payload: Record<string, unknown> = {};
  const path = field.path === "contents" ? "title" : field.path === "status" ? "state" : field.path;
  if (path === "labels" || path === "assignees") {
    payload[path] = valueArray(value);
  } else if (path === "milestone") {
    payload[path] = valueString(value);
  } else if (["title", "body", "state", "state_reason", "type"].includes(path)) {
    payload[path] = field.path === "status" ? (value === false ? "closed" : "open") : valueString(value);
  } else {
    return false;
  }
  await octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
    owner: repo.owner,
    repo: repo.repo,
    issue_number: number,
    ...payload
  } as never);
  return true;
}

export async function createGithubTask(
  source: TaskSource,
  values: Record<string, MetadataValue>,
  fields: TaskFieldMetadata[],
  account?: OnlineAccount
): Promise<void> {
  const repo = githubRepoTarget(source.url);
  if (!repo) {
    throw new Error("New GitHub tasks must be created from a repository task source.");
  }
  const octokit = new Octokit(account?.token ? { auth: account.token } : {});
  const response = await octokit.rest.issues.create({
    owner: repo.owner,
    repo: repo.repo,
    title: valueRecordText(values.title) ?? valueRecordText(values.contents) ?? "Untitled task",
    body: valueRecordText(values.body) ?? undefined,
    labels: valueArray(values.labels),
    assignees: valueArray(values.assignees)
  });
  const issueData = {
    ...toJsonObject(response.data),
    __strata: { sourceType: "Github", rawObjectType: "github_issue" }
  };
  const task: TaskRow = {
    id: uuidv4(),
    sourceId: source.id,
    type: "Github",
    url: response.data.html_url ?? `${source.url}/issues/${response.data.number}`,
    contents: response.data.title,
    status: response.data.state !== "closed",
    rank: LexoRank.middle().toString(),
    updatedAt: response.data.updated_at ?? undefined,
    data: issueData
  };
  if (typeof values.parentUrl === "string" && values.parentUrl.trim()) {
    await updateGithubTaskParent(source, task, values.parentUrl.trim(), account);
  }
  if (values.status !== undefined) {
    await updateGithubTaskField(
      source,
      task,
      {
        sourceId: source.id,
        path: "status",
        label: "Status",
        type: "bool",
        editable: true,
        options: ["Open", "Closed"],
        updateKind: "github_issue"
      },
      values.status,
      account
    );
  }
  await Promise.all(
    fields
      .filter((field) => field.editable && !["assignees", "body", "labels", "title"].includes(field.path) && values[field.path] !== undefined)
      .map((field) => updateGithubTaskField(source, task, field, values[field.path], account))
  );
}

export async function deleteGithubTask(
  source: TaskSource,
  task: TaskRow,
  tasks: TaskRow[],
  account?: OnlineAccount
): Promise<void> {
  const repo = githubRepositoryFromTask(source, task);
  if (!repo) {
    throw new Error("GitHub task repository could not be found.");
  }
  const octokit = new Octokit(account?.token ? { auth: account.token } : {});
  const rawObjectType = task.data.__strata && typeof task.data.__strata === "object"
    ? (task.data.__strata as { rawObjectType?: string }).rawObjectType
    : undefined;
  if (rawObjectType === "github_checklist_task") {
    const number = parentIssueNumber(task);
    if (!number) {
      throw new Error("GitHub checklist parent issue could not be found.");
    }
    const issue = await octokit.rest.issues.get({ owner: repo.owner, repo: repo.repo, issue_number: number });
    await octokit.request("PATCH /repos/{owner}/{repo}/issues/{issue_number}", {
      owner: repo.owner,
      repo: repo.repo,
      issue_number: number,
      body: deleteMarkdownTaskText(issue.data.body ?? "", task, tasks)
    });
    return;
  }
  const number = issueNumber(task);
  if (!number) {
    throw new Error("GitHub issue number could not be found.");
  }
  await octokit.request("DELETE /repos/{owner}/{repo}/issues/{issue_number}", {
    owner: repo.owner,
    repo: repo.repo,
    issue_number: number
  } as never);
}

function markdownTaskLineFromParsed(parsed: ParsedMarkdownTask, checked: boolean): string {
  const fields = Object.entries(parsed.fields)
    .filter(([, value]) => value.trim().length > 0)
    .map(([key, value]) => ` [${key}:: ${value}]`)
    .join("");
  return `${parsed.prefix}[${checked ? "x" : " "}] ${parsed.contents}${fields}${parsed.lineEnd}`;
}

function openStatusFromText(value: string): boolean | undefined {
  const text = value.toLowerCase().trim();
  if (["open", "active", "true", "1"].includes(text)) {
    return true;
  }
  if (["closed", "completed", "complete", "done", "false", "0", "x"].includes(text)) {
    return false;
  }
  return undefined;
}

export function estimateMarkdownTaskAnchorByte(task: TaskRow, tasks: TaskRow[]): number {
  const filePath = markdownTaskFilePath(task);
  let byteOffset = 0;
  const orderedTasks = tasks
    .filter((candidate) => candidate.type === "Markdown" && markdownTaskFilePath(candidate) === filePath)
    .sort(markdownTaskSort);
  for (const candidate of orderedTasks) {
    if (candidate.id === task.id) {
      return byteOffset;
    }
    byteOffset += Math.max(0, Math.floor(candidate.byteLength ?? 0));
  }
  return 0;
}

export function locateMarkdownTask(markdown: string, task: TaskRow, tasks: TaskRow[] = [task]): ParsedMarkdownTask | null {
  const filePath = markdownTaskFilePath(task);
  const targetHash = markdownTaskHash(task);
  const anchorByte = estimateMarkdownTaskAnchorByte(task, tasks);
  const parsedTasks = parseMarkdownTasks(filePath, markdown);
  const forwardTasks = parsedTasks
    .filter((candidate) => candidate.startByte >= anchorByte)
    .sort((left, right) => left.startByte - right.startByte);
  for (const candidate of forwardTasks) {
    if (candidate.hash === targetHash) {
      return candidate;
    }
  }
  const backwardTasks = parsedTasks
    .filter((candidate) => candidate.startByte < anchorByte)
    .sort((left, right) => right.startByte - left.startByte);
  for (const candidate of backwardTasks) {
    if (candidate.hash === targetHash) {
      return candidate;
    }
  }
  return null;
}

function updateParsedMarkdownTask(parsed: ParsedMarkdownTask, path: string, value: string): ParsedMarkdownTask {
  const next: ParsedMarkdownTask = {
    ...parsed,
    fields: { ...parsed.fields }
  };
  if (path === "contents" || path === "title") {
    next.contents = value;
  } else if (path === "status") {
    next.status = openStatusFromText(value) ?? true;
    next.checked = next.status === false;
  } else {
    const fieldName = path.replace(/^data:/, "");
    if (value.trim()) {
      next.fields[fieldName] = value;
    } else {
      delete next.fields[fieldName];
    }
  }
  next.hash = hashMarkdownTask(next.contents, next.fields);
  return next;
}

export function replaceMarkdownTask(
  markdown: string,
  task: ParsedMarkdownTask,
  updater: (task: ParsedMarkdownTask) => ParsedMarkdownTask
): string {
  const updatedTask = updater(task);
  return `${markdown.slice(0, task.startIndex)}${markdownTaskLineFromParsed(updatedTask, updatedTask.checked)}${markdown.slice(task.endIndex)}`;
}

function markdownTaskBlock(markdown: string, task: ParsedMarkdownTask, parsedTasks: ParsedMarkdownTask[]) {
  const indent = indentWidth(task.indent);
  const endIndex = parsedTasks
    .filter((candidate) => candidate.startIndex > task.startIndex)
    .find((candidate) => indentWidth(candidate.indent) <= indent)?.startIndex ?? task.endIndex;
  return {
    text: markdown.slice(task.startIndex, endIndex),
    startIndex: task.startIndex,
    endIndex
  };
}

function indentWidth(indent: string): number {
  return indent.replace(/\t/g, "    ").length;
}

function markdownUnsetParentBoundary(task: ParsedMarkdownTask, parsedTasks: ParsedMarkdownTask[]): ParsedMarkdownTask | undefined {
  const currentIndent = indentWidth(task.indent);
  const taskIndex = parsedTasks.findIndex((candidate) => candidate.startIndex === task.startIndex);
  for (let index = taskIndex - 1; index >= 0; index -= 1) {
    const candidate = parsedTasks[index];
    if (candidate && indentWidth(candidate.indent) < currentIndent) {
      return candidate;
    }
  }
  return undefined;
}

function reindentMarkdownBlock(block: string, currentIndent: string, nextIndent: string): string {
  return block
    .split(/(\r\n|\n|\r)/)
    .map((part, index, parts) => {
      if (index % 2 === 1 || index === parts.length - 1 && part === "") {
        return part;
      }
      return part.startsWith(currentIndent)
        ? `${nextIndent}${part.slice(currentIndent.length)}`
        : part;
    })
    .join("");
}

export function updateMarkdownTaskParentText(markdown: string, task: TaskRow, tasks: TaskRow[], parentUrl?: string): string {
  const filePath = markdownTaskFilePath(task);
  const parsedTasks = parseMarkdownTasks(filePath, markdown);
  const located = locateMarkdownTask(markdown, task, tasks);
  if (!located) {
    throw new Error("Markdown task could not be found in the source file.");
  }
  const block = markdownTaskBlock(markdown, located, parsedTasks);
  if (!parentUrl) {
    const boundary = markdownUnsetParentBoundary(located, parsedTasks);
    const nextBlock = reindentMarkdownBlock(block.text, located.indent, boundary?.indent ?? "");
    if (!boundary) {
      return `${markdown.slice(0, block.startIndex)}${nextBlock}${markdown.slice(block.endIndex)}`;
    }
    const withoutBlock = `${markdown.slice(0, block.startIndex)}${markdown.slice(block.endIndex)}`;
    return `${withoutBlock.slice(0, boundary.startIndex)}${nextBlock}${withoutBlock.slice(boundary.startIndex)}`;
  }
  const parent = tasks.find((candidate) => candidate.url === parentUrl);
  if (!parent) {
    throw new Error("Parent task was not found.");
  }
  const parentTask = locateMarkdownTask(markdown, parent, tasks);
  if (!parentTask) {
    throw new Error("Parent markdown task could not be found in the source file.");
  }
  const parentBlock = markdownTaskBlock(markdown, parentTask, parsedTasks);
  if (parentTask.startIndex >= block.startIndex && parentTask.startIndex < block.endIndex) {
    throw new Error("A task cannot be moved under itself.");
  }
  const nextIndent = `${parentTask.indent}\t`;
  const nextBlock = reindentMarkdownBlock(block.text, located.indent, nextIndent);
  const withoutBlock = `${markdown.slice(0, block.startIndex)}${markdown.slice(block.endIndex)}`;
  const removedBeforeParent = block.startIndex < parentBlock.endIndex;
  const insertIndex = removedBeforeParent
    ? parentBlock.endIndex - (block.endIndex - block.startIndex)
    : parentBlock.endIndex;
  const before = withoutBlock.slice(0, insertIndex);
  return `${before}${before.endsWith("\n") || before.endsWith("\r") ? "" : "\n"}${nextBlock}${nextBlock.endsWith("\n") || nextBlock.endsWith("\r") ? "" : "\n"}${withoutBlock.slice(insertIndex)}`;
}

export function updateMarkdownTaskText(
  markdown: string,
  task: TaskRow,
  tasks: TaskRow[],
  path: string,
  value: string
): string {
  const located = locateMarkdownTask(markdown, task, tasks);
  if (!located) {
    throw new Error("Markdown task could not be found in the source file.");
  }
  return replaceMarkdownTask(markdown, located, (parsed) => updateParsedMarkdownTask(parsed, path, value));
}

export function deleteMarkdownTaskText(markdown: string, task: TaskRow, tasks: TaskRow[] = [task]): string {
  const located = locateMarkdownTask(markdown, task, tasks);
  if (!located) {
    throw new Error("Markdown task could not be found in the source file.");
  }
  return `${markdown.slice(0, located.startIndex)}${markdown.slice(located.endIndex)}`;
}
