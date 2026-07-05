import { v4 as uuidv4 } from "uuid";
import { CSDBDatabase, serializeCSDB, type Row, type TableSchema } from "@/lib/csdb";

export type DatabaseLocation = "Internal" | "Path";

export type DatabaseRegistryEntry = {
  id: string;
  location: DatabaseLocation;
  url: string;
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
    url: "text"
  },
  required: ["id", "location", "url"],
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

export function createDatabaseRegistryEntry(location: DatabaseLocation, url: string): DatabaseRegistryEntry {
  return {
    id: uuidv4(),
    location,
    url
  };
}

export function parseDatabaseRegistry(raw: string): DatabaseRegistryEntry[] {
  const db = CSDBDatabase.parse(raw);
  const rows = db.document.tables.get("databases")?.rows ?? [];
  return rows.map((row: Row) => ({
    id: String(row.id),
    location: normalizeLocation(row.location),
    url: String(row.url ?? "")
  })).filter((entry) => entry.id.length > 0 && entry.url.length > 0);
}

export function serializeDatabaseRegistry(entries: DatabaseRegistryEntry[]): string {
  const db = createRegistryDatabase();
  if (entries.length > 0) {
    db.table("databases").insert(entries.map((entry) => ({
      id: entry.id,
      location: entry.location,
      url: entry.url
    })));
  }
  return serializeCSDB(db);
}
