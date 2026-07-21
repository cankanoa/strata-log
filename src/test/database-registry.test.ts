import { describe, expect, it } from "vitest";
import {
  getActiveDatabaseEntry,
  parseDatabaseRegistry,
  parseDatabaseRegistrySettings,
  serializeDatabaseRegistry,
  setActiveDatabaseEntry,
  type DatabaseRegistryEntry
} from "@/lib/database-registry";

const entries: DatabaseRegistryEntry[] = [
  {
    id: "550e8400-e29b-41d4-a716-446655440000",
    location: "Internal",
    url: "alpha"
  },
  {
    id: "550e8400-e29b-41d4-a716-446655440001",
    location: "Path",
    url: "/tmp/beta.csdb"
  }
];

describe("database registry", () => {
  it("serializes and parses one active database", () => {
    const activeEntries = setActiveDatabaseEntry(entries, entries[1]!.id);
    const raw = serializeDatabaseRegistry(activeEntries);

    expect(raw).toContain("active_database: boolean");
    expect(raw).toContain("id,location,url,active_database");

    const parsed = parseDatabaseRegistry(raw);
    expect(getActiveDatabaseEntry(parsed)?.id).toBe(entries[1]!.id);
    expect(parsed.map((entry) => Boolean(entry.activeDatabase))).toEqual([false, true]);
  });

  it("keeps only the first active database when parsing", () => {
    const parsed = parseDatabaseRegistry(serializeDatabaseRegistry(entries.map((entry) => ({
      ...entry,
      activeDatabase: true
    }))));

    expect(parsed.map((entry) => Boolean(entry.activeDatabase))).toEqual([true, false]);
  });

  it("round-trips JSON settings alongside database entries", () => {
    const raw = serializeDatabaseRegistry(entries, {
      onboarding_complete: true,
      display: { density: "compact" }
    });

    expect(parseDatabaseRegistrySettings(raw)).toEqual({
      onboarding_complete: true,
      display: { density: "compact" }
    });
    expect(parseDatabaseRegistry(raw)).toHaveLength(2);
  });
});
