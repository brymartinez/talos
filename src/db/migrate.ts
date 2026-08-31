import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Database } from "@/src/db/sqlite";

type UserVersionRow = Readonly<{ user_version: number }>;

export function migrateDatabase(database: Database): void {
  // Rebuilding agent_runs' CHECK constraint (version 2 -> 3) requires foreign key
  // enforcement to be off for the duration, and SQLite only allows toggling that
  // pragma outside of a transaction.
  database.exec("PRAGMA foreign_keys = OFF");
  database.exec("BEGIN IMMEDIATE");
  try {
    const version = database.query<UserVersionRow, []>("PRAGMA user_version").get();
    if (!version) {
      throw new Error("SQLite did not return PRAGMA user_version");
    }
    if (version.user_version > 3) {
      throw new Error(`Database version ${version.user_version} is newer than this app supports`);
    }
    if (version.user_version === 0) {
      const schema = readFileSync(join(process.cwd(), "src/db/schema.sql"), "utf8");
      database.exec(schema);
    } else if (version.user_version === 1) {
      database.exec(`
        UPDATE agent_runs
        SET status = 'interrupted',
            error_message = 'Superseded during database migration',
            finished_at = COALESCE(finished_at, updated_at)
        WHERE status IN ('queued', 'running')
          AND id NOT IN (
            SELECT id FROM agent_runs AS latest
            WHERE latest.card_id = agent_runs.card_id
              AND latest.status IN ('queued', 'running')
            ORDER BY latest.created_at DESC
            LIMIT 1
          );
        UPDATE queue_jobs
        SET state = 'interrupted', updated_at = datetime('now')
        WHERE state IN ('pending', 'leased')
          AND run_id IN (SELECT id FROM agent_runs WHERE status = 'interrupted');
        CREATE UNIQUE INDEX IF NOT EXISTS agent_runs_one_active_card_idx
          ON agent_runs(card_id)
          WHERE status IN ('queued', 'running');
        PRAGMA user_version = 2;
      `);
    } else if (version.user_version === 2) {
      database.exec(`
        CREATE TABLE agent_runs_new (
          id TEXT PRIMARY KEY,
          card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
          session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
          stage TEXT NOT NULL CHECK (stage IN ('planning', 'building', 'review')),
          provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude')),
          status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'needs_input', 'changes_requested', 'cancelled', 'interrupted')),
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
        INSERT INTO agent_runs_new SELECT * FROM agent_runs;
        DROP TABLE agent_runs;
        ALTER TABLE agent_runs_new RENAME TO agent_runs;
        CREATE INDEX agent_runs_card_created_idx ON agent_runs(card_id, created_at DESC);
        CREATE INDEX agent_runs_status_idx ON agent_runs(status);
        CREATE UNIQUE INDEX agent_runs_one_active_card_idx
          ON agent_runs(card_id)
          WHERE status IN ('queued', 'running');
        PRAGMA user_version = 3;
      `);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  } finally {
    database.exec("PRAGMA foreign_keys = ON");
  }
}
