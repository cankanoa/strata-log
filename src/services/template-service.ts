import { BUILTIN_FIELD_DEFINITIONS } from "@/lib/metadata";
import type { TimeLogFile } from "@/lib/types";
import { parseTimeLogYaml } from "@/lib/yaml";
import defaultTemplateRaw from "../../templates/default.csdb?raw";

const templateModules = import.meta.glob("/templates/*.csdb", {
  query: "?raw",
  import: "default",
  eager: true
}) as Record<string, string>;

export type TemplateDefinition = {
  id: string;
  name: string;
  content: TimeLogFile;
};

function createFallbackDefaultTemplate(): TimeLogFile {
  return {
    version: 1,
    fields: {
      ...BUILTIN_FIELD_DEFINITIONS,
      Project: {
        type: "string",
        selection: "single",
        required: false,
        visibility: "editable",
        default: null
      },
      "Hourly Pay": {
        type: "string",
        selection: "single",
        required: false,
        visibility: "editable",
        default: null
      },
      Job: {
        type: "string",
        selection: "select",
        options: ["[Client Work]Client Work", "[Internal]Internal", "[Admin]Admin"],
        required: false,
        visibility: "editable",
        default: null
      },
      Activity: {
        type: "string",
        selection: "single",
        required: false,
        visibility: "editable",
        default: null
      }
    },
    attributeReferenceGroups: [],
    sessionPresets: [],
    entries: []
  };
}

function buildGuaranteedDefaultTemplate(): TemplateDefinition {
  const parsed = parseTimeLogYaml(defaultTemplateRaw);
  return {
    id: "default",
    name: "Default",
    content: parsed.file ?? createFallbackDefaultTemplate()
  };
}

export const TemplateService = {
  listTemplates(): TemplateDefinition[] {
    const guaranteedDefault = buildGuaranteedDefaultTemplate();
    const templates = Object.entries(templateModules).flatMap(([path, raw]) => {
      const id = path.split("/").pop()?.replace(/\.csdb$/, "") ?? "template";
      const parsed = parseTimeLogYaml(raw);
      if (!parsed.file) {
        return [];
      }
      return [{
        id,
        name: id.replace(/[-_]/g, " ").replace(/\b\w/g, (value) => value.toUpperCase()),
        content: parsed.file
      }];
    });
    const uniqueTemplates = new Map<string, TemplateDefinition>([[guaranteedDefault.id, guaranteedDefault]]);
    templates.forEach((template) => {
      uniqueTemplates.set(template.id, template);
    });
    return Array.from(uniqueTemplates.values()).sort((left, right) => {
      const order = ["blank", "default"];
      const leftIndex = order.indexOf(left.id);
      const rightIndex = order.indexOf(right.id);
      if (leftIndex !== -1 || rightIndex !== -1) {
        return (leftIndex === -1 ? order.length : leftIndex) - (rightIndex === -1 ? order.length : rightIndex);
      }
      return left.name.localeCompare(right.name);
    });
  },
  getTemplate(id: string): TemplateDefinition | undefined {
    return this.listTemplates().find((template) => template.id === id);
  }
};
