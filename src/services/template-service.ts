import type { TimeLogFile } from "@/lib/types";
import { parseTimeLogYaml } from "@/lib/yaml";
import blankTemplateRaw from "../../templates/blank.csdb?raw";
import officeWorkerTemplateRaw from "../../templates/office-worker.csdb?raw";
import paidClientWorkTemplateRaw from "../../templates/paid-client-work.csdb?raw";
import simplePersonalTodoTemplateRaw from "../../templates/simple-personal-todo.csdb?raw";
import softwareDeveloperTemplateRaw from "../../templates/software-developer.csdb?raw";

export const TEMPLATE_OPTIONS = [
  { id: "blank", name: "Blank" },
  { id: "simple-personal-todo", name: "Simple Personal Todo" },
  { id: "office-worker", name: "Office Worker" },
  { id: "paid-client-work", name: "Paid Client Work" },
  { id: "software-developer", name: "Software Developer" }
] as const;

type TemplateId = typeof TEMPLATE_OPTIONS[number]["id"];

const templateModules: Record<TemplateId, string> = {
  blank: blankTemplateRaw,
  "office-worker": officeWorkerTemplateRaw,
  "paid-client-work": paidClientWorkTemplateRaw,
  "simple-personal-todo": simplePersonalTodoTemplateRaw,
  "software-developer": softwareDeveloperTemplateRaw
};

export type TemplateDefinition = {
  id: string;
  name: string;
  content: TimeLogFile;
};

function buildTemplate(option: typeof TEMPLATE_OPTIONS[number]): TemplateDefinition | null {
  const parsed = parseTimeLogYaml(templateModules[option.id]);
  const content = parsed.file;
  return content ? { ...option, content } : null;
}

export const TemplateService = {
  listTemplates(): TemplateDefinition[] {
    return TEMPLATE_OPTIONS.flatMap((option) => {
      const template = buildTemplate(option);
      return template ? [template] : [];
    });
  },
  getTemplate(id: string): TemplateDefinition | undefined {
    const option = TEMPLATE_OPTIONS.find((template) => template.id === id);
    return option ? buildTemplate(option) ?? undefined : undefined;
  }
};
