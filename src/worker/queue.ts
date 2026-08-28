import type { Database } from "@/src/db/sqlite";

import { jobIdSchema, jobKindSchema, type CardId, type JobId, type JobKind } from "@/src/domain/types";

export type LeasedJob = Readonly<{
  id: JobId;
  kind: JobKind;
  cardId: CardId | null;
  runId: string | null;
  payload: unknown;
}>;

type JobRow = Readonly<{ id: string; kind: string; card_id: CardId | null; run_id: string | null; payload_json: string }>;

export function recoverExpiredJobs(database: Database): number {
  const timestamp = new Date().toISOString();
  return database.transaction(() => {
    database.query<unknown, [string, string, string]>(
      `UPDATE agent_runs SET status = 'interrupted', finished_at = ?, updated_at = ?
       WHERE status IN ('queued', 'running') AND id IN (
         SELECT run_id FROM queue_jobs WHERE state = 'leased' AND lease_expires_at < ?
       )`,
    ).run(timestamp, timestamp, timestamp);
    return database.query<unknown, [string, string]>(
      `UPDATE queue_jobs SET state = 'interrupted', updated_at = ?
       WHERE state = 'leased' AND lease_expires_at < ?`,
    ).run(timestamp, timestamp).changes;
  })();
}

export function leaseNextJob(database: Database, workerId: string): LeasedJob | null {
  return database.transaction(() => {
    const row = database.query<JobRow, []>(
      "SELECT id, kind, card_id, run_id, payload_json FROM queue_jobs WHERE state = 'pending' ORDER BY created_at LIMIT 1",
    ).get();
    if (!row) return null;
    const timestamp = new Date();
    const expires = new Date(timestamp.getTime() + 30_000).toISOString();
    const update = database.query<unknown, [string, string, string, JobId]>(
      `UPDATE queue_jobs SET state = 'leased', lease_worker_id = ?, lease_expires_at = ?,
       attempts = attempts + 1, updated_at = ? WHERE id = ? AND state = 'pending'`,
    ).run(workerId, expires, timestamp.toISOString(), jobIdSchema.parse(row.id));
    if (update.changes !== 1) return null;
    return {
      id: jobIdSchema.parse(row.id),
      kind: jobKindSchema.parse(row.kind),
      cardId: row.card_id,
      runId: row.run_id,
      payload: JSON.parse(row.payload_json),
    };
  })();
}

export function renewLease(database: Database, jobId: JobId, workerId: string): void {
  const expires = new Date(Date.now() + 30_000).toISOString();
  database.query<unknown, [string, string, JobId, string]>(
    "UPDATE queue_jobs SET lease_expires_at = ?, updated_at = ? WHERE id = ? AND lease_worker_id = ? AND state = 'leased'",
  ).run(expires, new Date().toISOString(), jobId, workerId);
}

export function cancellationRequested(database: Database, jobId: JobId): boolean {
  return Boolean(
    database.query<{ cancel_requested: number }, [JobId]>(
      "SELECT cancel_requested FROM queue_jobs WHERE id = ?",
    ).get(jobId)?.cancel_requested,
  );
}

export function finishJob(database: Database, jobId: JobId, error?: unknown): void {
  const message = error instanceof Error ? error.message : error ? String(error) : null;
  database.query<unknown, ["completed" | "failed", string | null, string, JobId]>(
    "UPDATE queue_jobs SET state = ?, error_message = ?, lease_expires_at = NULL, updated_at = ? WHERE id = ?",
  ).run(message ? "failed" : "completed", message, new Date().toISOString(), jobId);
}
