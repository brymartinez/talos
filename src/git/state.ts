import { runGit } from "@/src/git/run-git";

export type GitState = Readonly<{
  head: string;
  status: readonly string[];
  branches: readonly string[];
  tags: readonly string[];
  remoteReferences: readonly string[];
}>;

function lines(value: string): readonly string[] {
  return value ? value.split("\n").filter(Boolean) : [];
}

export async function captureGitState(path: string): Promise<GitState> {
  const [head, status, branches, tags, remotes] = await Promise.all([
    runGit({ args: ["rev-parse", "HEAD"], cwd: path }),
    runGit({ args: ["status", "--porcelain=v1"], cwd: path }),
    runGit({ args: ["for-each-ref", "--format=%(refname):%(objectname)", "refs/heads"], cwd: path }),
    runGit({ args: ["for-each-ref", "--format=%(refname):%(objectname)", "refs/tags"], cwd: path }),
    runGit({ args: ["for-each-ref", "--format=%(refname):%(objectname)", "refs/remotes"], cwd: path }),
  ]);
  return {
    head: head.stdout,
    status: lines(status.stdout),
    branches: lines(branches.stdout),
    tags: lines(tags.stdout),
    remoteReferences: lines(remotes.stdout),
  };
}

export function changedOutsideWorktree(before: GitState, after: GitState): boolean {
  return (
    before.branches.join("\n") !== after.branches.join("\n") ||
    before.tags.join("\n") !== after.tags.join("\n") ||
    before.remoteReferences.join("\n") !== after.remoteReferences.join("\n")
  );
}
