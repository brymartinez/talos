import type { Database } from "@/src/db/sqlite";

import type { CardId } from "@/src/domain/types";
import { deleteCardWorkspace } from "@/src/git/workspace";

type WorkspaceRow = Readonly<{ repository_path: string; worktree_path: string }>;

export async function handleDeleteWorktree(database: Database, cardId: CardId, force: boolean): Promise<void> {
  const row = database.query<WorkspaceRow, [CardId]>(
    "SELECT repository_path, worktree_path FROM workspaces WHERE card_id = ?",
  ).get(cardId);
  if (!row) return;
  await deleteCardWorkspace({
    repositoryPath: row.repository_path,
    worktreePath: row.worktree_path,
    expectedWorktreePath: row.worktree_path,
    force,
  });
  database.query<unknown, [CardId]>("DELETE FROM workspaces WHERE card_id = ?").run(cardId);
}
