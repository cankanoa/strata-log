import type { TaskRow, TaskSource } from "@/lib/types";

export type GithubRepoTarget = {
  owner: string;
  repo: string;
};

export type GithubSourceTarget = {
  owner: string;
  repo?: string;
};

export function parseGithubSourceTarget(value: string): GithubSourceTarget | null {
  const cleaned = value
    .trim()
    .replace(/^git@github\.com:/i, "")
    .replace(/^https?:\/\/api\.github\.com\/repos\//i, "")
    .replace(/^https?:\/\/github\.com\//i, "")
    .replace(/^github\.com\//i, "")
    .split(/[?#]/)[0]
    .replace(/^\/+|\/+$/g, "");
  const [owner, repo] = cleaned.split("/").filter(Boolean);
  return owner
    ? {
        owner: owner.replace(/^@/, ""),
        repo: repo?.replace(/\.git$/i, "")
      }
    : null;
}

export function githubRepoTarget(value: string, fallbackOwner?: string): GithubRepoTarget | null {
  const target = parseGithubSourceTarget(value);
  if (target?.repo) {
    return { owner: target.owner, repo: target.repo };
  }
  if (target && fallbackOwner) {
    return { owner: fallbackOwner, repo: target.owner };
  }
  return null;
}

export function githubOwnerTarget(value: string): { owner: string } | null {
  const target = parseGithubSourceTarget(value);
  return target && !target.repo ? { owner: target.owner } : null;
}

export function githubRepoSlug(repo: GithubRepoTarget): string {
  return `${repo.owner}/${repo.repo}`;
}

export function githubRepoUrl(repo: GithubRepoTarget): string {
  return `https://github.com/${githubRepoSlug(repo)}`;
}

export function normalizeGithubRepoSlugs(values: string[], fallbackOwner?: string): string[] {
  return [...new Set(values.flatMap((value) => {
    const repo = githubRepoTarget(value, fallbackOwner);
    return repo ? [githubRepoSlug(repo)] : [];
  }))].sort((left, right) => left.localeCompare(right));
}

export function githubRepoSlugsForSource(source: TaskSource): string[] {
  if (source.type !== "Github") {
    return [];
  }
  const direct = githubRepoTarget(source.url);
  if (direct) {
    return [githubRepoSlug(direct)];
  }
  return normalizeGithubRepoSlugs(source.repositoryUrls ?? [], githubOwnerTarget(source.url)?.owner);
}

export function githubSourceForRepository(source: TaskSource, repository: string): TaskSource {
  const repo = githubRepoTarget(repository, githubOwnerTarget(source.url)?.owner);
  return repo ? { ...source, url: githubRepoSlug(repo) } : source;
}

export function githubRepositoryFromTask(source: TaskSource, task: TaskRow): GithubRepoTarget | null {
  const issueUrlTarget = githubRepoTarget(task.url);
  if (issueUrlTarget) {
    return issueUrlTarget;
  }
  const repository = task.data.repository;
  const repositoryTarget = typeof repository === "string"
    ? githubRepoTarget(repository)
    : repository && typeof repository === "object" && "full_name" in repository
      ? githubRepoTarget(String((repository as { full_name?: unknown }).full_name ?? ""))
      : null;
  if (repositoryTarget) {
    return repositoryTarget;
  }
  const repositoryUrlTarget = typeof task.data.repository_url === "string" ? githubRepoTarget(task.data.repository_url) : null;
  return repositoryUrlTarget ?? githubRepoTarget(source.url);
}

export function githubRepositorySlugFromTask(source: TaskSource, task: TaskRow): string | undefined {
  const repo = githubRepositoryFromTask(source, task);
  return repo ? githubRepoSlug(repo) : undefined;
}
