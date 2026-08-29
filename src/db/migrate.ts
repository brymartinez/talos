import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Database } from "@/src/db/sqlite";

type UserVersionRow = Readonly<{ user_version: number }>;

export function migrateDatabase(database: Database): void {
  database.exec("BEGIN IMMEDIATE");
  try {
    const version = database.query<UserVersionRow, []>("PRAGMA user_version").get();
    if (!version) {
      throw new Error("SQLite did not return PRAGMA user_version");
    }
    if (version.user_version > 2) {
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
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
}
