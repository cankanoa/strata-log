import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import {
  applyResolvedMetadataDefaults,
  getIntervalFields,
  getResolvedMetadataFields,
  getSessionFields
} from "@/lib/attribute-references";
import { ConflictService } from "@/services/conflict-service";
import type { DatabaseLocation } from "@/lib/database-registry";
import { getPlatformApi, loadRawIntoFile } from "@/lib/platform";
import { normalizeMetadata } from "@/lib/metadata";
import {
  TimeLogDatabase,
  type FieldOptionValueChange,
  type FieldOptionValueResolution
} from "@/lib/time-log-database";
import {
  fetchGithubIssueTasks,
  isGithubAuthError,
  syncMarkdownTaskSource
} from "@/lib/task-sync";
import { toIsoWithOffset } from "@/lib/time";
import type {
  AppSnapshot,
  EntryInterval,
  EntrySort,
  FieldDefinition,
  FileHandleInfo,
  MetadataFilter,
  OnlineAccount,
  SessionPreset,
  SessionMetadata,
  TaskSource,
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
  focusCustomSelected: boolean;
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
  loadDatabaseFile: (source: { location: DatabaseLocation; url: string }) => Promise<boolean>;
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
  updateTaskSources: (sources: TaskSource[]) => Promise<boolean>;
  updateAccounts: (accounts: OnlineAccount[]) => Promise<boolean>;
  syncTaskSource: (sourceId: string, githubToken?: string) => Promise<{ ok: boolean; authRequired?: boolean }>;
  startLiveEntry: (metadata: SessionMetadata) => Promise<boolean>;
  startLiveEntryAt: (metadata: SessionMetadata, start: string) => Promise<boolean>;
  stopLiveEntry: () => Promise<void>;
  addField: (name: string, field: FieldDefinition) => Promise<boolean>;
  renameField: (previousName: string, nextName: string) => Promise<boolean>;
  updateField: (
    name: string,
    nextField: FieldDefinition,
    optionResolution?: {
      changes: FieldOptionValueChange[];
      resolution: FieldOptionValueResolution;
    }
  ) => Promise<boolean>;
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
    const rawParsed = serializeTimeLogYaml(parsed.file);
    if (rawCurrent === raw || rawCurrent === rawParsed) {
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
  const sessionFields = getSessionFields(file);
  const intervalFields = getIntervalFields(file);

  return {
    ...entry,
    metadata: normalizeMetadata(sessionFields, entry.metadata ?? {}),
    intervals: (entry.intervals ?? []).map((interval) => ({
      ...interval,
      metadata: normalizeMetadata(intervalFields, interval.metadata)
    }))
  };
}

function validateEntry(file: TimeLogFile, entry: Omit<EntryInterval, "id"> | EntryInterval): string[] {
  return [
    ...validateMetadataPayload(getSessionFields(file), entry.metadata, file),
    ...(entry.intervals ?? []).flatMap((interval) => validateMetadataPayload(getIntervalFields(file), interval.metadata, file))
  ];
}

function pickMetadata(fields: Record<string, FieldDefinition>, metadata: SessionMetadata): SessionMetadata {
  return Object.fromEntries(Object.keys(fields).map((key) => [key, metadata[key]]));
}

function dirname(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/");
  parts.pop();
  return parts.join("/") || ".";
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
  focusCustomSelected: false,
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

  async loadDatabaseFile(source) {
    const response = await getPlatformApi().loadDatabaseFile(source);
    if (!response) {
      set({ errors: ["The selected database file could not be loaded."] });
      return false;
    }
    let parsed: TimeLogFile;
    try {
      parsed = await loadRawIntoFile(response.raw);
    } catch (error) {
      set({
        errors: [error instanceof Error ? error.message : "Failed to load database."]
      });
      return false;
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
    return true;
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
      focusCustomSelected: false,
      focusCustomMinutes: "",
      focusDurationSeconds: state.focusEndsAt ? state.focusDurationSeconds : focusSelectedMinutes * 60,
      focusCompletedAt: null
    }));
  },

  setFocusCustomMinutes(focusCustomMinutes) {
    const numeric = focusCustomMinutes.replace(/\D+/g, "");
    const parsed = Number.parseInt(numeric, 10);
    set((state) => ({
      focusCustomSelected: true,
      focusCustomMinutes: numeric,
      focusDurationSeconds:
        state.focusEndsAt ? state.focusDurationSeconds : Number.isNaN(parsed) || parsed <= 0 ? 0 : parsed * 60,
      focusCompletedAt: null
    }));
  },

  startFocusTimer() {
    const state = get();
    const parsedCustom = Number.parseInt(state.focusCustomMinutes, 10);
    const durationSeconds =
      state.focusCompletedAt && state.focusDurationSeconds > 0
        ? state.focusDurationSeconds
        : state.focusCustomSelected
          ? (!Number.isNaN(parsedCustom) && parsedCustom > 0 ? parsedCustom * 60 : 0)
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
      state.focusCustomSelected
        ? (!Number.isNaN(parsedCustom) && parsedCustom > 0 ? parsedCustom * 60 : 0)
        : state.focusSelectedMinutes * 60;
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

  async updateTaskSources(sources) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing task sources."] });
      return false;
    }
    const next = TimeLogDatabase.setTaskSources(current, sources);
    const validation = validateFile(next);
    if (!validation.file) {
      set({ errors: validation.errors });
      return false;
    }
    set({ file: validation.file, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async updateAccounts(accounts) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing online accounts."] });
      return false;
    }
    const next = TimeLogDatabase.setAccounts(current, accounts);
    const validation = validateFile(next);
    if (!validation.file) {
      set({ errors: validation.errors });
      return false;
    }
    set({ file: validation.file, hasUnsavedChanges: true, errors: [] });
    await get().saveCurrentFile();
    return true;
  },

  async syncTaskSource(sourceId, githubToken) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before syncing task sources."] });
      return { ok: false };
    }
    const source = current.taskSources.find((candidate) => candidate.id === sourceId);
    if (!source) {
      set({ errors: ["Task source was not found."] });
      return { ok: false };
    }

    let workingFile = current;
    let workingSource = source;
    if (source.type === "Github" && githubToken?.trim()) {
      const account: OnlineAccount = {
        id: source.accountId ?? uuidv4(),
        type: "Github",
        name: source.url.replace(/^https:\/\/github\.com\//i, ""),
        token: githubToken.trim()
      };
      const accounts = [
        ...workingFile.accounts.filter((candidate) => candidate.id !== account.id),
        account
      ];
      const sources = workingFile.taskSources.map((candidate) =>
        candidate.id === source.id ? { ...candidate, accountId: account.id } : candidate
      );
      workingFile = TimeLogDatabase.setTaskSources(TimeLogDatabase.setAccounts(workingFile, accounts), sources);
      workingSource = sources.find((candidate) => candidate.id === source.id) ?? source;
    }

    try {
      const api = getPlatformApi();
      const handlePath = get().fileHandle?.path;
      const tasks = workingSource.type === "Markdown"
        ? syncMarkdownTaskSource(
            workingFile,
            workingSource,
            await Promise.all(
              (await api.listMarkdownFiles(
                workingSource.url,
                handlePath ? dirname(handlePath) : undefined
              )).map(async (path) => ({
                path,
                markdown: await api.readTextFile(path)
              }))
            )
          )
        : await fetchGithubIssueTasks(
            workingFile,
            workingSource,
            workingFile.accounts.find((account) => account.id === workingSource.accountId)
          );
      const next = TimeLogDatabase.replaceTasksForSource(workingFile, sourceId, tasks);
      const validation = validateFile(next);
      if (!validation.file) {
        set({ errors: validation.errors });
        return { ok: false };
      }
      set({ file: validation.file, hasUnsavedChanges: true, errors: [] });
      await get().saveCurrentFile();
      return { ok: true };
    } catch (error) {
      if (workingSource.type === "Github" && isGithubAuthError(error)) {
        set({ errors: ["GitHub needs an account token for this task source."] });
        return { ok: false, authRequired: true };
      }
      set({ errors: [error instanceof Error ? error.message : "Task source sync failed."] });
      return { ok: false };
    }
  },

  async startLiveEntry(metadata) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before starting a timer."] });
      return false;
    }
    const sessionFields = getSessionFields(current);
    const intervalFields = getIntervalFields(current);
    const resolvedFields = getResolvedMetadataFields(current);
    const normalizedMetadata = applyResolvedMetadataDefaults(current, normalizeMetadata(resolvedFields, metadata));
    const sessionMetadata = pickMetadata(sessionFields, normalizedMetadata);
    const intervalMetadata = pickMetadata(intervalFields, normalizedMetadata);
    const validationErrors = [
      ...validateMetadataPayload(sessionFields, sessionMetadata, current),
      ...validateMetadataPayload(intervalFields, intervalMetadata, current)
    ];
    if (validationErrors.length > 0) {
      set({ errors: validationErrors });
      return false;
    }
    const next = TimerService.startLiveEntry(
      current,
      sessionMetadata,
      toIsoWithOffset(new Date()),
      intervalMetadata
    );
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
    const sessionFields = getSessionFields(current);
    const intervalFields = getIntervalFields(current);
    const resolvedFields = getResolvedMetadataFields(current);
    const normalizedMetadata = applyResolvedMetadataDefaults(current, normalizeMetadata(resolvedFields, metadata));
    const sessionMetadata = pickMetadata(sessionFields, normalizedMetadata);
    const intervalMetadata = pickMetadata(intervalFields, normalizedMetadata);
    const validationErrors = [
      ...validateMetadataPayload(sessionFields, sessionMetadata, current),
      ...validateMetadataPayload(intervalFields, intervalMetadata, current)
    ];
    if (validationErrors.length > 0) {
      set({ errors: validationErrors });
      return false;
    }
    const next = TimerService.startLiveEntry(
      current,
      sessionMetadata,
      start,
      intervalMetadata
    );
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

  async updateField(name, nextField, optionResolution) {
    const current = get().file;
    if (!current) {
      set({ errors: ["Open a file before editing fields."] });
      return false;
    }
    if (!current.fields[name]) {
      set({ errors: [`Field "${name}" was not found.`] });
      return false;
    }
    const prepared = optionResolution
      ? TimeLogDatabase.resolveFieldOptionValues(
          current,
          name,
          nextField,
          optionResolution.changes,
          optionResolution.resolution
        )
      : current;
    const next = TimeLogDatabase.updateField(prepared, name, nextField);
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
