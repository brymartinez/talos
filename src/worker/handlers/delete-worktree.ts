import { join, resolve } from "node:path";

import type { Database } from "@/src/db/sqlite";

import type { AppConfig } from "@/src/config/env";
import type { CardId } from "@/src/domain/types";
import { deleteCardWorkspace } from "@/src/git/workspace";

type WorkspaceRow = Readonly<{ repository_path: string; worktree_path: string }>;

export async function handleDeleteWorktree(
  database: Database,
  config: AppConfig,
  cardId: CardId,
  force: boolean,
): Promise<void> {
  const row = database.query<WorkspaceRow, [CardId]>(
    "SELECT repository_path, worktree_path FROM workspaces WHERE card_id = ?",
  ).get(cardId);
  if (!row) return;
  const worktreeRoot = `${resolve(config.paths.worktreesDirectory)}/`;
  const expectedPath = resolve(join(config.paths.worktreesDirectory, cardId));
  if (
    !resolve(row.worktree_path).startsWith(worktreeRoot) ||
    resolve(row.worktree_path) !== expectedPath
  ) {
    throw new Error("Saved workspace is outside the app worktree directory");
  }
  await deleteCardWorkspace({
    repositoryPath: row.repository_path,
    worktreePath: row.worktree_path,
    expectedWorktreePath: expectedPath,
    force,
  });
  database.query<unknown, [CardId]>("DELETE FROM workspaces WHERE card_id = ?").run(cardId);
}
