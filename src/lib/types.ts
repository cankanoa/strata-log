export type FieldType =
  | "uuid"
  | "string"
  | "markdown"
  | "path"
  | "file_search"
  | "filter_task_sources"
  | "attribute_reference"
  | "datetime"
  | "bool"
  | "int"
  | "float";

export type FieldSelection = "single" | "select" | "multiselect";
export type FieldVisibility = "editable" | "viewable" | "hidden" | "addable";

export type MetadataValue = boolean | number | string | Array<boolean | number | string> | undefined;
export type SessionMetadata = Record<string, MetadataValue>;

export type SessionPreset = {
  id: string;
  name: string;
  metadata: SessionMetadata;
};

export type TaskSourceType = "Markdown" | "Github" | "Internal Task";
export type ImportedTaskSourceType = Exclude<TaskSourceType, "Internal Task">;

export type TaskSource = {
  id: string;
  type: TaskSourceType;
  url: string;
  name?: string;
  accountId?: string;
  columnNames?: string[];
  repositoryUrls?: string[];
  lastUpdatedAt?: string;
};

export type TaskRowStatus = boolean | undefined;
export type TaskTableName = "tasks" | "tasks_internal";

export type TaskRow = {
  id: string;
  sourceId: string;
  parentTaskId?: string;
  type: TaskSourceType;
  url: string;
  contents: string;
  status?: TaskRowStatus;
  rank: string;
  hash?: string;
  byteLength?: number;
  updatedAt?: string;
  data: Record<string, unknown>;
};

export type TaskDisplayRow = {
  id: string;
  sourceId: string;
  parentTaskId?: string;
  taskTable: TaskTableName;
  type: TaskSourceType;
  url: string;
  contents: string;
  status?: TaskRowStatus;
  rank: string;
  hash?: string;
  byteLength?: number;
  updatedAt?: string;
  data: Record<string, unknown>;
};

export type TaskFieldMetadata = {
  sourceId?: string;
  path: string;
  label: string;
  type: "string" | "markdown" | "number" | "bool" | "datetime" | "select" | "multiselect";
  editable: boolean;
  options?: string[];
  fieldId?: string | number;
  updateKind?: "github_issue" | "github_issue_field" | "markdown_field";
};

export type GeneralSettings = {
  refreshRateSeconds: number;
  taskFieldMetadata: Record<string, TaskFieldMetadata[]>;
};

export type OnlineAccountType = "Github";

export type OnlineAccount = {
  id: string;
  type: OnlineAccountType;
  name: string;
  username?: string;
  token?: string;
};

export type InternalTaskRow = {
  id: string;
  taskSourceId: string;
  values: SessionMetadata;
};

export type ActiveTaskReference = {
  taskId: string;
  table: TaskTableName;
};

export type FieldDefinition = {
  id?: string;
  type: FieldType;
  selection?: FieldSelection;
  options?: string[];
  interval?: boolean;
  required?: boolean;
  visibility: FieldVisibility;
  default?: MetadataValue | null;
};

export type AttributeReferenceGroup = {
  label: string;
  fields: Record<string, FieldDefinition>;
};

export type TimeInterval = {
  id?: string;
  start?: string;
  end?: string;
  metadata?: SessionMetadata;
};

export type EntryInterval = {
  id: string;
  type?: string;
  intervals?: TimeInterval[];
  metadata?: SessionMetadata;
};

export type TimeLogFile = {
  version: 1;
  fields: Record<string, FieldDefinition>;
  attributeReferenceGroups: AttributeReferenceGroup[];
  sessionPresets: SessionPreset[];
  taskSources: TaskSource[];
  tasks: TaskRow[];
  internalTaskColumns: Record<string, FieldDefinition>;
  internalTasks: InternalTaskRow[];
  activeTasks: ActiveTaskReference[];
  accounts: OnlineAccount[];
  entries: EntryInterval[];
  settings?: GeneralSettings;
};

export type MetadataFilter = {
  field: string;
  value: string;
};

export type EntrySortKey = "start" | "end" | "duration" | string;

export type EntrySort = {
  key: EntrySortKey;
  direction: "asc" | "desc";
};

export type FileHandleInfo = {
  path: string;
  name: string;
};

export type ConflictState =
  | {
      status: "clean";
    }
  | {
      status: "conflict";
      message: string;
      diskVersion: TimeLogFile;
    };

export type AppSnapshot = {
  file: TimeLogFile | null;
  fileHandle: FileHandleInfo | null;
  hasUnsavedChanges: boolean;
  conflict: ConflictState;
};
