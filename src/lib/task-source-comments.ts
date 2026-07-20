import type { CSDBDatabase } from "@/lib/csdb";
import { githubOwnerTarget, normalizeGithubRepoSlugs } from "@/lib/github-task-sources";
import type { TaskSource } from "@/lib/types";

const TASK_SOURCE_REPOSITORIES_COMMENT = "github_repositories";

type RepositoryComment = Record<string, string[]>;

function commentObject(value: unknown): RepositoryComment {
  const parsed = typeof value === "string"
    ? (() => {
        try {
          return JSON.parse(value) as unknown;
        } catch {
          return {};
        }
      })()
    : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(parsed).flatMap(([key, repos]) =>
      Array.isArray(repos)
        ? [[key, repos.filter((repo): repo is string => typeof repo === "string")]]
        : []
    )
  );
}

export function readTaskSourceRepositoryComment(db: CSDBDatabase): RepositoryComment {
  return commentObject(db.getTableComment("task_sources", TASK_SOURCE_REPOSITORIES_COMMENT));
}

export function writeTaskSourceRepositoryComment(db: CSDBDatabase, sources: TaskSource[]) {
  const entries = sources.flatMap((source) => {
    const sourceUrl = source.url.trim();
    const repos = normalizeGithubRepoSlugs(source.repositoryUrls ?? [], githubOwnerTarget(sourceUrl)?.owner);
    return source.type === "Github" && sourceUrl && repos.length > 0 ? [[sourceUrl, repos] as const] : [];
  });
  db.setTableComment(
    "task_sources",
    TASK_SOURCE_REPOSITORIES_COMMENT,
    entries.length > 0 ? JSON.stringify(Object.fromEntries(entries)) : undefined
  );
}
