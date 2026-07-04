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
        choose: "single",
        required: false,
        editable: true,
        default: null
      },
      "Hourly Pay": {
        type: "string",
        choose: "single",
        required: false,
        editable: true,
        default: null
      },
      Job: {
        type: "string",
        choose: "select",
        options: ["[Client Work]Client Work", "[Internal]Internal", "[Admin]Admin"],
        required: false,
        editable: true,
        default: null
      },
      Activity: {
        type: "string",
        choose: "single",
        required: false,
        editable: true,
        default: null
      }
    },
    attributeReferenceGroups: [],
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
    return Array.from(uniqueTemplates.values());
  },
  getTemplate(id: string): TemplateDefinition | undefined {
    return this.listTemplates().find((template) => template.id === id);
  }
};
