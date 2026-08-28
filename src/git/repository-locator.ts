import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { runGit } from "@/src/git/run-git";

const skippedDirectories = new Set([
  ".eng-work-board",
  ".next",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "worktrees",
]);

export function normalizeGitHubRemote(remote: string): string | null {
  const value = remote.trim().replace(/\.git$/, "");
  const match = /^(?:git@github\.com:|https?:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+)$/.exec(
    value,
  );
  return match?.[1]?.toLowerCase() ?? null;
}

async function repositoryIdentity(path: string): Promise<string | null> {
  try {
    if (!(await stat(path)).isDirectory()) {
      return null;
    }
  } catch {
    return null;
  }
  const result = await runGit({ args: ["remote", "get-url", "origin"], cwd: path, allowFailure: true });
  return result.exitCode === 0 ? normalizeGitHubRemote(result.stdout) : null;
}

export async function findLocalRepository(input: Readonly<{
  roots: readonly string[];
  fullName: string;
  maxDepth?: number;
}>): Promise<string | null> {
  const target = input.fullName.toLowerCase();
  const maxDepth = input.maxDepth ?? 4;
  const visit = async (path: string, depth: number): Promise<string | null> => {
    const identity = await repositoryIdentity(path);
    if (identity === target) {
      return path;
    }
    if (depth >= maxDepth) {
      return null;
    }
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || skippedDirectories.has(entry.name) || entry.name.startsWith(".")) {
        continue;
      }
      const found = await visit(join(path, entry.name), depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  };

  for (const root of input.roots) {
    const directCandidate = join(root, basename(input.fullName));
    if ((await repositoryIdentity(directCandidate)) === target) {
      return directCandidate;
    }
    const found = await visit(root, 0);
    if (found) {
      return found;
    }
  }
  return null;
}
