import { parseDatabaseRegistry, serializeDatabaseRegistry, type DatabaseRegistryEntry } from "@/lib/database-registry";
import { getPlatformApi } from "@/lib/platform";

export type DatabaseReferenceStatus = {
  entry: DatabaseRegistryEntry;
  resolvedPath: string;
  exists: boolean;
  updatedAt: string | null;
};

export async function getDatabaseReferenceStatuses(): Promise<DatabaseReferenceStatus[]> {
  const raw = await getPlatformApi().readDatabaseRegistry();
  const entries = raw.trim().length > 0 ? parseDatabaseRegistry(raw) : [];
  const statuses = await Promise.all(
    entries.map(async (entry) => {
      const info = await getPlatformApi().getDatabaseFileInfo({ location: entry.location, url: entry.url });
      return {
        entry,
        resolvedPath: info?.path ?? "",
        exists: Boolean(info?.exists),
        updatedAt: info?.updatedAt ?? null
      };
    })
  );
  return statuses;
}

export async function getMissingDatabaseReferences(): Promise<DatabaseReferenceStatus[]> {
  return (await getDatabaseReferenceStatuses()).filter((status) => !status.exists);
}

export async function removeDatabaseReferences(entriesToRemove: DatabaseRegistryEntry[]): Promise<DatabaseRegistryEntry[]> {
  const removeIds = new Set(entriesToRemove.map((entry) => entry.id));
  const raw = await getPlatformApi().readDatabaseRegistry();
  const entries = raw.trim().length > 0 ? parseDatabaseRegistry(raw) : [];
  const nextEntries = entries.filter((entry) => !removeIds.has(entry.id));
  await getPlatformApi().saveDatabaseRegistry(serializeDatabaseRegistry(nextEntries));
  return nextEntries;
}
