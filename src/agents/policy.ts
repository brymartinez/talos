import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

import type { Stage } from "@/src/domain/types";
import { runGit } from "@/src/git/run-git";
import { changedOutsideWorktree, type GitState } from "@/src/git/state";

const ghWrapper = `#!/bin/sh
echo "Engineering Work Board blocks GitHub CLI writes and agent-side PR creation" >&2
exit 77
`;

function quoteSandboxPath(path: string): string {
  return path.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export async function prepareAgentPolicy(input: Readonly<{
  guardDirectory: string;
  stage: Exclude<Stage, "backlog" | "done">;
  cwd: string;
  runId: string;
}>): Promise<Readonly<{
  environment: NodeJS.ProcessEnv;
  sandbox: "read-only" | "workspace-write";
  sandboxExecutable: string;
  sandboxProfile: string;
}>> {
  const emptyGitHubConfig = join(input.guardDirectory, "empty-gh");
  await Promise.all([
    mkdir(input.guardDirectory, { recursive: true }),
    mkdir(emptyGitHubConfig, { recursive: true }),
  ]);
  const realGit = Bun.which("git");
  const sandboxExecutable = Bun.which("sandbox-exec");
  if (!realGit) throw new Error("git is not installed or is not available on PATH");
  if (!sandboxExecutable) throw new Error("sandbox-exec is required to enforce agent Git policy");
  const gitPath = join(input.guardDirectory, "git");
  const ghPath = join(input.guardDirectory, "gh");
  const gitWrapper = `#!/bin/sh
args="$*"
case "$args" in
  *alias.*) echo "Engineering Work Board blocks Git aliases" >&2; exit 77 ;;
esac
find_command() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      -C|-c|--git-dir|--work-tree|--namespace|--super-prefix) shift 2 ;;
      --*|-*) shift ;;
      *) echo "$1"; return ;;
    esac
  done
}
command=$(find_command "$@")
case "$command" in
  commit|push|tag|reset|clean) echo "Engineering Work Board blocked git $command" >&2; exit 77 ;;
esac
exec "${realGit}" "$@"
`;
  await Promise.all([writeFile(gitPath, gitWrapper), writeFile(ghPath, ghWrapper)]);
  await Promise.all([chmod(gitPath, 0o700), chmod(ghPath, 0o700)]);
  const commonDirectory = (
    await runGit({ args: ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd: input.cwd })
  ).stdout;
  const readOnlyRule = input.stage === "building"
    ? ""
    : `(deny file-write* (subpath "${quoteSandboxPath(input.cwd)}"))`;
  const sandboxProfile = join(input.guardDirectory, `${input.runId}.sb`);
  await writeFile(
    sandboxProfile,
    `(version 1)
(allow default)
(deny file-write* (subpath "${quoteSandboxPath(commonDirectory)}"))
(deny file-write* (literal "${quoteSandboxPath(join(input.cwd, ".git"))}"))
(deny file-read* (subpath "${quoteSandboxPath(join(homedir(), ".ssh"))}"))
(deny file-read* (subpath "${quoteSandboxPath(join(homedir(), ".config", "gh"))}"))
(deny process-exec (literal "/usr/bin/security"))
(deny process-exec (literal "/usr/bin/ssh"))
${readOnlyRule}
`,
  );
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^(GITHUB_|GH_|GIT_ASKPASS|SSH_ASKPASS|GIT_TERMINAL_PROMPT)/.test(key)) {
      delete environment[key];
    }
  }
  environment.GH_CONFIG_DIR = emptyGitHubConfig;
  environment.GIT_CONFIG_GLOBAL = "/dev/null";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_SSH_COMMAND = "/usr/bin/false";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.PATH = `${input.guardDirectory}${delimiter}${environment.PATH ?? ""}`;
  return {
    environment,
    sandbox: input.stage === "building" ? "workspace-write" : "read-only",
    sandboxExecutable,
    sandboxProfile,
  };
}

export function enforceStagePolicy(input: Readonly<{
  stage: Exclude<Stage, "backlog" | "done">;
  before: GitState;
  after: GitState;
}>): void {
  if (
    input.stage !== "building" &&
    (input.after.head !== input.before.head ||
      input.after.worktreeFingerprint !== input.before.worktreeFingerprint)
  ) {
    throw new Error(`${input.stage} must not change files or HEAD`);
  }
  if (input.stage === "building" && (input.after.head !== input.before.head || changedOutsideWorktree(input.before, input.after))) {
    throw new Error("Building changed Git history, branches, tags, or remote references");
  }
}
