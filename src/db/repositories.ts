import type { Database } from "bun:sqlite";

import {
  cardIdSchema,
  jobIdSchema,
  newJobId,
  type CardId,
  type JobId,
  type JobKind,
  type Stage,
} from "@/src/domain/types";

type PositionRow = Readonly<{ position: number | null }>;
type CardStageRow = Readonly<{ id: string; stage: string }>;

function now(): string {
  return new Date().toISOString();
}

export function positionAtTop(database: Database, stage: Stage): number {
  const row = database
    .query<PositionRow, [Stage]>("SELECT MIN(position) AS position FROM cards WHERE stage = ? AND archived = 0")
    .get(stage);
  return (row?.position ?? 1024) - 1024;
}

type QueueJobInput = Readonly<{
  kind: JobKind;
  cardId?: CardId;
  runId?: string;
  payload?: unknown;
}>;

export function insertQueueJob(database: Database, input: QueueJobInput): JobId {
  const id = newJobId();
  const timestamp = now();
  database
    .query<unknown, [JobId, JobKind, CardId | null, string | null, string, string, string]>(
      `INSERT INTO queue_jobs (
        id, kind, card_id, run_id, payload_json, state, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .run(
      id,
      input.kind,
      input.cardId ?? null,
      input.runId ?? null,
      JSON.stringify(input.payload ?? {}),
      timestamp,
      timestamp,
    );
  return id;
}

type MoveCardInput = Readonly<{
  cardId: CardId;
  destination: Stage;
  queueStageRun: boolean;
  runId?: string;
}>;

export function moveCardAtomically(database: Database, input: MoveCardInput): JobId | null {
  return database.transaction(() => {
    const card = database
      .query<CardStageRow, [CardId]>("SELECT id, stage FROM cards WHERE id = ? AND archived = 0")
      .get(input.cardId);
    if (!card) {
      throw new Error(`Card ${input.cardId} does not exist`);
    }

    const destinationPosition = positionAtTop(database, input.destination);
    const timestamp = now();
    database
      .query<unknown, [Stage, number, string, CardId]>(
        "UPDATE cards SET stage = ?, position = ?, updated_at = ? WHERE id = ?",
      )
      .run(input.destination, destinationPosition, timestamp, input.cardId);

    if (!input.queueStageRun) {
      return null;
    }
    return insertQueueJob(database, {
      kind: "run_stage",
      cardId: input.cardId,
      runId: input.runId,
      payload: { stage: input.destination },
    });
  })();
}

export function parseStoredCardId(value: string): CardId {
  return cardIdSchema.parse(value);
}

export function parseStoredJobId(value: string): JobId {
  return jobIdSchema.parse(value);
}
