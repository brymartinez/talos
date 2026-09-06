import { join } from "node:path";
import type { AppConfig } from "@/src/config/env";
import type { Database } from "@/src/db/sqlite";
import { agentProviderSchema, cardIdSchema, stageSchema } from "@/src/domain/types";
import { continuationCommand, continuationInstructions, prepareSessionReporter } from "@/src/agents/session-reports";
import { ServiceError } from "./runtime";

export function prepareContinuation(database: Database, config: AppConfig, rawCardId: string) {
  const cardId = cardIdSchema.parse(rawCardId);
  const row = database.query<{
    id: string; stage: string; card_stage: string; archived: number; status: string;
    provider: string; provider_session_id: string | null; worktree_path: string | null;
  }, [string]>(`SELECT r.id,r.stage,r.status,r.provider,c.stage AS card_stage,c.archived,
    s.provider_session_id,w.worktree_path FROM agent_runs r JOIN cards c ON c.id=r.card_id
    LEFT JOIN agent_sessions s ON s.id=r.session_id LEFT JOIN workspaces w ON w.card_id=c.id
    WHERE c.id=? ORDER BY r.created_at DESC,r.rowid DESC LIMIT 1`).get(cardId);
  if (!row || row.archived || row.card_stage !== row.stage || !row.provider_session_id || !row.worktree_path) {
    throw new ServiceError("no_session", "This card has no current session to continue.", 409);
  }
  const active = database.query<{id:string},[string]>(
    "SELECT id FROM queue_jobs WHERE card_id=? AND kind='run_stage' AND state IN ('pending','leased') LIMIT 1",
  ).get(cardId);
  if (active || ["queued","running"].includes(row.status)) throw new ServiceError("run_active", "Wait for the board run to finish before continuing its session.", 409);
  if (["cancelled","interrupted"].includes(row.status)) throw new ServiceError("run_stopped", "Retry this stage before continuing a stopped session.", 409);
  const reporter = prepareSessionReporter({database,guardDirectory:join(config.paths.dataDirectory,"guard-bin"),runId:row.id});
  const instructions = continuationInstructions({stage:stageSchema.exclude(["backlog","done"]).parse(row.stage),command:reporter.command});
  const command = continuationCommand({provider:agentProviderSchema.parse(row.provider),sessionId:row.provider_session_id,worktreePath:row.worktree_path,instructions});
  return { command, instructions };
}
