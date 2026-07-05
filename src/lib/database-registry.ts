import { v4 as uuidv4 } from "uuid";
import { CSDBDatabase, serializeCSDB, type Row, type TableSchema } from "@/lib/csdb";

export type DatabaseLocation = "Internal" | "Path";

export type DatabaseRegistryEntry = {
  id: string;
  location: DatabaseLocation;
  url: string;
  activeDatabase?: boolean;
};

const EMPTY_REGISTRY = `--- csdb
format: CSDB
version: 1
name: strata-log-databases
tables: []
`;

const DATABASES_TABLE: TableSchema = {
  name: "databases",
  columns: {
    id: "text",
    location: "text",
    url: "text",
    active_database: "boolean"
  },
  required: ["id", "location", "url", "active_database"],
  primary_key: { columns: ["id"] }
};

function createRegistryDatabase(): CSDBDatabase {
  const db = CSDBDatabase.parse(EMPTY_REGISTRY);
  db.createTable(DATABASES_TABLE);
  return db;
}

function normalizeLocation(value: unknown): DatabaseLocation {
  return value === "Internal" ? "Internal" : "Path";
}

function normalizeBoolean(value: unknown): boolean {
  return value === true || value === "true";
}

function normalizeActiveDatabase(entries: DatabaseRegistryEntry[]): DatabaseRegistryEntry[] {
  let foundActive = false;
  return entries.map((entry) => {
    const activeDatabase = Boolean(entry.activeDatabase) && !foundActive;
    foundActive = foundActive || activeDatabase;
    return {
      ...entry,
      activeDatabase
    };
  });
}

export function createDatabaseRegistryEntry(location: DatabaseLocation, url: string): DatabaseRegistryEntry {
  return {
    id: uuidv4(),
    location,
    url,
    activeDatabase: false
  };
}

export function setActiveDatabaseEntry(entries: DatabaseRegistryEntry[], activeId: string | null): DatabaseRegistryEntry[] {
  return entries.map((entry) => ({
    ...entry,
    activeDatabase: activeId !== null && entry.id === activeId
  }));
}

export function getActiveDatabaseEntry(entries: DatabaseRegistryEntry[]): DatabaseRegistryEntry | undefined {
  return entries.find((entry) => entry.activeDatabase);
}

export function parseDatabaseRegistry(raw: string): DatabaseRegistryEntry[] {
  const db = CSDBDatabase.parse(raw);
  if (!db.document.tables.has("databases")) {
    return [];
  }
  return normalizeActiveDatabase(
    db.table("databases").all().map((row: Row) => ({
      id: String(row.id),
      location: normalizeLocation(row.location),
      url: String(row.url ?? ""),
      activeDatabase: normalizeBoolean(row.active_database)
    })).filter((entry) => entry.id.length > 0 && entry.url.length > 0)
  );
}

export function serializeDatabaseRegistry(entries: DatabaseRegistryEntry[]): string {
  const db = createRegistryDatabase();
  const normalizedEntries = normalizeActiveDatabase(entries);
  if (normalizedEntries.length > 0) {
    db.table("databases").insert(normalizedEntries.map((entry) => ({
      id: entry.id,
      location: entry.location,
      url: entry.url,
      active_database: Boolean(entry.activeDatabase)
    })));
  }
  return serializeCSDB(db);
}
