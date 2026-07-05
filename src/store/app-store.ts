import { create } from "zustand";
import { applyResolvedMetadataDefaults, getResolvedMetadataFields } from "@/lib/attribute-references";
import { ConflictService } from "@/services/conflict-service";
import { getPlatformApi, loadRawIntoFile } from "@/lib/platform";
import { normalizeMetadata } from "@/lib/metadata";
import { TimeLogDatabase } from "@/lib/time-log-database";
import { toIsoWithOffset } from "@/lib/time";
import type {
  AppSnapshot,
  EntryInterval,
  EntrySort,
  FieldDefinition,
  FileHandleInfo,
  MetadataFilter,
  SessionPreset,
  SessionMetadata,
  TimeLogFile
} from "@/lib/types";
import { parseTimeLogYaml, serializeTimeLogYaml } from "@/lib/yaml";
import { validateFile, validateMetadataPayload } from "@/lib/validation";
import { TimerService } from "@/services/timer-service";
import { TemplateService } from "@/services/template-service";

export type FocusMode = "focus" | "break";
export type FocusAlertMode = "sound" | "vibrate" | "both";

type StoreState = AppSnapshot & {
  errors: string[];
  entriesView: "list" | "week" | "month";
  sort: EntrySort;
  filters: MetadataFilter[];
  selectedEntryId: string | null;
  trackDraftMetadata: SessionMetadata;
  focusMode: FocusMode;
  focusSoundMode: FocusAlertMode;
  focusSelectedMinutes: number;
  focusCustomMinutes: string;
  focusStartedAt: number | null;
  focusDurationSeconds: number;
  focusEndsAt: number | null;
  focusCompletedAt: number | null;
  selectedTaskPath: string;
  watchCleanup: (() => void) | null;
  recentSaveRaws: Array<{ raw: string; savedAt: number }>;
  clearErrors: () => void;
  openFile: () => Promise<void>;
  unloadFile: () => void;
  createFileFromTemplate: (templateId: string) => Promise<void>;
  saveCurrentFile: () => Promise<void>;
  setFile: (file: TimeLogFile, options?: { markDirty?: boolean }) => void;
  setEntriesView: (view: StoreState["entriesView"]) => void;
  setSort: (key: string) => void;
  setFilters: (filters: MetadataFilter[]) => void;
  setSelectedEntryId: (entryId: string | null) => void;
  setTrackDraftMetadata: (metadata: SessionMetadata) => void;
  setFocusMode: (mode: FocusMode) => void;
  setFocusSoundMode: (mode: FocusAlertMode) => void;
  setFocusSelectedMinutes: (minutes: number) => void;
  setFocusCustomMinutes: (minutes: string) => void;
  startFocusTimer: () => void;
  pauseFocusTimer: () => void;
  resetFocusTimer: () => void;
  completeFocusTimer: () => void;
  setSelectedTaskPath: (path: string) => void;
  addManualEntry: (entry: Omit<EntryInterval, "id">) => Promise<boolean>;
  updateEntry: (entryId: string, entry: EntryInterval) => Promise<boolean>;
  deleteEntry: (entryId: string) => Promise<void>;
  updateSessionPresets: (presets: SessionPreset[]) => Promise<boolean>;
  startLiveEntry: (metadata: SessionMetadata) => Promise<boolean>;
  startLiveEntryAt: (metadata: SessionMetadata, start: string) => Promise<boolean>;
  stopLiveEntry: () => Promise<void>;
  addField: (name: string, field: FieldDefinition) => Promise<boolean>;
  renameField: (previousName: string, nextName: string) => Promise<boolean>;
  updateField: (name: string, nextField: FieldDefinition) => Promise<boolean>;
  updateFieldAttributeReferences: (name: string, labels: string[]) => Promise<boolean>;
  deleteField: (name: string) => Promise<boolean>;
  fillMissingFieldValues: (name: string, value: SessionMetadata[string]) => Promise<boolean>;
  addAttributeReferenceGroup: (label: string) => Promise<boolean>;
  renameAttributeReferenceGroup: (groupLabel: string, label: string) => Promise<boolean>;
  deleteAttributeReferenceGroup: (groupLabel: string) => Promise<boolean>;
  addAttributeReferenceField: (groupLabel: string, name: string, field: FieldDefinition) => Promise<boolean>;
  renameAttributeReferenceField: (groupLabel: string, previousName: string, nextName: string) => Promise<boolean>;
  updateAttributeReferenceField: (groupLabel: string, name: string, nextField: FieldDefinition) => Promise<boolean>;
  deleteAttributeReferenceField: (groupLabel: string, name: string) => Promise<boolean>;
  reloadFromDiskVersion: () => void;
  dismissConflict: () => void;
};

async function watchHandle(handle: FileHandleInfo, set: (partial: Partial<StoreState>) => void, get: () => StoreState) {
  const cleanup = await getPlatformApi().watchFile(handle.path, async (raw) => {
    const current = get();
    if (!current.fileHandle || current.fileHandle.path !== handle.path) {
      return;
    }
    const recentSaveRaws = current.recentSaveRaws.filter((saved) => Date.now() - saved.savedAt < 10_000);
    if (recentSaveRaws.some((saved) => saved.raw === raw)) {
      set({ recentSaveRaws });
      return;
    }
    if (recentSaveRaws.length !== current.recentSaveRaws.length) {
      set({ recentSaveRaws });
    }
    const parsed = parseTimeLogYaml(raw);
    if (!parsed.file || parsed.errors.length > 0) {
      set({ errors: parsed.errors });
      return;
    }
    const rawCurrent = current.file ? serializeTimeLogYaml(current.file) : "";
    if (rawCurrent === raw) {
      return;
    }
    set({
      conflict: ConflictService.conflict(
        "The open file changed on disk. Review the disk version before saving again.",
        parsed.file
      )
    });
  });
  set({ watchCleanup: cleanup });
}

function normalizeEntry(file: TimeLogFile, entry: Omit<EntryInterval, "id"> | EntryInterval) {
  const resolvedFields = getResolvedMetadataFields(file);
  const intervalMetadata = Boolean(entry.intervalMetadata);

  return {
    ...entry,
    intervalMetadata,
    metadata: intervalMetadata
      ? {}
      : applyResolvedMetadataDefaults(file, normalizeMetadata(resolvedFields, entry.metadata ?? {})),
    intervals: (entry.intervals ?? []).map((interval) => ({
      ...interval,
      metadata: intervalMetadata
        ? applyResolvedMetadataDefaults(file, normalizeMetadata(resolvedFields, interval.metadata))
        : {}
    }))
  };
}

function validateEntry(file: TimeLogFile, entry: Omit<EntryInterval, "id"> | EntryInterval): string[] {
  if (entry.intervalMetadata) {
    return (entry.intervals ?? []).flatMap((interval) => validateMetadataPayload(file.fields, interval.metadata, file));
  }

  return validateMetadataPayload(file.fields, entry.metadata, file);
}

export const useAppStore = create<StoreState>((set, get) => ({
  file: null,
  fileHandle: null,
  hasUnsavedChanges: false,
  conflict: ConflictService.clean(),
  errors: [],
  entriesView: "list",
  sort: { key: "start", direction: "desc" },
  filters: [],
  selectedEntryId: null,
  trackDraftMetadata: {},
  focusMode: "focus",
  focusSoundMode: "sound",
  focusSelectedMinutes: 15,
  focusCustomMinutes: "",
  focusStartedAt: null,
  focusDurationSeconds: 15 * 60,
  focusEndsAt: null,
  focusCompletedAt: null,
  selectedTaskPath: "",
  watchCleanup: null,
  recentSaveRaws: [],

  clearErrors() {
    set({ errors: [] });
  },

  setFile(file, options) {
    const validation = validateFile(file);
    set({
      file,
      trackDraftMetadata: applyResolvedMetadataDefaults(file, normalizeMetadata(getResolvedMetadataFields(file), get().trackDraftMetadata)),
      errors: validation.errors,
      hasUnsavedChanges: options?.markDirty ?? true
    });
  },

  async openFile() {
    const response = await getPlatformApi().openFile();
    if (!response) {
      return;
    }
    let parsed: TimeLogFile;
    try {
      parsed = await loadRawIntoFile(response.raw);
    } catch (error) {
      set({
        errors: [error instanceof Error ? error.message : "Failed to open file."]
      });
      return;
    }
    get().watchCleanup?.();
    set({
      file: parsed,
      fileHandle: response.handle,
      trackDraftMetadata: applyResolvedMetadataDefaults(parsed, normalizeMetadata(getResolvedMetadataFields(parsed), get().trackDraftMetadata)),
      errors: [],
      hasUnsavedChanges: false,
      conflict: ConflictService.clean(),
      recentSaveRaws: []
    });
    await watchHandle(response.handle, set, get);
  },

  unloadFile() {
    get().watchCleanup?.();
    set({
      file: null,
      fileHandle: null,
      hasUnsavedChanges: false,
      conflict: ConflictService.clean(),
      errors: [],
      trackDraftMetadata: {},
      selectedEntryId: null,
      filters: [],
      watchCleanup: null,
      recentSaveRaws: []
    });
  },

  async createFileFromTemplate(templateId) {
    const template = TemplateService.getTemplate(templateId);
    if (!template) {
      set({ errors: [`Template "${templateId}" was not found.`] });
      return;
    }
    const raw = serializeTimeLogYaml(template.content);
    const response = await getPlatformApi().createFileFromTemplate(`strata-log-${templateId}`, raw);
    if (!response) {
      return;
    }
    get().watchCleanup?.();
    set({
      file: template.content,
      fileHandle: response.handle,
      trackDraftMetadata: applyResolvedMetadataDefaults(template.content, normalizeMetadata(getResolvedMetadataFields(template.content), {})),
      errors: [],
      hasUnsavedChanges: false,
      conflict: ConflictService.clean(),
      recentSaveRaws: []
    });
    await watchHandle(response.handle, set, get);
  },

  async saveCurrentFile() {
    const state = get();
    if (!state.file || !state.fileHandle) {
      set({ errors: ["Open or create a file before saving."] });
      return;
    }
    if (state.conflict.status === "conflict") {
      set({ errors: [state.conflict.message] });
      return;
    }
    const validation = validateFile(state.file);
    if (validation.errors.length > 0) {
      set({ errors: validation.errors });
      return;
    }
    const raw = serializeTimeLogYaml(state.file);
    set({ recentSaveRaws: [...state.recentSaveRaws, { raw, savedAt: Date.now() }].slice(-10) });
    await getPlatformApi().saveFile(state.fileHandle.path, raw);
    set({ hasUnsavedChanges: false, errors: [] });
  },

  setEntriesView(view) {
    set({ entriesView: view });
  },

  setSort(key) {
    const current = get().sort;
    set({
      sort: {
        key,
        direction: current.key === key && current.direction === "desc" ? "asc" : "desc"
      }
    });
  },

  setFilters(filters) {
    set({ filters });
  },

  setSelectedEntryId(selectedEntryId) {
    set({ selectedEntryId });
  },

  setTrackDraftMetadata(trackDraftMetadata) {
    const file = get().file;
    const fields = file ? getResolvedMetadataFields(file) : undefined;
    set({
      trackDraftMetadata: fields
        ? applyResolvedMetadataDefaults(file, normalizeMetadata(fields, trackDraftMetadata))
        : trackDraftMetadata
    });
  },

  setFocusMode(focusMode) {
    set({ focusMode });
  },

  setFocusSoundMode(focusSoundMode) {
    set({ focusSoundMode });
  },

  setFocusSelectedMinutes(focusSelectedMinutes) {
    set((state) => ({
      focusSelectedMinutes,
      focusCustomMinutes: "",
      focusDurationSeconds: state.focusEndsAt ? state.focusDurationSeconds : focusSelectedMinutes * 60,
      focusCompletedAt: null
    }));
  },

  setFocusCustomMinutes(focusCustomMinutes) {
    const numeric = focusCustomMinutes.replace(/\D+/g, "");
    const parsed = Number.parseInt(numeric, 10);
    set((state) => ({
      focusCustomMinutes: numeric,
      focusDurationSeconds:
        state.focusEndsAt || Number.isNaN(parsed) || parsed <= 0 ? state.focusDurationSeconds : parsed * 60,
      focusCompletedAt: null
    }));
  },

  startFocusTimer() {
    const state = get();
    const parsedCustom = Number.parseInt(state.focusCustomMinutes, 10);
    const durationSeconds =
      state.focusCompletedAt && state.focusDurationSeconds > 0
        ? state.focusDurationSeconds
        : !Number.isNaN(parsedCustom) && parsedCustom > 0
          ? parsedCustom * 60
          : state.focusSelectedMinutes * 60;
    const startedAt = Date.now();
    set({
      focusStartedAt: startedAt,
      focusDurationSeconds: durationSeconds,
      focusEndsAt: startedAt + durationSeconds * 1000,
      focusCompletedAt: null
    });
  },

  pauseFocusTimer() {
    const state = get();
    if (!state.focusEndsAt) {
      return;
    }
    const remainingSeconds = Math.max(0, Math.ceil((state.focusEndsAt - Date.now()) / 1000));
    set({
      focusStartedAt: null,
      focusDurationSeconds: remainingSeconds,
      focusEndsAt: null
    });
  },

  resetFocusTimer() {
    const state = get();
    const parsedCustom = Number.parseInt(state.focusCustomMinutes, 10);
    const durationSeconds =
      !Number.isNaN(parsedCustom) && parsedCustom > 0 ? parsedCustom * 60 : state.focusSelectedMinutes * 60;
    set({
      focusStartedAt: null,
      focusDurationSeconds: durationSeconds,
      focusEndsAt: null,
      focusCompletedAt: null
    });
  },

  completeFocusTimer() {
    set({
      focusStartedAt: null,
      focusDurationSeconds: 0,
      focusEndsAt: null,
      focusCompletedAt: Date.now()
    });
  },

  setSelectedTaskPath(selectedTaskPath) {
    set({ selectedTaskPath });
  },

  async addManualEntry(entry) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before adding an entry."] });
      return false;
    }
    const nextEntry = normalizeEntry(current, entry);
    const validationErrors = validateEntry(current, nextEntry);
    if (validationErrors.length > 0) {
      set({ errors: validationErrors });
      return false;
    }
    const next = TimeLogDatabase.addEntry(current, TimerService.createEntry(nextEntry));
    set({ file: next, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async updateEntry(entryId, entry) {
    const current = get().file;
    if (!current) {
      return false;
    }
    const nextEntry = normalizeEntry(current, entry);
    const validationErrors = validateEntry(current, nextEntry);
    if (validationErrors.length > 0) {
      set({ errors: validationErrors });
      return false;
    }
    const next = TimerService.updateEntry(current, entryId, {
      ...entry,
      ...nextEntry
    });
    set({ file: next, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async deleteEntry(entryId) {
    const current = get().file;
    if (!current) {
      return;
    }
    set({
      file: TimerService.deleteEntry(current, entryId),
      hasUnsavedChanges: true
    });
    await get().saveCurrentFile();
  },

  async updateSessionPresets(presets) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing presets."] });
      return false;
    }
    const next = TimeLogDatabase.setSessionPresets(current, presets);
    const validation = validateFile(next);
    if (!validation.file) {
      set({ errors: validation.errors });
      return false;
    }
    set({ file: validation.file, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async startLiveEntry(metadata) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before starting a timer."] });
      return false;
    }
    const resolvedFields = getResolvedMetadataFields(current);
    const normalizedMetadata = applyResolvedMetadataDefaults(current, normalizeMetadata(resolvedFields, metadata));
    const validationErrors = validateMetadataPayload(current.fields, normalizedMetadata, current);
    if (validationErrors.length > 0) {
      set({ errors: validationErrors });
      return false;
    }
    const next = TimerService.startLiveEntry(current, normalizedMetadata, toIsoWithOffset(new Date()), false);
    set({ file: next, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async startLiveEntryAt(metadata, start) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before starting a timer."] });
      return false;
    }
    const resolvedFields = getResolvedMetadataFields(current);
    const normalizedMetadata = applyResolvedMetadataDefaults(current, normalizeMetadata(resolvedFields, metadata));
    const validationErrors = validateMetadataPayload(current.fields, normalizedMetadata, current);
    if (validationErrors.length > 0) {
      set({ errors: validationErrors });
      return false;
    }
    const next = TimerService.startLiveEntry(current, normalizedMetadata, start, false);
    set({ file: next, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async stopLiveEntry() {
    const current = get().file;
    if (!current) {
      return;
    }
    set({
      file: TimerService.stopLiveEntry(current, toIsoWithOffset(new Date())),
      hasUnsavedChanges: true
    });
    await get().saveCurrentFile();
  },

  async addField(name, field) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing fields."] });
      return false;
    }
    const next = TimeLogDatabase.addField(current, name, field);
    const validation = validateFile(next);
    if (!validation.file) {
      set({ errors: validation.errors });
      return false;
    }
    set({ file: validation.file, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async renameField(previousName, nextName) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing fields."] });
      return false;
    }
    const next = TimeLogDatabase.renameField(current, previousName, nextName);
    const validation = validateFile(next);
    if (!validation.file) {
      set({ errors: validation.errors });
      return false;
    }
    set({ file: validation.file, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async updateField(name, nextField) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing fields."] });
      return false;
    }
    if (!current.fields[name]) {
      set({ errors: [`Field "${name}" was not found.`] });
      return false;
    }
    const next = TimeLogDatabase.updateField(current, name, nextField);
    const validation = validateFile(next);
    if (!validation.file) {
      set({ errors: validation.errors });
      return false;
    }
    set({ file: validation.file, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async updateFieldAttributeReferences(name, labels) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing fields."] });
      return false;
    }
    const next = TimeLogDatabase.setAttributeReferenceGroupsForField(current, name, labels);
    const validation = validateFile(next);
    if (!validation.file) {
      set({ errors: validation.errors });
      return false;
    }
    set({ file: validation.file, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async deleteField(name) {
    const current = get().file;
    if (!current) {
      return false;
    }
    const next = TimeLogDatabase.deleteField(current, name);
    const validation = validateFile(next);
    if (!validation.file) {
      set({ errors: validation.errors });
      return false;
    }
    set({
      file: validation.file,
      hasUnsavedChanges: true
    });
    await get().saveCurrentFile();
    return true;
  },

  async fillMissingFieldValues(name, value) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing fields."] });
      return false;
    }
    const next = TimeLogDatabase.fillMissingFieldValues(current, name, value);
    set({
      file: next,
      hasUnsavedChanges: true,
      errors: []
    });
    await get().saveCurrentFile();
    return true;
  },

  async addAttributeReferenceGroup(label) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing attribute references."] });
      return false;
    }
    const next = TimeLogDatabase.addAttributeReferenceGroup(current, label);
    const validation = validateFile(next);
    if (!validation.file) {
      set({ errors: validation.errors });
      return false;
    }
    set({ file: validation.file, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async renameAttributeReferenceGroup(groupLabel, label) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing attribute references."] });
      return false;
    }
    const next = TimeLogDatabase.renameAttributeReferenceGroup(current, groupLabel, label);
    const validation = validateFile(next);
    if (!validation.file) {
      set({ errors: validation.errors });
      return false;
    }
    set({ file: validation.file, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async deleteAttributeReferenceGroup(groupLabel) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing attribute references."] });
      return false;
    }
    const next = TimeLogDatabase.deleteAttributeReferenceGroup(current, groupLabel);
    const validation = validateFile(next);
    if (!validation.file) {
      set({ errors: validation.errors });
      return false;
    }
    set({ file: validation.file, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async addAttributeReferenceField(groupLabel, name, field) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing attribute references."] });
      return false;
    }
    const next = TimeLogDatabase.addField(current, name, field, groupLabel);
    const validation = validateFile(next);
    if (!validation.file) {
      set({ errors: validation.errors });
      return false;
    }
    set({ file: validation.file, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async renameAttributeReferenceField(groupLabel, previousName, nextName) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing attribute references."] });
      return false;
    }
    const next = TimeLogDatabase.renameField(current, previousName, nextName, groupLabel);
    const validation = validateFile(next);
    if (!validation.file) {
      set({ errors: validation.errors });
      return false;
    }
    set({ file: validation.file, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async updateAttributeReferenceField(groupLabel, name, nextField) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing attribute references."] });
      return false;
    }
    const next = TimeLogDatabase.updateField(current, name, nextField, groupLabel);
    const validation = validateFile(next);
    if (!validation.file) {
      set({ errors: validation.errors });
      return false;
    }
    set({ file: validation.file, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async deleteAttributeReferenceField(groupLabel, name) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing attribute references."] });
      return false;
    }
    const next = TimeLogDatabase.deleteField(current, name, groupLabel);
    const validation = validateFile(next);
    if (!validation.file) {
      set({ errors: validation.errors });
      return false;
    }
    set({ file: validation.file, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  reloadFromDiskVersion() {
    const conflict = get().conflict;
    if (conflict.status !== "conflict") {
      return;
    }
    set({
      file: conflict.diskVersion,
      conflict: ConflictService.clean(),
      errors: [],
      hasUnsavedChanges: false
    });
  },

  dismissConflict() {
    set({ conflict: ConflictService.clean() });
  }
}));
