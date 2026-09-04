import { resolve } from "node:path";

import type { AppConfig } from "@/src/config/env";
import { isCardWorktreePath } from "@/src/git/workspace";

export async function handleOpenVsCode(config: AppConfig, repositoryPath: string, worktreePath: string): Promise<void> {
  if (!isCardWorktreePath(repositoryPath, worktreePath)) throw new Error("Saved workspace is outside the card worktree directory");
  const target = resolve(worktreePath);
  const command = Bun.which(config.codeCommand) ?? config.codeCommand;
  const child = Bun.spawn([command, target], { stdout: "ignore", stderr: "pipe" });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error((await new Response(child.stderr).text()).trim() || "VS Code failed to open");
}
