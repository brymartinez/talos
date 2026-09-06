import type { Database } from "@/src/db/sqlite";
import { z } from "zod";

import { latestSessionReport } from "@/src/agents/session-reports";
import { insertQueueJob, moveCardAtomically } from "@/src/db/repositories";
import { agentProviderSchema, cardIdSchema, changeTypeSchema, newRunId, stageSchema, type Card, type CardId, type ChangeType, type MatchReason, type RunState } from "@/src/domain/types";
import { canMoveCard, isForwardMove } from "@/src/domain/workflow";
import { ServiceError } from "@/src/services/runtime";

type CardRow = Readonly<{
  id: string; item_type: "issue" | "pull_request"; stage: string; position: number;
  notes: string; notes_updated_at: string | null; work_agent: "codex" | "claude";
  change_type: ChangeType | null; latest_run_id: string | null;
  archived: number; no_longer_assigned: number; active_run_state: RunState | null;
}>;

function loadCard(database: Database, cardId: CardId): Card {
  const row = database.query<CardRow, [CardId]>(
    `SELECT cards.id, source_items.item_type, cards.stage, cards.position, cards.notes,
      cards.notes_updated_at, cards.work_agent, cards.change_type, cards.archived, cards.no_longer_assigned,
      (SELECT id FROM agent_runs WHERE card_id = cards.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS latest_run_id,
      (SELECT status FROM agent_runs WHERE card_id = cards.id ORDER BY created_at DESC, rowid DESC LIMIT 1) AS active_run_state
     FROM cards JOIN source_items ON source_items.id = cards.source_item_id WHERE cards.id = ?`,
  ).get(cardId);
  if (!row) throw new ServiceError("card_not_found", "Card not found.", 404);
  const reasons = database.query<{ reason: MatchReason }, [CardId]>(
    `SELECT reason FROM match_reasons JOIN source_items ON source_items.id = match_reasons.source_item_id
     JOIN cards ON cards.source_item_id = source_items.id WHERE cards.id = ?`,
  ).all(cardId).map((value) => value.reason);
  return {
    id: cardIdSchema.parse(row.id), itemType: row.item_type, matchReasons: reasons,
    stage: stageSchema.parse(row.stage), position: row.position, notes: row.notes,
    notesUpdatedAt: row.notes_updated_at, workAgent: row.work_agent,
    changeType: changeTypeSchema.nullable().parse(row.change_type),
    archived: row.archived === 1, noLongerAssigned: row.no_longer_assigned === 1,
    activeRunState: row.active_run_state === "queued" || row.active_run_state === "running"
      ? row.active_run_state
      : (row.latest_run_id ? latestSessionReport(database, row.latest_run_id)?.result.outcome : null) ?? row.active_run_state,
  };
}

export function queueSync(database: Database): string {
  const existing = database.query<{ id: string }, []>(
    "SELECT id FROM queue_jobs WHERE kind = 'sync_github' AND state IN ('pending', 'leased') LIMIT 1",
  ).get();
  return existing?.id ?? insertQueueJob(database, { kind: "sync_github" });
}

export function updateCard(database: Database, rawCardId: string, input: unknown): void {
  const cardId = cardIdSchema.parse(rawCardId);
  const values = z.object({
    notes: z.string().max(20_000).optional(),
    workAgent: agentProviderSchema.optional(),
    changeType: changeTypeSchema.nullable().optional(),
  }).parse(input);
  const card = loadCard(database, cardId);
  const planningCanRestart =
    card.stage === "planning" &&
    ["failed", "interrupted", "cancelled"].includes(card.activeRunState ?? "");
  if (
    values.workAgent &&
    values.workAgent !== card.workAgent &&
    card.stage !== "backlog" &&
    !planningCanRestart
  ) {
    throw new ServiceError("agent_locked", "The work agent can only change before Planning starts.", 409);
  }
  if (values.changeType !== undefined && card.stage !== "backlog" && card.stage !== "planning") {
    throw new ServiceError("change_type_locked", "The change type cannot change after Building starts.", 409);
  }
  const timestamp = new Date().toISOString();
  database.query<unknown, [string, string | null, "codex" | "claude", ChangeType | null, string, CardId]>(
    `UPDATE cards SET notes = ?, notes_updated_at = ?, work_agent = ?, change_type = ?, updated_at = ? WHERE id = ?`,
  ).run(
    values.notes ?? card.notes,
    values.notes !== undefined ? timestamp : card.notesUpdatedAt,
    values.workAgent ?? card.workAgent,
    values.changeType === undefined ? card.changeType : values.changeType,
    timestamp,
    cardId,
  );
}

export function saveSuggestedChangeType(
  database: Database,
  cardId: CardId,
  changeType: ChangeType | null,
): void {
  if (!changeType) return;
  database.query<unknown, [ChangeType, string, CardId]>(
    `UPDATE cards
     SET change_type = COALESCE(change_type, ?), updated_at = ?
     WHERE id = ? AND stage = 'planning'`,
  ).run(changeType, new Date().toISOString(), cardId);
}

export function moveCard(database: Database, rawCardId: string, input: unknown): void {
  const cardId = cardIdSchema.parse(rawCardId);
  const destination = z.object({ destination: stageSchema }).parse(input).destination;
  const card = loadCard(database, cardId);
  if (!canMoveCard(card, destination)) throw new ServiceError("invalid_move", "That stage move is not allowed.", 409);
  if (destination === "building" && !card.changeType) {
    throw new ServiceError("change_type_required", "Select a change type before Building.", 409);
  }
  const forward = isForwardMove(card, destination);
  const runId = forward ? newRunId() : undefined;
  database.transaction(() => {
    if (runId) {
      const timestamp = new Date().toISOString();
      database.query<unknown, [typeof runId, CardId, string, string, string, string]>(
        `INSERT INTO agent_runs (id, card_id, stage, provider, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?)`,
      ).run(runId, cardId, destination, card.workAgent, timestamp, timestamp);
    }
    moveCardAtomically(database, { cardId, destination, queueStageRun: forward, runId });
  })();
}

export function reorderCard(database: Database, rawCardId: string, input: unknown): void {
  const cardId = cardIdSchema.parse(rawCardId);
  const { position } = z.object({ position: z.number().finite() }).parse(input);
  database.query<unknown, [number, string, CardId]>("UPDATE cards SET position = ?, updated_at = ? WHERE id = ?")
    .run(position, new Date().toISOString(), cardId);
}

export function retryCard(database: Database, rawCardId: string): void {
  const cardId = cardIdSchema.parse(rawCardId);
  const card = loadCard(database, cardId);
  if (card.stage === "backlog" || card.stage === "done") throw new ServiceError("nothing_to_retry", "This card has no active stage to retry.", 409);
  if (card.activeRunState === "queued" || card.activeRunState === "running") {
    throw new ServiceError("run_active", "This card already has queued or running work.", 409);
  }
  const runId = newRunId();
  const timestamp = new Date().toISOString();
  database.transaction(() => {
    database.query<unknown, [typeof runId, CardId, string, string, string, string]>(
      "INSERT INTO agent_runs (id, card_id, stage, provider, status, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', ?, ?)",
    ).run(runId, cardId, card.stage, card.workAgent, timestamp, timestamp);
    insertQueueJob(database, { kind: "run_stage", cardId, runId, payload: { stage: card.stage } });
  })();
}

export function cancelCard(database: Database, rawCardId: string): void {
  const cardId = cardIdSchema.parse(rawCardId);
  const timestamp = new Date().toISOString();
  const changed = database.transaction(() => {
    const pending = database.query<unknown, [string, CardId]>(
      "UPDATE queue_jobs SET state = 'cancelled', updated_at = ? WHERE card_id = ? AND state = 'pending'",
    ).run(timestamp, cardId).changes;
    if (pending) {
      database.query<unknown, [string, string, CardId]>(
        "UPDATE agent_runs SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE card_id = ? AND status = 'queued'",
      ).run(timestamp, timestamp, cardId);
    }
    const leased = database.query<unknown, [string, CardId]>(
      "UPDATE queue_jobs SET cancel_requested = 1, updated_at = ? WHERE card_id = ? AND state = 'leased'",
    ).run(timestamp, cardId).changes;
    return pending + leased;
  })();
  if (!changed) throw new ServiceError("nothing_to_cancel", "This card has no queued or running work.", 409);
}

export function queueCardAction(database: Database, rawCardId: string, kind: "open_vscode" | "delete_worktree", payload?: unknown): void {
  const cardId = cardIdSchema.parse(rawCardId);
  const card = loadCard(database, cardId);
  if (
    kind === "delete_worktree" &&
    (card.activeRunState === "queued" || card.activeRunState === "running")
  ) {
    throw new ServiceError("run_active", "Cancel the active run before deleting its worktree.", 409);
  }
  insertQueueJob(database, { kind, cardId, payload });
}
