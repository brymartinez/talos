import { join } from "node:path";

import type { Database } from "@/src/db/sqlite";
import { z } from "zod";

import { ClaudeRunner } from "@/src/agents/claude";
import { CodexRunner } from "@/src/agents/codex";
import { enforceStagePolicy } from "@/src/agents/policy";
import { stagePrompt } from "@/src/agents/prompts";
import type { AgentResult, AgentRunner } from "@/src/agents/types";
import type { AppConfig } from "@/src/config/env";
import { getCardWorkSource, saveRepositoryPath } from "@/src/db/repositories";
import { agentProviderSchema, cardIdSchema, runIdSchema, stageSchema, type AgentProvider } from "@/src/domain/types";
import { captureGitState } from "@/src/git/state";
import { createCardWorkspace, saveWorkspace } from "@/src/git/workspace";

const payloadSchema = z.object({ stage: stageSchema.exclude(["backlog", "done"]) });
type RunContext = Readonly<{
  title: string;
  body: string;
  notes: string;
  work_agent: AgentProvider;
}>;
type WorkspaceRow = Readonly<{
  repository_path: string;
  worktree_path: string;
  branch_name: string | null;
  base_commit: string;
  checkout_mode: "branch" | "detached";
  before_state_json: string;
}>;
type PriorSessionRow = Readonly<{ id: string; provider_session_id: string }>;

function runner(provider: AgentProvider): AgentRunner {
  return provider === "codex" ? new CodexRunner() : new ClaudeRunner();
}

export async function handleRunStage(input: Readonly<{
  database: Database;
  config: AppConfig;
  cardId: string;
  runId: string;
  payload: unknown;
}>): Promise<void> {
  const cardId = cardIdSchema.parse(input.cardId);
  const runId = runIdSchema.parse(input.runId);
  const { stage } = payloadSchema.parse(input.payload);
  const context = input.database.query<RunContext, [typeof cardId]>(
    `SELECT source_items.title, source_items.body, cards.notes, cards.work_agent
     FROM cards JOIN source_items ON source_items.id = cards.source_item_id WHERE cards.id = ?`,
  ).get(cardId);
  if (!context) throw new Error("Card does not exist");
  const source = getCardWorkSource(input.database, cardId);
  let workspace = input.database.query<WorkspaceRow, [typeof cardId]>(
    "SELECT repository_path, worktree_path, branch_name, base_commit, checkout_mode, before_state_json FROM workspaces WHERE card_id = ?",
  ).get(cardId);
  if (!workspace) {
    const created = await createCardWorkspace(source, input.config);
    saveWorkspace(input.database, cardId, created);
    saveRepositoryPath(input.database, source.repositoryId, created.repositoryPath);
    workspace = {
      repository_path: created.repositoryPath,
      worktree_path: created.worktreePath,
      branch_name: created.branchName,
      base_commit: created.baseCommit,
      checkout_mode: created.checkoutMode,
      before_state_json: JSON.stringify(created.beforeState),
    };
  }
  const provider = stage === "review" ? (context.work_agent === "codex" ? "claude" : "codex") : context.work_agent;
  const selectedRunner = runner(agentProviderSchema.parse(provider));
  const timestamp = new Date().toISOString();
  const priorSession = stage === "building"
    ? input.database.query<PriorSessionRow, [typeof cardId, AgentProvider]>(
        `SELECT agent_sessions.id, agent_sessions.provider_session_id
         FROM agent_runs JOIN agent_sessions ON agent_sessions.id = agent_runs.session_id
         WHERE agent_runs.card_id = ? AND agent_runs.stage = 'planning'
           AND agent_runs.status = 'succeeded' AND agent_sessions.provider = ?
           AND agent_sessions.provider_session_id IS NOT NULL
         ORDER BY agent_runs.created_at DESC LIMIT 1`,
      ).get(cardId, provider)
    : null;
  if (stage === "building" && !priorSession) {
    throw new Error("Building requires a successful Planning session from the selected work agent");
  }
  const sessionId = priorSession?.id ?? crypto.randomUUID();
  if (!priorSession) {
    input.database.query<unknown, [string, typeof cardId, AgentProvider, "work" | "review", string, string]>(
      "INSERT INTO agent_sessions (id, card_id, provider, purpose, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(sessionId, cardId, provider, stage === "review" ? "review" : "work", timestamp, timestamp);
  }
  input.database.query<unknown, [string, AgentProvider, string, string, typeof runId]>(
    "UPDATE agent_runs SET session_id = ?, provider = ?, status = 'running', started_at = ?, updated_at = ? WHERE id = ?",
  ).run(sessionId, provider, timestamp, timestamp, runId);
  const prompt = stagePrompt({ stage, title: context.title, body: context.body, notes: context.notes });
  const before = await captureGitState(workspace.worktree_path);
  let result: AgentResult | null = null;
  let providerSessionId: string | null = null;
  let exitCode = 1;
  const runInput = {
    runId,
    stage,
    cwd: workspace.worktree_path,
    prompt,
    logPath: join(input.config.paths.logsDirectory, `${runId}.log`),
    guardDirectory: join(input.config.paths.dataDirectory, "guard-bin"),
  };
  const events = priorSession
    ? selectedRunner.resume({ ...runInput, sessionId: priorSession.provider_session_id })
    : selectedRunner.start(runInput);
  for await (const event of events) {
    input.database.query<unknown, [typeof runId, string, string, string]>(
      "INSERT INTO run_events (run_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?)",
    ).run(runId, event.kind, JSON.stringify(event), new Date().toISOString());
    if (event.kind === "session") providerSessionId = event.sessionId;
    if (event.kind === "result") result = event.result;
    if (event.kind === "completed") exitCode = event.exitCode;
  }
  const after = await captureGitState(workspace.worktree_path);
  enforceStagePolicy({ stage, before, after });
  const finished = new Date().toISOString();
  const status = exitCode === 0 && result ? (result.questions.length ? "needs_input" : "succeeded") : "failed";
  input.database.transaction(() => {
    input.database.query<
      unknown,
      [string, string | null, string | null, string, string, string, string | null, string, typeof runId]
    >(
      `UPDATE agent_runs SET status = ?, summary = ?, result_json = ?, questions_json = ?,
       log_path = ?, finished_at = ?, error_message = ?, updated_at = ? WHERE id = ?`,
    ).run(
      status,
      result?.summary ?? null,
      result ? JSON.stringify(result) : null,
      JSON.stringify(result?.questions ?? []),
      join(input.config.paths.logsDirectory, `${runId}.log`),
      finished,
      status === "failed" ? "Agent did not return a valid structured result" : null,
      finished,
      runId,
    );
    if (providerSessionId) {
      input.database.query<unknown, [string, string, string]>(
        "UPDATE agent_sessions SET provider_session_id = ?, updated_at = ? WHERE id = ?",
      ).run(providerSessionId, finished, sessionId);
    }
    input.database.query<unknown, [string, string, typeof cardId]>(
      "UPDATE workspaces SET after_state_json = ?, updated_at = ? WHERE card_id = ?",
    ).run(JSON.stringify(after), finished, cardId);
  })();
  if (status === "failed") throw new Error("Agent did not return a valid structured result");
}
