import { describe, expect, it } from "vitest";
import { syncMarkdownTaskSource } from "@/lib/task-sync";
import type { TaskSource, TimeLogFile } from "@/lib/types";

const source: TaskSource = {
  id: "550e8400-e29b-41d4-a716-446655440100",
  type: "Markdown",
  url: "**/*.md"
};

const baseFile: TimeLogFile = {
  version: 1,
  fields: {},
  attributeReferenceGroups: [],
  sessionPresets: [],
  taskSources: [source],
  tasks: [],
  accounts: [],
  entries: []
};

describe("task sync", () => {
  it("imports markdown task bullets", () => {
    const tasks = syncMarkdownTaskSource(baseFile, source, [
      { path: "/notes/today.md", markdown: "- [ ] Draft plan\n- [x] Ship fix" }
    ]);

    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.contents).toBe("Draft plan");
    expect(tasks[0]?.url).toContain("/notes/today.md:");
    expect(tasks[1]?.status).toBe("completed");
  });

  it("preserves matching task rows when markdown order changes", () => {
    const existing = syncMarkdownTaskSource(baseFile, source, [
      { path: "/notes/today.md", markdown: "- [ ] First\n- [ ] Second" }
    ]);
    const tasks = syncMarkdownTaskSource({ ...baseFile, tasks: existing }, source, [
      { path: "/notes/today.md", markdown: "- [x] Second\n- [ ] First" }
    ]);

    expect(tasks.find((task) => task.contents === "Second")?.id).toBe(existing[1]?.id);
    expect(tasks[0]?.contents).toBe("Second");
    expect(tasks[0]?.status).toBe("completed");
  });

  it("links nested markdown tasks to their parent task uuid", () => {
    const tasks = syncMarkdownTaskSource(baseFile, source, [
      {
        path: "/notes/today.md",
        markdown: "- [ ] Parent\n  - [ ] Child\n    - [x] Grandchild\n- [ ] Sibling"
      }
    ]);

    expect(tasks[1]?.parentTaskId).toBe(tasks[0]?.id);
    expect(tasks[2]?.parentTaskId).toBe(tasks[1]?.id);
    expect(tasks[3]?.parentTaskId).toBeUndefined();
  });
});
