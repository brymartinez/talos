import { access, chmod, mkdir, realpath, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import type { AgentProvider, Stage } from "@/src/domain/types";
import { runGit } from "@/src/git/run-git";
import { changedOutsideWorktree, type GitState } from "@/src/git/state";

const ghWrapper = `#!/bin/sh
echo "Engineering Work Board blocks GitHub CLI writes and agent-side PR creation" >&2
exit 77
`;

function quoteSandboxPath(path: string): string {
  return path.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function executablePaths(name: string): Promise<readonly string[]> {
  const paths = new Set<string>();
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      paths.add(candidate);
      paths.add(await realpath(candidate));
    } catch {
      // This PATH entry does not contain the executable.
    }
  }
  return [...paths];
}

function denyExecutable(path: string): string {
  const quoted = quoteSandboxPath(path);
  return `(deny process-exec (literal "${quoted}"))\n(deny file-read* (literal "${quoted}"))`;
}

export async function prepareAgentPolicy(input: Readonly<{
  guardDirectory: string;
  stage: Exclude<Stage, "backlog" | "done">;
  cwd: string;
  runId: string;
  provider: AgentProvider;
}>): Promise<Readonly<{
  environment: NodeJS.ProcessEnv;
  sandboxExecutable: string;
  sandboxProfile: string;
}>> {
  const runDirectory = join(input.guardDirectory, "runs", input.runId);
  const binDirectory = join(runDirectory, "bin");
  const emptyGitHubConfig = join(runDirectory, "empty-gh");
  const temporaryDirectory = join(runDirectory, "tmp");
  const cacheDirectory = join(runDirectory, "cache");
  await Promise.all([
    mkdir(binDirectory, { recursive: true }),
    mkdir(emptyGitHubConfig, { recursive: true }),
    mkdir(temporaryDirectory, { recursive: true }),
    mkdir(cacheDirectory, { recursive: true }),
  ]);
  const sandboxExecutable = Bun.which("sandbox-exec");
  if (!sandboxExecutable) throw new Error("sandbox-exec is required to enforce agent Git policy");
  const curlExecutable = Bun.which("curl");
  if (!curlExecutable) throw new Error("curl is required to provide read-only Git inspection");
  const gitPath = join(binDirectory, "git");
  const ghPath = join(binDirectory, "gh");
  const gitWrapper = `#!/bin/sh
response=$(mktemp "$TMPDIR/ewb-response.XXXXXX") || exit 1
trap 'rm -f "$response"' EXIT
printf '%s\n' "$@" | "${curlExecutable}" --fail-with-body --silent --show-error \
  --header "Authorization: Bearer $ENG_WORK_BOARD_GIT_BROKER_TOKEN" \
  --data-binary @- "$ENG_WORK_BOARD_GIT_BROKER_URL" > "$response" || exit 1
status=$(sed -n '1p' "$response")
sed -n '2,$p' "$response"
case "$status" in
  ''|*[!0-9]*) exit 1 ;;
  *) exit "$status" ;;
esac
`;
  await Promise.all([writeFile(gitPath, gitWrapper), writeFile(ghPath, ghWrapper)]);
  await Promise.all([chmod(gitPath, 0o700), chmod(ghPath, 0o700)]);
  const commonDirectory = (
    await runGit({ args: ["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd: input.cwd })
  ).stdout;
  const gitExecPath = (await runGit({ args: ["--exec-path"] })).stdout;
  const credentialHelpers = [
    "git-credential-cache",
    "git-credential-cache--daemon",
    "git-credential-osxkeychain",
    "git-credential-store",
  ].map((name) => join(gitExecPath, name));
  const xcodeGit = resolve(gitExecPath, "../../bin/git");
  const blockedExecutables = new Set([
    ...(await executablePaths("git")),
    ...(await executablePaths("gh")),
    xcodeGit,
    ...credentialHelpers,
    "/usr/bin/security",
    "/usr/bin/ssh",
    "/usr/bin/xcrun",
  ]);
  // The Claude Code CLI derives its own scratchpad directory from cwd under
  // /private/tmp/claude-<uid>/... regardless of the TMPDIR we inject above, so the
  // sandbox must allow writes there directly or every run's mkdir gets EPERM.
  const providerWriteRules = input.provider === "codex"
    ? `(allow file-write* (subpath "${quoteSandboxPath(join(homedir(), ".codex"))}"))`
    : `(allow file-write* (subpath "${quoteSandboxPath(join(homedir(), ".claude"))}"))
(allow file-write* (literal "${quoteSandboxPath(join(homedir(), ".claude.json"))}"))
(allow file-write* (subpath "${quoteSandboxPath(join("/private/tmp", `claude-${process.getuid()}`))}"))`;
  const worktreeWriteRule = input.stage === "building"
    ? `(allow file-write* (subpath "${quoteSandboxPath(input.cwd)}"))`
    : "";
  const sandboxProfile = join(runDirectory, "agent.sb");
  const blockedCommandPattern = `(deny process-exec (regex #"/(?:git|git-[^/]+|gh)$"))
(deny file-read* (regex #"/(?:git|git-[^/]+|gh)$"))
(allow process-exec (literal "${quoteSandboxPath(gitPath)}"))
(allow file-read* (literal "${quoteSandboxPath(gitPath)}"))
(allow process-exec (literal "${quoteSandboxPath(ghPath)}"))
(allow file-read* (literal "${quoteSandboxPath(ghPath)}"))`;
  await writeFile(
    sandboxProfile,
    `(version 1)
(allow default)
(deny file-write*)
(allow file-write* (subpath "${quoteSandboxPath(runDirectory)}"))
${providerWriteRules}
${worktreeWriteRule}
(deny file-write* (subpath "${quoteSandboxPath(commonDirectory)}"))
(deny file-write* (literal "${quoteSandboxPath(join(input.cwd, ".git"))}"))
(deny file-read* (subpath "${quoteSandboxPath(join(homedir(), ".ssh"))}"))
(deny file-read* (subpath "${quoteSandboxPath(join(homedir(), ".config", "gh"))}"))
${blockedCommandPattern}
${[...blockedExecutables].map(denyExecutable).join("\n")}
`,
  );
  const environment = { ...process.env };
  for (const key of Object.keys(environment)) {
    if (/^(GITHUB_|GH_|GIT_|SSH_|ENG_WORK_BOARD_)/.test(key)) {
      delete environment[key];
    }
  }
  environment.GH_CONFIG_DIR = emptyGitHubConfig;
  environment.GIT_CONFIG_GLOBAL = "/dev/null";
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_SSH_COMMAND = "/usr/bin/false";
  environment.GIT_TERMINAL_PROMPT = "0";
  environment.TMPDIR = temporaryDirectory;
  environment.XDG_CACHE_HOME = cacheDirectory;
  environment.BUN_INSTALL_CACHE_DIR = join(cacheDirectory, "bun");
  environment.COREPACK_HOME = join(cacheDirectory, "corepack");
  environment.YARN_CACHE_FOLDER = join(cacheDirectory, "yarn");
  environment.npm_config_cache = join(cacheDirectory, "npm");
  environment.PATH = `${binDirectory}${delimiter}${environment.PATH ?? ""}`;
  return {
    environment,
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
