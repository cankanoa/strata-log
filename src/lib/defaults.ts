import { BUILTIN_FIELD_DEFINITIONS } from "@/lib/metadata";
import type { TimeLogFile } from "@/lib/types";

export const defaultTimeLogFile: TimeLogFile = {
  version: 1,
  fields: { ...BUILTIN_FIELD_DEFINITIONS },
  attributeReferenceGroups: [],
  sessionPresets: [],
  entries: []
};
