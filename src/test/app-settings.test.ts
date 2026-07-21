import { describe, expect, it } from "vitest";
import { getSettingsRow, replaceSettingsRow, restartOnboarding, updateSettingsRow } from "@/lib/app-settings";
import { getPlatformApi } from "@/lib/platform";
import { parseDatabaseRegistry, parseDatabaseRegistrySettings, serializeDatabaseRegistry } from "@/lib/database-registry";

describe("app settings", () => {
  it("stores JSON objects and removes unset properties and empty rows", async () => {
    const key = "test_ui_preferences";
    await replaceSettingsRow(key, { view: "table", nested: { compact: true } });
    await updateSettingsRow(key, { view: undefined, sort: "ascending" });

    expect(await getSettingsRow(key)).toEqual({
      nested: { compact: true },
      sort: "ascending"
    });

    await replaceSettingsRow(key);
    const raw = await getPlatformApi().readDatabaseRegistry();
    expect(parseDatabaseRegistrySettings(raw)[key]).toBeUndefined();
  });

  it("restarts onboarding without removing other settings", async () => {
    const api = getPlatformApi();
    const raw = await api.readDatabaseRegistry();
    const settings = parseDatabaseRegistrySettings(raw);
    await api.saveDatabaseRegistry(serializeDatabaseRegistry(parseDatabaseRegistry(raw), {
      ...settings,
      onboarding_complete: true
    }));
    await replaceSettingsRow("preserved_test_setting", { enabled: true });

    await restartOnboarding();

    const updated = parseDatabaseRegistrySettings(await api.readDatabaseRegistry());
    expect(updated.onboarding_complete).toBeUndefined();
    expect(updated.preserved_test_setting).toEqual({ enabled: true });
    await replaceSettingsRow("preserved_test_setting");
  });
});
