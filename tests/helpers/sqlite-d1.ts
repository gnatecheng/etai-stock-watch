import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

type BoundStmt = {
  sql: string;
  args: unknown[];
  run: () => Promise<{ success: boolean; meta: { changes: number } }>;
  first: <T>() => Promise<T | undefined>;
  all: () => Promise<{ results: unknown[] }>;
};

function bindStmt(db: Database.Database, sql: string, args: unknown[]): BoundStmt {
  return {
    sql,
    args,
    run: async () => {
      const info = db.prepare(sql).run(...args);
      return { success: true, meta: { changes: info.changes } };
    },
    first: async <T>() => db.prepare(sql).get(...args) as T | undefined,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
  };
}

export function createTestD1(db: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return bindStmt(db, sql, args);
        },
      };
    },
    async batch(statements: BoundStmt[]) {
      const results: { success: boolean; meta: { changes: number } }[] = [];
      const runTx = db.transaction(() => {
        for (const s of statements) {
          const info = db.prepare(s.sql).run(...s.args);
          results.push({ success: true, meta: { changes: info.changes } });
        }
      });
      runTx();
      return results;
    },
    exec: async () => {},
  } as unknown as D1Database;
}

export function freshMigratedDb(): { db: Database.Database; d1: D1Database } {
  const db = new Database(":memory:");
  const dir = resolve("migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    db.exec(readFileSync(resolve(dir, f), "utf8"));
  }
  return { db, d1: createTestD1(db) };
}
