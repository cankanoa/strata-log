import { describe, expect, it } from "vitest";
import { createMarkdownTaskText, deleteMarkdownTaskText, syncMarkdownTaskSource, updateMarkdownTaskText } from "@/lib/task-sync";
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
  internalTaskColumns: {},
  internalTasks: [],
  activeTasks: [],
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
    expect(tasks[0]?.status).toBe(true);
    expect(tasks[1]?.status).toBe(false);
  });

  it("imports markdown task field tags without keeping them in the title", () => {
    const tasks = syncMarkdownTaskSource(baseFile, source, [
      {
        path: "/notes/today.md",
        markdown: "- [ ] Upload more satellite data [test:: this]\n- [ ] Figure out consistent servers"
      }
    ]);

    expect(tasks[0]?.contents).toBe("Upload more satellite data");
    expect(tasks[0]?.data.test).toBe("this");
    expect(tasks[1]?.contents).toBe("Figure out consistent servers");
  });

  it("stores a normalized markdown task hash and byte segment length", () => {
    const spaced = syncMarkdownTaskSource(baseFile, source, [
      { path: "/notes/today.md", markdown: "# Today\n\n- [ ] Upload more satellite data [test:: this]\n" }
    ]);
    const compact = syncMarkdownTaskSource(baseFile, source, [
      { path: "/notes/today.md", markdown: "- [ ] Uploadmoresatellitedata [test::this]" }
    ]);

    expect(spaced[0]?.hash).toBe(compact[0]?.hash);
    expect(spaced[0]?.byteLength).toBeGreaterThan("- [ ] Upload more satellite data [test:: this]".length);
  });

  it("keeps markdown status tags as fields while checkbox state controls task status", () => {
    const tasks = syncMarkdownTaskSource(baseFile, source, [
      { path: "/notes/today.md", markdown: "- [ ] Validate imported rows [Status:: completed]" }
    ]);

    expect(tasks[0]?.contents).toBe("Validate imported rows");
    expect(tasks[0]?.status).toBe(true);
    expect(tasks[0]?.data.Status).toBe("completed");
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
    expect(tasks[0]?.status).toBe(false);
  });

  it("updates duplicate markdown tasks from the byte-length anchor", () => {
    const markdown = "- [ ] First [tag:: a]\n- [ ] Same [tag:: b]\n- [ ] Same [tag:: b]\n";
    const tasks = syncMarkdownTaskSource(baseFile, source, [
      { path: "/notes/today.md", markdown }
    ]);
    const edited = updateMarkdownTaskText(
      `# Later notes\n\n${markdown}`,
      tasks[1]!,
      tasks,
      "title",
      "Updated"
    );

    expect(edited).toContain("- [ ] Updated [tag:: b]");
    expect(edited.match(/- \[ \] Same \[tag:: b\]/g)).toHaveLength(1);
  });

  it("adds markdown task rows from editable field values", () => {
    const markdown = createMarkdownTaskText("# Today\n", {
      title: "Write summary",
      status: false,
      Project: "Atlas"
    });

    expect(markdown).toContain("- [x] Write summary [Project:: Atlas]");
  });

  it("deletes markdown task rows with the shared locator", () => {
    const markdown = "- [ ] First\n- [ ] Remove me\n- [ ] Last\n";
    const tasks = syncMarkdownTaskSource(baseFile, source, [{ path: "/notes/today.md", markdown }]);
    const edited = deleteMarkdownTaskText(markdown, tasks[1]!, tasks);

    expect(edited).toBe("- [ ] First\n- [ ] Last\n");
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
