import { resolve } from "node:path";

import type { Database } from "@/src/db/sqlite";

import type { CardId } from "@/src/domain/types";
import { deleteCardWorkspace, worktreeRoot } from "@/src/git/workspace";

type WorkspaceRow = Readonly<{ repository_path: string; worktree_path: string }>;

export async function handleDeleteWorktree(
  database: Database,
  cardId: CardId,
  force: boolean,
): Promise<void> {
  const row = database.query<WorkspaceRow, [CardId]>(
    "SELECT repository_path, worktree_path FROM workspaces WHERE card_id = ?",
  ).get(cardId);
  if (!row) return;
  const root = `${resolve(worktreeRoot(row.repository_path))}/`;
  if (!resolve(row.worktree_path).startsWith(root)) {
    throw new Error("Saved workspace is outside the card worktree directory");
  }
  await deleteCardWorkspace({
    repositoryPath: row.repository_path,
    worktreePath: row.worktree_path,
    force,
  });
  database.query<unknown, [CardId]>("DELETE FROM workspaces WHERE card_id = ?").run(cardId);
}
