import { beforeEach, describe, expect, it, vi } from "vitest";
import { taskSourceCreationChoices, taskSourceCreationGroups } from "@/lib/task-query";
import type { TaskSource, TimeLogFile } from "@/lib/types";

const githubMock = vi.hoisted(() => {
  const endpoints = {
    listForOrg: vi.fn(),
    listForUser: vi.fn(),
    listForRepo: vi.fn()
  };
  return {
    endpoints,
    paginate: vi.fn()
  };
});

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(() => ({
    paginate: githubMock.paginate,
    rest: {
      repos: {
        listForOrg: githubMock.endpoints.listForOrg,
        listForUser: githubMock.endpoints.listForUser
      },
      issues: {
        listForRepo: githubMock.endpoints.listForRepo
      }
    }
  }))
}));

const { fetchGithubIssueTasks, isGithubAuthError } = await import("@/lib/task-sync");

const source: TaskSource = {
  id: "550e8400-e29b-41d4-a716-446655440100",
  type: "Github",
  url: "acme"
};

const baseFile: TimeLogFile = {
  version: 1,
  fields: {},
  attributeReferenceGroups: [],
  sessionPresets: [],
  taskSources: [source],
  tasks: [],
  internalTaskColumns: {},
  internalTasks: [],
  activeTasks: [],
  accounts: [],
  entries: []
};

describe("GitHub owner task sources", () => {
  beforeEach(() => {
    githubMock.paginate.mockReset();
  });

  it("imports owned repos separately under one source", async () => {
    githubMock.paginate.mockImplementation(async (endpoint, params: { owner?: string; repo?: string }) => {
      if (endpoint === githubMock.endpoints.listForOrg) {
        return [
          { name: "api", full_name: "acme/api", owner: { login: "acme" } },
          { name: "site", full_name: "acme/site", owner: { login: "acme" } },
          { name: "outside", full_name: "other/outside", owner: { login: "other" } }
        ];
      }
      if (endpoint === githubMock.endpoints.listForRepo) {
        return [{
          number: params.repo === "api" ? 1 : 2,
          title: `${params.repo} issue`,
          html_url: `https://github.com/${params.owner}/${params.repo}/issues/${params.repo === "api" ? 1 : 2}`,
          state: "open",
          updated_at: "2026-07-19T12:00:00Z",
          body: ""
        }];
      }
      return [];
    });

    const tasks = await fetchGithubIssueTasks(baseFile, source);

    expect(githubMock.paginate).toHaveBeenCalledWith(githubMock.endpoints.listForRepo, expect.objectContaining({ owner: "acme", repo: "api" }));
    expect(githubMock.paginate).toHaveBeenCalledWith(githubMock.endpoints.listForRepo, expect.objectContaining({ owner: "acme", repo: "site" }));
    expect(tasks.map((task) => task.sourceId)).toEqual([source.id, source.id]);
    expect(tasks.map((task) => task.url)).toEqual([
      "https://github.com/acme/api/issues/1",
      "https://github.com/acme/site/issues/2"
    ]);
    expect(tasks.map((task) => task.data.repository)).toEqual(["acme/api", "acme/site"]);
  });

  it("uses expanded repos as GitHub task creation choices", () => {
    expect(taskSourceCreationChoices([{ ...source, repositoryUrls: ["acme/site", "acme/api"] }])).toMatchObject([
      { id: `${source.id}:acme/api`, label: "acme/api", targetUrl: "acme/api" },
      { id: `${source.id}:acme/site`, label: "acme/site", targetUrl: "acme/site" }
    ]);
    expect(taskSourceCreationGroups([{ ...source, repositoryUrls: ["acme/site", "acme/api"] }])).toMatchObject([
      {
        id: source.id,
        label: "acme",
        nested: true,
        choices: [
          { id: `${source.id}:acme/api`, label: "acme/api", targetUrl: "acme/api" },
          { id: `${source.id}:acme/site`, label: "acme/site", targetUrl: "acme/site" }
        ]
      }
    ]);
  });

  it("does not treat forbidden public API responses as token-required auth", () => {
    const error = new Error("Forbidden") as Error & { status: number };
    error.status = 403;

    expect(isGithubAuthError(error)).toBe(false);
  });

  it("falls back to public user repos when the org endpoint is forbidden", async () => {
    githubMock.paginate.mockImplementation(async (endpoint, params: { owner?: string; repo?: string; username?: string }) => {
      if (endpoint === githubMock.endpoints.listForOrg) {
        const error = new Error("Forbidden") as Error & { status: number };
        error.status = 403;
        throw error;
      }
      if (endpoint === githubMock.endpoints.listForUser) {
        return [{ name: "public-repo", full_name: `${params.username}/public-repo`, owner: { login: params.username } }];
      }
      if (endpoint === githubMock.endpoints.listForRepo) {
        return [{
          number: 7,
          title: "public issue",
          html_url: `https://github.com/${params.owner}/${params.repo}/issues/7`,
          state: "open",
          updated_at: "2026-07-19T12:00:00Z",
          body: ""
        }];
      }
      return [];
    });

    const tasks = await fetchGithubIssueTasks(baseFile, source);

    expect(githubMock.paginate).toHaveBeenCalledWith(githubMock.endpoints.listForUser, expect.objectContaining({ username: "acme" }));
    expect(tasks.map((task) => task.url)).toEqual(["https://github.com/acme/public-repo/issues/7"]);
  });
});
