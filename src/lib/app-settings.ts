import type { Row } from "@/lib/csdb";
import {
  parseDatabaseRegistry,
  parseDatabaseRegistrySettings,
  serializeDatabaseRegistry
} from "@/lib/database-registry";
import { getPlatformApi } from "@/lib/platform";

export const SETTINGS_ROWS = {
  tasksTableRow: "tasks_table_row",
  trackSessionsSection: "track_sessions_section",
  tasksViewSelection: "tasks_view_selection",
  tasksGroup: "tasks_group",
  tasksFields: "tasks_fields",
  tasksFilter: "tasks_filter",
  tasksSort: "tasks_sort",
  focusTimeAmount: "focus_time_amount",
  focusMode: "focus_mode",
  completeAlert: "complete_alert"
} as const;

export const RESTART_ONBOARDING_EVENT = "taskasaur:restart-onboarding";

export type SettingsObject = Record<string, Row[string]>;
export type SettingsPatch = Record<string, Row[string] | undefined>;

let writeQueue = Promise.resolve();

export async function getSettingsRow<T extends SettingsObject = SettingsObject>(key: string): Promise<T> {
  await writeQueue.catch(() => undefined);
  const raw = await getPlatformApi().readDatabaseRegistry();
  const value = parseDatabaseRegistrySettings(raw)[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as T : {} as T;
}

export async function updateSettingsRow(key: string, patch: SettingsPatch): Promise<void> {
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const raw = await getPlatformApi().readDatabaseRegistry();
    const entries = raw.trim() ? parseDatabaseRegistry(raw) : [];
    const settings = parseDatabaseRegistrySettings(raw);
    const current = settings[key];
    const next = current && typeof current === "object" && !Array.isArray(current)
      ? { ...current } as SettingsObject
      : {};
    Object.entries(patch).forEach(([property, value]) => {
      if (value === undefined) delete next[property];
      else next[property] = value;
    });
    if (Object.keys(next).length === 0) delete settings[key];
    else settings[key] = next;
    await getPlatformApi().saveDatabaseRegistry(serializeDatabaseRegistry(entries, settings));
  });
  return writeQueue;
}

export function replaceSettingsRow(key: string, value?: SettingsObject): Promise<void> {
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const raw = await getPlatformApi().readDatabaseRegistry();
    const entries = raw.trim() ? parseDatabaseRegistry(raw) : [];
    const settings = parseDatabaseRegistrySettings(raw);
    if (!value || Object.keys(value).length === 0) delete settings[key];
    else settings[key] = value;
    await getPlatformApi().saveDatabaseRegistry(serializeDatabaseRegistry(entries, settings));
  });
  return writeQueue;
}

export function removeSetting(key: string): Promise<void> {
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const raw = await getPlatformApi().readDatabaseRegistry();
    const entries = raw.trim() ? parseDatabaseRegistry(raw) : [];
    const settings = parseDatabaseRegistrySettings(raw);
    delete settings[key];
    await getPlatformApi().saveDatabaseRegistry(serializeDatabaseRegistry(entries, settings));
  });
  return writeQueue;
}

export async function restartOnboarding(): Promise<void> {
  await removeSetting("onboarding_complete");
  window.dispatchEvent(new Event(RESTART_ONBOARDING_EVENT));
}
