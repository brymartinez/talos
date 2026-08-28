import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Database } from "bun:sqlite";

type UserVersionRow = Readonly<{ user_version: number }>;

export function migrateDatabase(database: Database): void {
  const version = database.query<UserVersionRow, []>("PRAGMA user_version").get();
  if (!version) {
    throw new Error("SQLite did not return PRAGMA user_version");
  }
  if (version.user_version > 1) {
    throw new Error(`Database version ${version.user_version} is newer than this app supports`);
  }
  if (version.user_version === 0) {
    const schema = readFileSync(join(process.cwd(), "src/db/schema.sql"), "utf8");
    database.transaction(() => database.exec(schema))();
  }
}
