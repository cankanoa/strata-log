export type FieldType =
  | "uuid"
  | "string"
  | "path"
  | "markdown_glob"
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

export type TaskSourceType = "Markdown" | "Github";

export type TaskSource = {
  id: string;
  type: TaskSourceType;
  url: string;
  name?: string;
  accountId?: string;
};

export type TaskRowStatus = "completed" | undefined;

export type TaskRow = {
  id: string;
  sourceId: string;
  parentTaskId?: string;
  type: TaskSourceType;
  url: string;
  contents: string;
  status?: TaskRowStatus;
  rank: string;
  data: Record<string, unknown>;
};

export type OnlineAccountType = "Github";

export type OnlineAccount = {
  id: string;
  type: OnlineAccountType;
  name: string;
  username?: string;
  token?: string;
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
  accounts: OnlineAccount[];
  entries: EntryInterval[];
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

export type TaskItem = {
  id: string;
  kind: string;
  title: string;
  path: string;
  sourceLabel: string;
};
