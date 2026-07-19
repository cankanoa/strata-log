import { describe, expect, it } from "vitest";
import { TEMPLATE_OPTIONS, TemplateService } from "@/services/template-service";
import { parseTimeLogYaml } from "@/lib/yaml";
import blankRaw from "../../templates/blank.csdb?raw";
import officeWorkerRaw from "../../templates/office-worker.csdb?raw";
import paidClientWorkRaw from "../../templates/paid-client-work.csdb?raw";
import simplePersonalTodoRaw from "../../templates/simple-personal-todo.csdb?raw";
import softwareDeveloperRaw from "../../templates/software-developer.csdb?raw";

describe("TemplateService", () => {
  it("loads the built-in workflow templates", () => {
    [
      ["blank", blankRaw],
      ["simple-personal-todo", simplePersonalTodoRaw],
      ["office-worker", officeWorkerRaw],
      ["paid-client-work", paidClientWorkRaw],
      ["software-developer", softwareDeveloperRaw]
    ].forEach(([id, raw]) => {
      const parsed = parseTimeLogYaml(raw);
      expect(parsed.errors, id).toEqual([]);
      expect(parsed.file, id).not.toBeNull();
    });

    const templates = TemplateService.listTemplates();
    const byId = new Map(templates.map((template) => [template.id, template]));
    const templateIds = TEMPLATE_OPTIONS.map((template) => template.id);

    expect(templates.map((template) => template.id)).toEqual(templateIds);
    expect(templateIds).toEqual([
      "blank",
      "simple-personal-todo",
      "office-worker",
      "paid-client-work",
      "software-developer"
    ]);

    expect(templates[0]?.id).toBe("blank");
    expect(byId.get("blank")!.content.internalTaskColumns.title?.required).toBe(true);
    expect(byId.get("blank")!.content.internalTaskColumns.body?.type).toBe("markdown");
    expect(Object.keys(byId.get("simple-personal-todo")!.content.fields)).toContain("Area");
    expect(Object.keys(byId.get("office-worker")!.content.fields)).toContain("Workstream");
    expect(Object.keys(byId.get("paid-client-work")!.content.fields)).toContain("Billable");
    expect(byId.get("software-developer")!.content.fields.Repo?.type).toBe("file_search");
    expect(byId.get("software-developer")!.content.taskSources.filter((source) => source.type === "Internal Task")).toHaveLength(1);
  });
});
