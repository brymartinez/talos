import { mkdirSync } from "node:fs";

import { Database as BunDatabase } from "bun:sqlite";

import type { AppConfig } from "@/src/config/env";
import { migrateDatabase } from "@/src/db/migrate";
import type { Database } from "@/src/db/sqlite";

const databaseByPath = new Map<string, Database>();

export function getBunDatabase(config: AppConfig): Database {
  const existing = databaseByPath.get(config.paths.databaseFile);
  if (existing) return existing;
  for (const directory of [
    config.paths.dataDirectory,
    config.paths.repositoriesDirectory,
    config.paths.worktreesDirectory,
    config.paths.logsDirectory,
  ]) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
  const database = new BunDatabase(config.paths.databaseFile, { create: true }) as unknown as Database;
  database.run("PRAGMA foreign_keys = ON");
  database.run("PRAGMA journal_mode = WAL");
  database.run("PRAGMA busy_timeout = 5000");
  migrateDatabase(database);
  databaseByPath.set(config.paths.databaseFile, database);
  return database;
}

export function closeBunDatabases(): void {
  for (const database of databaseByPath.values()) database.close();
  databaseByPath.clear();
}
