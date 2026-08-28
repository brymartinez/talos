import { createHash } from "node:crypto";
import { lstat, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";

import { runGit } from "@/src/git/run-git";

export type GitState = Readonly<{
  head: string;
  status: readonly string[];
  branches: readonly string[];
  tags: readonly string[];
  remoteReferences: readonly string[];
  worktreeFingerprint: string;
}>;

function lines(value: string): readonly string[] {
  return value ? value.split("\n").filter(Boolean) : [];
}

export async function captureGitState(path: string): Promise<GitState> {
  const [head, status, branches, tags, remotes, trackedDiff, untracked] = await Promise.all([
    runGit({ args: ["rev-parse", "HEAD"], cwd: path }),
    runGit({ args: ["status", "--porcelain=v1"], cwd: path }),
    runGit({ args: ["for-each-ref", "--format=%(refname):%(objectname)", "refs/heads"], cwd: path }),
    runGit({ args: ["for-each-ref", "--format=%(refname):%(objectname)", "refs/tags"], cwd: path }),
    runGit({ args: ["for-each-ref", "--format=%(refname):%(objectname)", "refs/remotes"], cwd: path }),
    runGit({ args: ["diff", "--binary", "HEAD"], cwd: path, preserveWhitespace: true }),
    runGit({ args: ["ls-files", "--others", "--exclude-standard"], cwd: path }),
  ]);
  const fingerprint = createHash("sha256");
  fingerprint.update(trackedDiff.stdout);
  for (const relativePath of [...lines(untracked.stdout)].sort()) {
    const fullPath = join(path, relativePath);
    const file = await lstat(fullPath);
    fingerprint.update(relativePath);
    if (file.isSymbolicLink()) {
      fingerprint.update(await readlink(fullPath));
    } else if (file.isFile()) {
      fingerprint.update(await readFile(fullPath));
    } else {
      fingerprint.update(`non-file:${file.mode}:${file.size}`);
    }
  }
  return {
    head: head.stdout,
    status: lines(status.stdout),
    branches: lines(branches.stdout),
    tags: lines(tags.stdout),
    remoteReferences: lines(remotes.stdout),
    worktreeFingerprint: fingerprint.digest("hex"),
  };
}

export function changedOutsideWorktree(before: GitState, after: GitState): boolean {
  return (
    before.branches.join("\n") !== after.branches.join("\n") ||
    before.tags.join("\n") !== after.tags.join("\n") ||
    before.remoteReferences.join("\n") !== after.remoteReferences.join("\n")
  );
}
