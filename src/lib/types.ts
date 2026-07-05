export type FieldType =
  | "uuid"
  | "string"
  | "path"
  | "markdown_glob"
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

export type FieldDefinition = {
  id?: string;
  type: FieldType;
  selection?: FieldSelection;
  options?: string[];
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
  intervalMetadata?: boolean;
  intervals?: TimeInterval[];
  metadata?: SessionMetadata;
};

export type TimeLogFile = {
  version: 1;
  fields: Record<string, FieldDefinition>;
  attributeReferenceGroups: AttributeReferenceGroup[];
  sessionPresets: SessionPreset[];
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
