import { BUILTIN_FIELD_DEFINITIONS } from "@/lib/metadata";
import type { GeneralSettings, TimeLogFile } from "@/lib/types";

export const defaultGeneralSettings: GeneralSettings = {
  refreshRateSeconds: 60,
  taskFieldMetadata: {}
};

export const defaultTimeLogFile: TimeLogFile = {
  version: 1,
  fields: { ...BUILTIN_FIELD_DEFINITIONS },
  attributeReferenceGroups: [],
  sessionPresets: [],
  taskSources: [],
  tasks: [],
  internalTaskColumns: {},
  internalTasks: [],
  activeTasks: [],
  accounts: [],
  entries: [],
  settings: defaultGeneralSettings
};
