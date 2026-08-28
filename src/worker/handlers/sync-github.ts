import type { Database } from "bun:sqlite";

import type { AppConfig } from "@/src/config/env";
import { syncGitHub } from "@/src/github/sync";

export async function handleSyncGitHub(database: Database, config: AppConfig): Promise<void> {
  const result = await syncGitHub({ database, config });
  if (result.status === "failed") throw new Error("GitHub refresh failed. See the refresh errors on the board.");
}
