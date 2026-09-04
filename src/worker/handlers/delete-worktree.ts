import type { Database } from "@/src/db/sqlite";

import type { CardId } from "@/src/domain/types";
import { deleteCardWorkspace, isCardWorktreePath } from "@/src/git/workspace";

type WorkspaceRow = Readonly<{ repository_path: string; worktree_path: string; branch_name: string | null }>;

export async function handleDeleteWorktree(
  database: Database,
  cardId: CardId,
  force: boolean,
): Promise<void> {
  const row = database.query<WorkspaceRow, [CardId]>(
    "SELECT repository_path, worktree_path, branch_name FROM workspaces WHERE card_id = ?",
  ).get(cardId);
  if (!row) return;
  if (!isCardWorktreePath(row.repository_path, row.worktree_path)) {
    throw new Error("Saved workspace is outside the card worktree directory");
  }
  await deleteCardWorkspace({
    repositoryPath: row.repository_path,
    worktreePath: row.worktree_path,
    branchName: row.branch_name,
    force,
  });
  database.query<unknown, [CardId]>("DELETE FROM workspaces WHERE card_id = ?").run(cardId);
}
