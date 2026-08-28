import { chmod, mkdir, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";

import type { Stage } from "@/src/domain/types";
import { changedOutsideWorktree, type GitState } from "@/src/git/state";

const gitWrapper = `#!/bin/sh
case "$1" in
  commit|push|tag|reset|clean) echo "Engineering Work Board blocked git $1" >&2; exit 77 ;;
esac
exec "$ENG_WORK_BOARD_REAL_GIT" "$@"
`;
const ghWrapper = `#!/bin/sh
echo "Engineering Work Board blocks GitHub CLI writes and agent-side PR creation" >&2
exit 77
`;

export async function prepareAgentPolicy(input: Readonly<{
  guardDirectory: string;
  stage: Exclude<Stage, "backlog" | "done">;
}>): Promise<Readonly<{ environment: NodeJS.ProcessEnv; sandbox: "read-only" | "workspace-write" }>> {
  await mkdir(input.guardDirectory, { recursive: true });
  const gitPath = join(input.guardDirectory, "git");
  const ghPath = join(input.guardDirectory, "gh");
  await Promise.all([writeFile(gitPath, gitWrapper), writeFile(ghPath, ghWrapper)]);
  await Promise.all([chmod(gitPath, 0o700), chmod(ghPath, 0o700)]);
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^(GITHUB_|GH_|GIT_ASKPASS|SSH_ASKPASS|GIT_TERMINAL_PROMPT)/.test(key)) {
      delete environment[key];
    }
  }
  const realGit = Bun.which("git");
  if (!realGit) throw new Error("git is not installed or is not available on PATH");
  environment.ENG_WORK_BOARD_REAL_GIT = realGit;
  environment.PATH = `${input.guardDirectory}${delimiter}${environment.PATH ?? ""}`;
  return { environment, sandbox: input.stage === "building" ? "workspace-write" : "read-only" };
}

export function enforceStagePolicy(input: Readonly<{
  stage: Exclude<Stage, "backlog" | "done">;
  before: GitState;
  after: GitState;
}>): void {
  if (input.stage !== "building" && (input.after.head !== input.before.head || input.after.status.length > 0)) {
    throw new Error(`${input.stage} must not change files or HEAD`);
  }
  if (input.stage === "building" && (input.after.head !== input.before.head || changedOutsideWorktree(input.before, input.after))) {
    throw new Error("Building changed Git history, branches, tags, or remote references");
  }
}
