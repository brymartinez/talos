import { mkdirSync } from "node:fs";

import type { AppConfig } from "@/src/config/env";
import { migrateDatabase } from "@/src/db/migrate";
import { NodeDatabase, type Database } from "@/src/db/sqlite";

const databaseByPath = new Map<string, Database>();

function ensureDataDirectories(config: AppConfig): void {
  const directories = [
    config.paths.dataDirectory,
    config.paths.repositoriesDirectory,
    config.paths.logsDirectory,
  ];
  for (const directory of directories) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  }
}

export function getDatabase(config: AppConfig): Database {
  const existing = databaseByPath.get(config.paths.databaseFile);
  if (existing) {
    return existing;
  }

  ensureDataDirectories(config);
  const database = new NodeDatabase(config.paths.databaseFile);
  database.run("PRAGMA foreign_keys = ON");
  database.run("PRAGMA journal_mode = WAL");
  database.run("PRAGMA busy_timeout = 5000");
  migrateDatabase(database);
  databaseByPath.set(config.paths.databaseFile, database);
  return database;
}

export function closeDatabases(): void {
  for (const database of databaseByPath.values()) {
    database.close();
  }
  databaseByPath.clear();
}
