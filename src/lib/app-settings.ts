import type { Row } from "@/lib/csdb";
import {
  parseDatabaseRegistry,
  parseDatabaseRegistrySettings,
  serializeDatabaseRegistry,
  type DatabaseRegistrySettings
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
let settingsCache: DatabaseRegistrySettings | null = null;

export function hydrateSettingsCache(raw: string): DatabaseRegistrySettings {
  settingsCache = parseDatabaseRegistrySettings(raw);
  return settingsCache;
}

export async function loadSettings(): Promise<DatabaseRegistrySettings> {
  await writeQueue.catch(() => undefined);
  return hydrateSettingsCache(await getPlatformApi().readDatabaseRegistry());
}

export function getCachedSettingsRow<T extends SettingsObject = SettingsObject>(key: string): T {
  const value = settingsCache?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as T : {} as T;
}

export async function getSettingsRow<T extends SettingsObject = SettingsObject>(key: string): Promise<T> {
  if (settingsCache) {
    return getCachedSettingsRow<T>(key);
  }
  await writeQueue.catch(() => undefined);
  const raw = await getPlatformApi().readDatabaseRegistry();
  hydrateSettingsCache(raw);
  return getCachedSettingsRow<T>(key);
}

export async function updateSettingsRow(key: string, patch: SettingsPatch): Promise<void> {
  if (!settingsCache) await loadSettings();
  const current = getCachedSettingsRow(key);
  const next = { ...current };
  Object.entries(patch).forEach(([property, value]) => {
    if (value === undefined) delete next[property];
    else next[property] = value;
  });
  if (Object.keys(next).length === 0) delete settingsCache![key];
  else settingsCache![key] = next;
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const raw = await getPlatformApi().readDatabaseRegistry();
    const entries = raw.trim() ? parseDatabaseRegistry(raw) : [];
    await getPlatformApi().saveDatabaseRegistry(serializeDatabaseRegistry(entries, settingsCache ?? {}));
  });
  return writeQueue;
}

export async function replaceSettingsRow(key: string, value?: SettingsObject): Promise<void> {
  if (!settingsCache) await loadSettings();
  if (!value || Object.keys(value).length === 0) delete settingsCache![key];
  else settingsCache![key] = value;
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const raw = await getPlatformApi().readDatabaseRegistry();
    const entries = raw.trim() ? parseDatabaseRegistry(raw) : [];
    await getPlatformApi().saveDatabaseRegistry(serializeDatabaseRegistry(entries, settingsCache ?? {}));
  });
  return writeQueue;
}

export async function removeSetting(key: string): Promise<void> {
  if (!settingsCache) await loadSettings();
  delete settingsCache![key];
  writeQueue = writeQueue.catch(() => undefined).then(async () => {
    const raw = await getPlatformApi().readDatabaseRegistry();
    const entries = raw.trim() ? parseDatabaseRegistry(raw) : [];
    await getPlatformApi().saveDatabaseRegistry(serializeDatabaseRegistry(entries, settingsCache ?? {}));
  });
  return writeQueue;
}

export async function restartOnboarding(): Promise<void> {
  await removeSetting("onboarding_complete");
  window.dispatchEvent(new Event(RESTART_ONBOARDING_EVENT));
}
