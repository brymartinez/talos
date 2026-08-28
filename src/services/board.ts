import type { Database } from "@/src/db/sqlite";

import type { AppConfig } from "@/src/config/env";
import { matchReasonSchema, runStateSchema, stageSchema } from "@/src/domain/types";

type CardRow = Readonly<{
  id: string; source_id: string; stage: string; position: number; notes: string; notes_updated_at: string | null;
  work_agent: "codex" | "claude"; archived: number; no_longer_assigned: number;
  title: string; body: string; html_url: string; item_type: "issue" | "pull_request";
  github_number: number; repository_name: string; labels_json: string;
}>;
type ReasonRow = Readonly<{ source_item_id: string; reason: string }>;
type RunRow = Readonly<{
  id: string; card_id: string; stage: string; provider: string; status: string;
  summary: string | null; result_json: string | null; questions_json: string | null;
  log_path: string | null; error_message: string | null; created_at: string; finished_at: string | null;
}>;
type RefreshRow = Readonly<{
  id: string; status: string; repository_count: number; source_item_count: number;
  started_at: string; finished_at: string | null;
}>;

export function boardSnapshot(database: Database, config: AppConfig): unknown {
  const rows = database.query<CardRow, []>(
    `SELECT cards.id, source_items.id AS source_id, cards.stage, cards.position, cards.notes, cards.notes_updated_at,
      cards.work_agent, cards.archived, cards.no_longer_assigned,
      source_items.title, source_items.body, source_items.html_url, source_items.item_type,
      source_items.github_number, repositories.full_name AS repository_name, source_items.labels_json
     FROM cards JOIN source_items ON source_items.id = cards.source_item_id
     JOIN repositories ON repositories.id = source_items.repository_id
     WHERE cards.archived = 0 ORDER BY cards.stage, cards.position`,
  ).all();
  const reasons = database.query<ReasonRow, []>(
    "SELECT source_item_id, reason FROM match_reasons",
  ).all();
  const reasonBySource = new Map<string, string[]>();
  for (const reason of reasons) {
    const list = reasonBySource.get(reason.source_item_id) ?? [];
    list.push(matchReasonSchema.parse(reason.reason));
    reasonBySource.set(reason.source_item_id, list);
  }
  const runRows = database.query<RunRow, []>(
    `SELECT id, card_id, stage, provider, status, summary, result_json, questions_json,
      log_path, error_message, created_at, finished_at FROM agent_runs ORDER BY created_at DESC`,
  ).all();
  const runsByCard = new Map<string, unknown[]>();
  for (const run of runRows) {
    const list = runsByCard.get(run.card_id) ?? [];
    list.push({
      id: run.id, stage: stageSchema.parse(run.stage), provider: run.provider,
      status: runStateSchema.parse(run.status), summary: run.summary,
      result: run.result_json ? JSON.parse(run.result_json) : null,
      questions: JSON.parse(run.questions_json ?? "[]"), errorMessage: run.error_message,
      logUrl: run.log_path ? `/api/runs/${run.id}/log` : null,
      createdAt: run.created_at, finishedAt: run.finished_at,
    });
    runsByCard.set(run.card_id, list);
  }
  const cards = rows.map((row) => ({
    id: row.id, stage: stageSchema.parse(row.stage), position: row.position,
    title: row.title, body: row.body, url: row.html_url, itemType: row.item_type,
    number: row.github_number, repository: row.repository_name,
    labels: JSON.parse(row.labels_json), matchReasons: reasonBySource.get(row.source_id) ?? [],
    notes: row.notes, notesUpdatedAt: row.notes_updated_at, workAgent: row.work_agent,
    noLongerAssigned: row.no_longer_assigned === 1, runs: runsByCard.get(row.id) ?? [],
  }));
  const refresh = database.query<RefreshRow, []>(
    "SELECT id, status, repository_count, source_item_count, started_at, finished_at FROM refresh_runs ORDER BY started_at DESC LIMIT 1",
  ).get();
  const errors = refresh ? database.query<{ scope: string; code: string; message: string }, [string]>(
    "SELECT scope, code, message FROM refresh_errors WHERE refresh_run_id = ? ORDER BY id",
  ).all(refresh.id) : [];
  return {
    columns: ["backlog", "planning", "building", "review", "done"], cards,
    refresh: refresh ? { id: refresh.id, status: refresh.status, repositoryCount: refresh.repository_count, sourceItemCount: refresh.source_item_count, startedAt: refresh.started_at, finishedAt: refresh.finished_at, errors } : null,
    config: { organization: config.githubOrganization, repositories: config.extraRepositories, workAgent: config.workAgent, concurrency: config.agentConcurrency },
  };
}
