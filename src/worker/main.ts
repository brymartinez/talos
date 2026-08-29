import { getConfigResult } from "@/src/config/env";
import { cancelAgentProcess } from "@/src/agents/process";
import { closeBunDatabases, getBunDatabase } from "@/src/db/client-bun";
import { cardIdSchema } from "@/src/domain/types";
import { handleDeleteWorktree } from "@/src/worker/handlers/delete-worktree";
import { handleOpenVsCode } from "@/src/worker/handlers/open-vscode";
import { handleRunStage } from "@/src/worker/handlers/run-stage";
import { handleSyncGitHub } from "@/src/worker/handlers/sync-github";
import { cancellationRequested, finishCancelledJob, finishJob, leaseNextJob, recoverExpiredJobs, renewLease, type LeasedJob } from "@/src/worker/queue";

const configuration = getConfigResult();
if (!configuration.ok) {
  console.error("Worker configuration error:", configuration.errors);
  process.exit(1);
}
const config = configuration.config;
const database = getBunDatabase(config);
const workerId = crypto.randomUUID();
let stopping = false;
const activeRunIds = new Set<string>();
const activeJobs = new Map<string, LeasedJob>();
recoverExpiredJobs(database);
let lastRecoveryAt = Date.now();

function finishRunAsCancelled(runId: string): void {
  const timestamp = new Date().toISOString();
  database.query<unknown, [string, string, string]>(
    `UPDATE agent_runs SET status = 'cancelled', error_message = NULL, finished_at = ?, updated_at = ?
     WHERE id = ? AND status IN ('queued', 'running', 'succeeded', 'failed', 'needs_input')`,
  ).run(timestamp, timestamp, runId);
}

async function handle(job: LeasedJob): Promise<void> {
  if (job.kind === "sync_github") return handleSyncGitHub(database, config);
  if (!job.cardId) throw new Error(`${job.kind} requires a card`);
  if (job.kind === "run_stage") {
    if (!job.runId) throw new Error("run_stage requires a run");
    return handleRunStage({ database, config, cardId: job.cardId, runId: job.runId, payload: job.payload });
  }
  const workspace = database.query<{ worktree_path: string }, [typeof job.cardId]>(
    "SELECT worktree_path FROM workspaces WHERE card_id = ?",
  ).get(job.cardId);
  if (job.kind === "open_vscode") {
    if (!workspace) throw new Error("Card has no workspace yet");
    return handleOpenVsCode(config, workspace.worktree_path);
  }
  const force = Boolean((job.payload as { force?: unknown }).force);
  return handleDeleteWorktree(database, config, cardIdSchema.parse(job.cardId), force);
}

const stop = (): void => {
  if (stopping) return;
  stopping = true;
  const timestamp = new Date().toISOString();
  database.transaction(() => {
    for (const job of activeJobs.values()) {
      database.query<unknown, [string, string]>(
        `UPDATE queue_jobs SET state = 'interrupted', lease_expires_at = NULL, updated_at = ?
         WHERE id = ? AND state = 'leased'`,
      ).run(timestamp, job.id);
      if (job.runId) {
        database.query<unknown, [string, string, string]>(
          `UPDATE agent_runs SET status = 'interrupted', finished_at = ?, updated_at = ?
           WHERE id = ? AND status IN ('queued', 'running')`,
        ).run(timestamp, timestamp, job.runId);
      }
    }
  })();
  for (const runId of activeRunIds) void cancelAgentProcess(runId);
};
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
console.log(`Engineering Work Board worker ${workerId} ready`);

while (!stopping) {
  if (Date.now() - lastRecoveryAt >= 5_000) {
    recoverExpiredJobs(database);
    lastRecoveryAt = Date.now();
  }
  const jobs: LeasedJob[] = [];
  while (jobs.length < config.agentConcurrency) {
    const job = leaseNextJob(database, workerId);
    if (!job) break;
    jobs.push(job);
  }
  if (jobs.length === 0) {
    await Bun.sleep(500);
    continue;
  }
  await Promise.all(jobs.map(async (job) => {
    activeJobs.set(job.id, job);
    if (job.runId) activeRunIds.add(job.runId);
    const renewal = setInterval(() => {
      renewLease(database, job.id, workerId);
      if (job.runId && cancellationRequested(database, job.id)) void cancelAgentProcess(job.runId);
    }, 1_000);
    try {
      await handle(job);
      if (cancellationRequested(database, job.id)) {
        if (job.runId) finishRunAsCancelled(job.runId);
        finishCancelledJob(database, job.id);
      } else {
        finishJob(database, job.id);
      }
    } catch (error) {
      if (!stopping) console.error(`Job ${job.id} failed`, error);
      const cancelled = cancellationRequested(database, job.id);
      if (job.runId) {
        if (cancelled) {
          finishRunAsCancelled(job.runId);
        } else {
          const timestamp = new Date().toISOString();
          database.query<unknown, [string, string, string, string]>(
            `UPDATE agent_runs SET status = 'failed', error_message = ?, finished_at = ?, updated_at = ?
             WHERE id = ? AND status IN ('queued', 'running', 'failed')`,
          ).run(error instanceof Error ? error.message : String(error), timestamp, timestamp, job.runId);
        }
      }
      if (cancelled) finishCancelledJob(database, job.id);
      else finishJob(database, job.id, error);
    } finally {
      clearInterval(renewal);
      activeJobs.delete(job.id);
      if (job.runId) activeRunIds.delete(job.runId);
    }
  }));
}
closeBunDatabases();
console.log("Engineering Work Board worker stopped");
