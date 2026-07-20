import { describe, expect, it } from "vitest";
import { taskDisplayRows } from "@/lib/task-query";
import { filterTaskDisplayRowsBySourceUrls, getTrackTaskSourceFilterUrls } from "@/lib/task-source-filters";
import type { TaskRow, TaskSource, TimeLogFile } from "@/lib/types";

const sources: TaskSource[] = [
  { id: "github-source", type: "Github", url: "spectralmatch/spectralmatch" },
  { id: "markdown-source", type: "Markdown", url: "/notes/**/*.md" },
  { id: "internal-source", type: "Internal Task", url: "internal-task:source" }
];

function task(id: string, source: TaskSource): TaskRow {
  return {
    id,
    sourceId: source.id,
    type: source.type,
    url: `${source.url}/${id}`,
    contents: id,
    status: true,
    rank: id,
    data: {}
  };
}

const file: TimeLogFile = {
  version: 1,
  fields: {
    PrimarySource: { type: "filter_task_sources", selection: "select", visibility: "editable" },
    MoreSources: { type: "filter_task_sources", selection: "multiselect", visibility: "editable" }
  },
  attributeReferenceGroups: [],
  sessionPresets: [],
  taskSources: sources,
  tasks: sources.map((source) => task(source.id, source)),
  internalTaskColumns: {},
  internalTasks: [],
  activeTasks: [],
  accounts: [],
  entries: []
};

describe("task source track filters", () => {
  it("combines all selected filter task source values before displaying tasks", () => {
    const metadata = {
      PrimarySource: sources[0]!.url,
      MoreSources: [sources[1]!.url, sources[0]!.url]
    };

    expect([...getTrackTaskSourceFilterUrls(file, metadata)].sort()).toEqual([
      sources[1]!.url,
      sources[0]!.url
    ].sort());
    expect(filterTaskDisplayRowsBySourceUrls(file, taskDisplayRows(file), getTrackTaskSourceFilterUrls(file, metadata)).map((row) => row.sourceId)).toEqual([
      "github-source",
      "markdown-source"
    ]);
  });

  it("shows all tasks when no track task source filter is selected", () => {
    const selectedUrls = getTrackTaskSourceFilterUrls(file, {});

    expect(selectedUrls.size).toBe(0);
    expect(taskDisplayRows(file).map((row) => row.sourceId)).toEqual([
      "github-source",
      "markdown-source",
      "internal-source"
    ]);
  });
});
