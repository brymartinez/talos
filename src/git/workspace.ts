import { mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Database } from "@/src/db/sqlite";

import type { AppConfig } from "@/src/config/env";
import type { CardId } from "@/src/domain/types";
import { findLocalRepository, normalizeGitHubRemote } from "@/src/git/repository-locator";
import { runGit } from "@/src/git/run-git";
import { captureGitState, type GitState } from "@/src/git/state";

export type WorkspaceSource = Readonly<{
  cardId: CardId;
  repositoryId: string;
  repositoryName: string;
  cloneUrl: string;
  localClonePath: string | null;
  defaultBranch: string;
  itemType: "issue" | "pull_request";
  githubNumber: number;
  title: string;
  headRef: string | null;
  headRepository: string | null;
  matchReasons: readonly string[];
}>;

export type CardWorkspace = Readonly<{
  repositoryPath: string;
  worktreePath: string;
  branchName: string | null;
  checkoutMode: "branch" | "detached";
  baseCommit: string;
  beforeState: GitState;
}>;

export function worktreeRoot(repositoryPath: string): string {
  return join(repositoryPath, ".worktree");
}

const repositoryLocks = new Map<string, Promise<void>>();

async function serialized<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const prior = repositoryLocks.get(key) ?? Promise.resolve();
  let release = (): void => undefined;
  const next = new Promise<void>((resolvePromise) => {
    release = resolvePromise;
  });
  const chained = prior.then(() => next);
  repositoryLocks.set(key, chained);
  await prior;
  try {
    return await operation();
  } finally {
    release();
    if (repositoryLocks.get(key) === chained) repositoryLocks.delete(key);
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "work";
}

function worktreeName(source: WorkspaceSource): string {
  return `${source.githubNumber}-${slug(source.title)}`;
}

function reviewOnly(source: WorkspaceSource): boolean {
  const reasons = new Set(source.matchReasons);
  return source.itemType === "pull_request" && !reasons.has("assigned") && !reasons.has("authored");
}

export async function resolveRepository(source: WorkspaceSource, config: AppConfig): Promise<string> {
  return serialized(source.repositoryName, async () => {
    if (source.localClonePath) {
      const topLevel = await runGit({
        args: ["rev-parse", "--show-toplevel"],
        cwd: source.localClonePath,
        allowFailure: true,
      });
      if (topLevel.exitCode === 0) {
        const remote = await runGit({
          args: ["remote", "get-url", "origin"],
          cwd: topLevel.stdout,
          allowFailure: true,
        });
        if (
          remote.exitCode === 0 &&
          normalizeGitHubRemote(remote.stdout) === source.repositoryName.toLowerCase()
        ) {
          return topLevel.stdout;
        }
      }
    }
    const local = await findLocalRepository({ roots: config.repositoryRoots, fullName: source.repositoryName });
    if (local) return local;
    const destination = join(config.paths.repositoriesDirectory, source.repositoryName);
    await mkdir(dirname(destination), { recursive: true });
    await runGit({ args: ["clone", "--no-checkout", source.cloneUrl, destination] });
    return destination;
  });
}

export async function createCardWorkspace(
  source: WorkspaceSource,
  config: AppConfig,
): Promise<CardWorkspace> {
  const repositoryPath = await resolveRepository(source, config);
  const worktreePath = join(worktreeRoot(repositoryPath), worktreeName(source));
  await mkdir(worktreeRoot(repositoryPath), { recursive: true });
  return serialized(source.repositoryName, async () => {
    let worktreeExists = false;
    try {
      worktreeExists = (await stat(worktreePath)).isDirectory();
    } catch {
      worktreeExists = false;
    }
    if (worktreeExists) {
      const registered = await runGit({ args: ["worktree", "list", "--porcelain"], cwd: repositoryPath });
      if (!registered.stdout.split("\n").includes(`worktree ${worktreePath}`)) {
        throw new Error("The card worktree path exists but is not registered with this repository");
      }
      const [head, branch] = await Promise.all([
        runGit({ args: ["rev-parse", "HEAD"], cwd: worktreePath }),
        runGit({ args: ["symbolic-ref", "--short", "HEAD"], cwd: worktreePath, allowFailure: true }),
      ]);
      return {
        repositoryPath,
        worktreePath,
        branchName: branch.exitCode === 0 ? branch.stdout : null,
        checkoutMode: branch.exitCode === 0 ? "branch" : "detached",
        baseCommit: head.stdout,
        beforeState: await captureGitState(worktreePath),
      };
    }
    await runGit({ args: ["fetch", "--prune", "origin"], cwd: repositoryPath });
    const detached = reviewOnly(source);
    let target = `origin/${source.defaultBranch}`;
    if (source.itemType === "pull_request" && source.headRef) {
      const localRef = `refs/eng-work-board/pr-${source.githubNumber}`;
      await runGit({
        args: ["fetch", "origin", `pull/${source.githubNumber}/head:${localRef}`],
        cwd: repositoryPath,
      });
      target = localRef;
    }
    const baseCommit = (await runGit({ args: ["rev-parse", target], cwd: repositoryPath })).stdout;
    const branchName = detached
      ? null
      : `codex/${slug(source.repositoryName)}-${source.itemType === "issue" ? "issue" : "pr"}-${source.githubNumber}-${slug(source.title)}`;
    await runGit({
      args: branchName
        ? ["worktree", "add", "-b", branchName, worktreePath, baseCommit]
        : ["worktree", "add", "--detach", worktreePath, baseCommit],
      cwd: repositoryPath,
    });
    const beforeState = await captureGitState(worktreePath);
    return { repositoryPath, worktreePath, branchName, checkoutMode: detached ? "detached" : "branch", baseCommit, beforeState };
  });
}

export async function deleteCardWorkspace(input: Readonly<{
  repositoryPath: string;
  worktreePath: string;
  force: boolean;
}>): Promise<void> {
  const status = await runGit({ args: ["status", "--porcelain=v1"], cwd: input.worktreePath });
  if (status.stdout && !input.force) {
    throw new Error("Workspace has uncommitted changes. Confirm forced deletion first.");
  }
  await runGit({
    args: ["worktree", "remove", ...(input.force ? ["--force"] : []), input.worktreePath],
    cwd: input.repositoryPath,
  });
}

export function saveWorkspace(database: Database, cardId: CardId, workspace: CardWorkspace): void {
  const timestamp = new Date().toISOString();
  database.query<
    unknown,
    [string, CardId, string, string, string | null, string, string, string, string, string]
  >(
    `INSERT INTO workspaces (
      id, card_id, repository_path, worktree_path, branch_name, base_commit,
      checkout_mode, before_state_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(card_id) DO UPDATE SET
      repository_path = excluded.repository_path,
      worktree_path = excluded.worktree_path,
      branch_name = excluded.branch_name,
      base_commit = excluded.base_commit,
      checkout_mode = excluded.checkout_mode,
      before_state_json = excluded.before_state_json,
      updated_at = excluded.updated_at`,
  ).run(
    crypto.randomUUID(), cardId, workspace.repositoryPath, workspace.worktreePath,
    workspace.branchName, workspace.baseCommit, workspace.checkoutMode,
    JSON.stringify(workspace.beforeState), timestamp, timestamp,
  );
}
