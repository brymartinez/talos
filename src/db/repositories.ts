import type { Database } from "@/src/db/sqlite";
import { z } from "zod";

import {
  cardIdSchema,
  jobIdSchema,
  newJobId,
  type CardId,
  type JobId,
  type JobKind,
  type Stage,
  type AgentProvider,
  type ItemType,
  type MatchReason,
  newCardId,
  newRefreshId,
  type RefreshId,
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

export type CardWorkSource = Readonly<{
  cardId: CardId;
  repositoryId: string;
  repositoryName: string;
  cloneUrl: string;
  localClonePath: string | null;
  defaultBranch: string;
  itemType: ItemType;
  githubNumber: number;
  title: string;
  headRef: string | null;
  headRepository: string | null;
  matchReasons: readonly string[];
}>;

type CardWorkSourceRow = Omit<CardWorkSource, "cardId" | "matchReasons"> &
  Readonly<{ cardId: string; matchReasonsJson: string }>;

export function getCardWorkSource(database: Database, cardId: CardId): CardWorkSource {
  const row = database
    .query<CardWorkSourceRow, [CardId]>(
      `SELECT
        cards.id AS cardId,
        repositories.id AS repositoryId,
        repositories.full_name AS repositoryName,
        repositories.clone_url AS cloneUrl,
        repositories.local_clone_path AS localClonePath,
        repositories.default_branch AS defaultBranch,
        source_items.item_type AS itemType,
        source_items.github_number AS githubNumber,
        source_items.title,
        source_items.head_ref AS headRef,
        source_items.head_repository AS headRepository,
        COALESCE((
          SELECT json_group_array(reason)
          FROM match_reasons
          WHERE source_item_id = source_items.id
        ), '[]') AS matchReasonsJson
      FROM cards
      JOIN source_items ON source_items.id = cards.source_item_id
      JOIN repositories ON repositories.id = source_items.repository_id
      WHERE cards.id = ?`,
    )
    .get(cardId);
  if (!row) throw new Error(`Card ${cardId} does not exist`);
  return {
    ...row,
    cardId: cardIdSchema.parse(row.cardId),
    matchReasons: z.array(z.string()).parse(JSON.parse(row.matchReasonsJson)),
  };
}

export function saveRepositoryPath(database: Database, repositoryId: string, path: string): void {
  database
    .query<unknown, [string, string, string]>(
      "UPDATE repositories SET local_clone_path = ?, updated_at = ? WHERE id = ?",
    )
    .run(path, now(), repositoryId);
}

export type ReconciledRepository = Readonly<{
  id: string;
  owner: string;
  name: string;
  fullName: string;
  cloneUrl: string;
  sshUrl: string;
  defaultBranch: string;
}>;

export type ReconciledSourceItem = Readonly<{
  id: string;
  repositoryName: string;
  githubNumber: number;
  itemType: ItemType;
  title: string;
  body: string;
  htmlUrl: string;
  state: "open" | "closed";
  merged: boolean;
  authorLogin: string;
  assignees: readonly string[];
  requestedTeams: readonly string[];
  labels: readonly string[];
  headRef: string | null;
  headRepository: string | null;
  baseRef: string | null;
  githubCreatedAt: string;
  githubUpdatedAt: string;
  githubClosedAt: string | null;
  matchReasons: readonly MatchReason[];
}>;

export type TrackedOpenSource = {
  sourceItemId: string;
  repositoryName: string;
  githubNumber: number;
  itemType: ItemType;
  stage: Stage;
  state: "open" | "closed";
  merged: boolean;
  closedAt: string | null;
};

type TrackedOpenRow = Readonly<{
  source_item_id: string;
  repository_name: string;
  github_number: number;
  item_type: ItemType;
  stage: Stage;
  state: "open" | "closed";
  merged: number;
  github_closed_at: string | null;
}>;

export function listTrackedOpenSources(
  database: Database,
  repositoryNames: readonly string[],
): TrackedOpenSource[] {
  if (repositoryNames.length === 0) {
    return [];
  }
  const placeholders = repositoryNames.map(() => "?").join(", ");
  const rows = database
    .query<TrackedOpenRow, string[]>(
      `SELECT
        source_items.id AS source_item_id,
        repositories.full_name AS repository_name,
        source_items.github_number,
        source_items.item_type,
        cards.stage,
        source_items.state,
        source_items.merged,
        source_items.github_closed_at
      FROM source_items
      JOIN repositories ON repositories.id = source_items.repository_id
      JOIN cards ON cards.source_item_id = source_items.id
      WHERE cards.archived = 0
        AND source_items.state = 'open'
        AND lower(repositories.full_name) IN (${placeholders})`,
    )
    .all(...repositoryNames);
  return rows.map((row) => ({
    sourceItemId: row.source_item_id,
    repositoryName: row.repository_name,
    githubNumber: row.github_number,
    itemType: row.item_type,
    stage: row.stage,
    state: row.state,
    merged: row.merged === 1,
    closedAt: row.github_closed_at,
  }));
}

export function beginRefresh(database: Database): RefreshId {
  const refreshId = newRefreshId();
  const timestamp = now();
  database
    .query<unknown, [RefreshId, string, string]>(
      "INSERT INTO refresh_runs (id, status, started_at, created_at) VALUES (?, 'running', ?, ?)",
    )
    .run(refreshId, timestamp, timestamp);
  return refreshId;
}

export function recordRefreshError(
  database: Database,
  refreshId: string,
  error: Readonly<{ scope: string; code: string; message: string }>,
): void {
  database
    .query<unknown, [string, string, string, string, string]>(
      `INSERT INTO refresh_errors (
        refresh_run_id, scope, code, message, created_at
      ) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(refreshId, error.scope, error.code, error.message, now());
}

export function completeRefresh(
  database: Database,
  input: Readonly<{
    refreshId: string;
    status: "completed" | "partial" | "failed";
    repositoryCount: number;
    sourceItemCount: number;
  }>,
): void {
  database
    .query<unknown, [string, number, number, string, string]>(
      `UPDATE refresh_runs
      SET status = ?, repository_count = ?, source_item_count = ?, finished_at = ?
      WHERE id = ?`,
    )
    .run(input.status, input.repositoryCount, input.sourceItemCount, now(), input.refreshId);
}

type ReconcileInput = Readonly<{
  repositories: readonly ReconciledRepository[];
  sourceItems: readonly ReconciledSourceItem[];
  trackedMissing: readonly TrackedOpenSource[];
  workAgent: AgentProvider;
  allowStaleReconciliation: boolean;
}>;

export function reconcileSourceItems(database: Database, input: ReconcileInput): void {
  database.transaction(() => {
    const timestamp = now();
    for (const repository of input.repositories) {
      database
        .query<
          unknown,
          [string, string, string, string, string, string, string, string, string, string]
        >(
          `INSERT INTO repositories (
            id, owner, name, full_name, clone_url, ssh_url, default_branch,
            last_synced_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            owner = excluded.owner,
            name = excluded.name,
            full_name = excluded.full_name,
            clone_url = excluded.clone_url,
            ssh_url = excluded.ssh_url,
            default_branch = excluded.default_branch,
            last_synced_at = excluded.last_synced_at,
            updated_at = excluded.updated_at`,
        )
        .run(
          repository.id,
          repository.owner,
          repository.name,
          repository.fullName,
          repository.cloneUrl,
          repository.sshUrl,
          repository.defaultBranch,
          timestamp,
          timestamp,
          timestamp,
        );
    }

    const currentIds = new Set<string>();
    for (const source of input.sourceItems) {
      currentIds.add(source.id);
      const repository = input.repositories.find(
        (candidate) => candidate.fullName.toLowerCase() === source.repositoryName.toLowerCase(),
      );
      if (!repository) {
        throw new Error(`Repository ${source.repositoryName} was not reconciled`);
      }
      database
        .query<
          unknown,
          [
            string,
            string,
            number,
            ItemType,
            string,
            string,
            string,
            "open" | "closed",
            number,
            string,
            string,
            string,
            string,
            string | null,
            string | null,
            string | null,
            string,
            string,
            string | null,
            string,
            string,
          ]
        >(
          `INSERT INTO source_items (
            id, repository_id, github_number, item_type, title, body, html_url,
            state, merged, author_login, assignees_json, requested_teams_json,
            labels_json, head_ref, head_repository, base_ref, github_created_at,
            github_updated_at, github_closed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            body = excluded.body,
            html_url = excluded.html_url,
            state = excluded.state,
            merged = excluded.merged,
            author_login = excluded.author_login,
            assignees_json = excluded.assignees_json,
            requested_teams_json = excluded.requested_teams_json,
            labels_json = excluded.labels_json,
            head_ref = excluded.head_ref,
            head_repository = excluded.head_repository,
            base_ref = excluded.base_ref,
            github_updated_at = excluded.github_updated_at,
            github_closed_at = excluded.github_closed_at,
            updated_at = excluded.updated_at`,
        )
        .run(
          source.id,
          repository.id,
          source.githubNumber,
          source.itemType,
          source.title,
          source.body,
          source.htmlUrl,
          source.state,
          source.merged ? 1 : 0,
          source.authorLogin,
          JSON.stringify(source.assignees),
          JSON.stringify(source.requestedTeams),
          JSON.stringify(source.labels),
          source.headRef,
          source.headRepository,
          source.baseRef,
          source.githubCreatedAt,
          source.githubUpdatedAt,
          source.githubClosedAt,
          timestamp,
          timestamp,
        );
      database.query<unknown, [string]>("DELETE FROM match_reasons WHERE source_item_id = ?").run(source.id);
      for (const reason of source.matchReasons) {
        database
          .query<unknown, [string, MatchReason]>(
            "INSERT INTO match_reasons (source_item_id, reason) VALUES (?, ?)",
          )
          .run(source.id, reason);
      }
      const existingCard = database
        .query<{ id: string }, [string]>("SELECT id FROM cards WHERE source_item_id = ?")
        .get(source.id);
      if (existingCard) {
        database
          .query<unknown, [string, string]>(
            "UPDATE cards SET archived = 0, no_longer_assigned = 0, updated_at = ? WHERE id = ?",
          )
          .run(timestamp, existingCard.id);
      } else {
        database
          .query<unknown, [CardId, string, number, AgentProvider, string, string]>(
            `INSERT INTO cards (
              id, source_item_id, stage, position, work_agent, created_at, updated_at
            ) VALUES (?, ?, 'backlog', ?, ?, ?, ?)`,
          )
          .run(
            newCardId(),
            source.id,
            positionAtTop(database, "backlog"),
            input.workAgent,
            timestamp,
            timestamp,
          );
      }
    }

    for (const tracked of input.trackedMissing) {
      if (currentIds.has(tracked.sourceItemId)) {
        continue;
      }
      if (tracked.state === "closed" || tracked.merged) {
        database
          .query<unknown, ["open" | "closed", number, string | null, string, string]>(
            `UPDATE source_items
            SET state = ?, merged = ?, github_closed_at = ?, updated_at = ?
            WHERE id = ?`,
          )
          .run(tracked.state, tracked.merged ? 1 : 0, tracked.closedAt, timestamp, tracked.sourceItemId);
        database
          .query<unknown, [string, string]>(
            "UPDATE cards SET stage = 'done', updated_at = ? WHERE source_item_id = ?",
          )
          .run(timestamp, tracked.sourceItemId);
      } else if (input.allowStaleReconciliation) {
        if (tracked.stage === "backlog") {
          database
            .query<unknown, [string, string]>(
              "UPDATE cards SET archived = 1, updated_at = ? WHERE source_item_id = ?",
            )
            .run(timestamp, tracked.sourceItemId);
        } else {
          database
            .query<unknown, [string, string]>(
              "UPDATE cards SET no_longer_assigned = 1, updated_at = ? WHERE source_item_id = ?",
            )
            .run(timestamp, tracked.sourceItemId);
        }
      }
    }
  })();
}
