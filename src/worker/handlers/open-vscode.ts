import { resolve } from "node:path";

import type { AppConfig } from "@/src/config/env";

export async function handleOpenVsCode(config: AppConfig, worktreePath: string): Promise<void> {
  const root = `${resolve(config.paths.worktreesDirectory)}/`;
  const target = resolve(worktreePath);
  if (!target.startsWith(root)) throw new Error("Saved workspace is outside the app worktree directory");
  const command = Bun.which(config.codeCommand) ?? config.codeCommand;
  const child = Bun.spawn([command, target], { stdout: "ignore", stderr: "pipe" });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error((await new Response(child.stderr).text()).trim() || "VS Code failed to open");
}
