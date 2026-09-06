import { afterEach, describe, expect, test } from "bun:test";
import { Database as BunDatabase } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AppConfig } from "@/src/config/env";
import { deriveAppPaths } from "@/src/config/paths";
import { closeBunDatabases, getBunDatabase } from "@/src/db/client-bun";

const temporaryDirectories: string[] = [];

afterEach(() => {
  closeBunDatabases();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("database migration", () => {
  test("runs every pending migration through version 5", () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "eng-work-board-migration-"));
    temporaryDirectories.push(dataDirectory);
    const paths = deriveAppPaths(dataDirectory);
    const versionTwo = new BunDatabase(paths.databaseFile, { create: true });
    versionTwo.exec(`
      CREATE TABLE cards (id TEXT PRIMARY KEY);
      CREATE TABLE agent_runs (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL,
        session_id TEXT,
        stage TEXT NOT NULL,
        provider TEXT NOT NULL,
        status TEXT NOT NULL,
        summary TEXT,
        result_json TEXT,
        questions_json TEXT,
        error_message TEXT,
        log_path TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      PRAGMA user_version = 2;
    `);
    versionTwo.close();
    const config = {
      githubToken: "token",
      githubOrganizations: [],
      githubRepositories: ["owner/repository"],
      excludedRepositories: [],
      teamAllowlist: [],
      mentionLookbackDays: 90,
      repositoryRoots: [],
      paths,
      workAgent: "codex",
      agentConcurrency: 1,
      codeCommand: "code",
    } satisfies AppConfig;

    const database = getBunDatabase(config);
    const columns = database.query<Readonly<{ name: string }>, []>("PRAGMA table_info(cards)").all();
    const version = database.query<Readonly<{ user_version: number }>, []>("PRAGMA user_version").get();

    expect(columns.map((column) => column.name)).toContain("change_type");
    expect(version?.user_version).toBe(5);
  });

  test("adds the card change type to a version 3 database", () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "eng-work-board-migration-"));
    temporaryDirectories.push(dataDirectory);
    const paths = deriveAppPaths(dataDirectory);
    const versionThree = new BunDatabase(paths.databaseFile, { create: true });
    const schema = readFileSync("src/db/schema.sql", "utf8");
    versionThree.exec(schema.slice(0, schema.indexOf("CREATE TABLE session_reporters"))
      .replace(/  change_type TEXT CHECK \(change_type IN \([^\n]+\n/, "") + "PRAGMA user_version = 3;");
    versionThree.close();
    const config = {
      githubToken: "token",
      githubOrganizations: [],
      githubRepositories: ["owner/repository"],
      excludedRepositories: [],
      teamAllowlist: [],
      mentionLookbackDays: 90,
      repositoryRoots: [],
      paths,
      workAgent: "codex",
      agentConcurrency: 1,
      codeCommand: "code",
    } satisfies AppConfig;

    const database = getBunDatabase(config);
    const columns = database.query<Readonly<{ name: string }>, []>("PRAGMA table_info(cards)").all();

    expect(columns.map((column) => column.name)).toContain("change_type");
  });
});
