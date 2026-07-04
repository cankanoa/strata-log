import { validateDocument } from "../../node_modules/@csdb/javascript/dist/catalog.js";
import { Executor } from "../../node_modules/@csdb/javascript/dist/executor.js";
import { parseSQL } from "../../node_modules/@csdb/javascript/dist/sql/parser.js";
import { parseDocument, serializeDocument } from "../../node_modules/@csdb/javascript/dist/storage/document.js";
import { TableQuery } from "../../node_modules/@csdb/javascript/dist/table.js";
import type { ParseOptions, SerializeOptions } from "../../node_modules/@csdb/javascript/dist/storage/document.d.ts";
import type { CSDBDocument, QueryPlan, Row, RowValue, SQLResult, TableSchema } from "../../node_modules/@csdb/javascript/dist/types.d.ts";

export type { CSDBDocument, Row, TableSchema };

export class CSDBDatabase {
  readonly executor: Executor;

  constructor(readonly document: CSDBDocument) {
    this.executor = new Executor(document);
  }

  static parse(text: string, options: ParseOptions = {}): CSDBDatabase {
    return new CSDBDatabase(parseDocument(text, options));
  }

  table(name: string): TableQuery {
    return new TableQuery(this as never, name);
  }

  sql(statement: string, params: RowValue[] = []): SQLResult {
    return this.execute(parseSQL(statement, params)) as SQLResult;
  }

  execute(plan: QueryPlan): Row[] | { rowsAffected: number } {
    return this.executor.execute(plan);
  }

  createTable(schema: TableSchema): { rowsAffected: number } {
    return this.execute({ kind: "create-table", schema }) as { rowsAffected: number };
  }

  dropTable(name: string): { rowsAffected: number } {
    return this.execute({ kind: "drop-table", table: name }) as { rowsAffected: number };
  }

  validate(): void {
    validateDocument(this.document);
  }

  toString(options?: SerializeOptions): string {
    return serializeDocument(this.document, options);
  }
}

export function serializeCSDB(db: CSDBDatabase): string {
  return db.toString();
}
