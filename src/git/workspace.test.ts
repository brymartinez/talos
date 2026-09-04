import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { AppConfig } from "@/src/config/env";
import { deriveAppPaths } from "@/src/config/paths";
import { cardIdSchema } from "@/src/domain/types";
import {
  createCardBranch,
  createCardWorkspace,
  isCardWorktreePath,
  type WorkspaceSource,
  worktreeRoot,
} from "@/src/git/workspace";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function git(cwd: string, ...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

function repositoryFixture(): Readonly<{
  config: AppConfig;
  repositoryPath: string;
  source: WorkspaceSource;
}> {
  const root = mkdtempSync(join(tmpdir(), "eng-work-board-workspace-"));
  temporaryDirectories.push(root);
  const sourceRepository = join(root, "source");
  const remoteRepository = join(root, "remote.git");
  const checkoutPath = join(root, "repository");
  git(root, "init", "-b", "main", sourceRepository);
  git(sourceRepository, "config", "user.name", "Test User");
  git(sourceRepository, "config", "user.email", "test@example.com");
  writeFileSync(join(sourceRepository, "README.md"), "test\n");
  git(sourceRepository, "add", "README.md");
  git(sourceRepository, "commit", "-m", "test: initial commit");
  git(root, "clone", "--bare", sourceRepository, remoteRepository);
  git(root, "clone", remoteRepository, checkoutPath);
  const repositoryPath = realpathSync(checkoutPath);
  git(repositoryPath, "remote", "set-url", "origin", "https://github.com/owner/repository.git");
  git(repositoryPath, "config", `url.file://${remoteRepository}.insteadOf`, "https://github.com/owner/repository.git");

  const dataDirectory = join(root, "data");
  return {
    repositoryPath,
    config: {
      githubToken: "token",
      githubOrganizations: [],
      githubRepositories: ["owner/repository"],
      excludedRepositories: [],
      teamAllowlist: [],
      mentionLookbackDays: 90,
      repositoryRoots: [root],
      paths: deriveAppPaths(dataDirectory),
      workAgent: "codex",
      agentConcurrency: 1,
      codeCommand: "code",
    },
    source: {
      cardId: cardIdSchema.parse(crypto.randomUUID()),
      repositoryId: "repository-id",
      repositoryName: "owner/repository",
      cloneUrl: "https://github.com/owner/repository.git",
      localClonePath: repositoryPath,
      defaultBranch: "main",
      itemType: "issue",
      githubNumber: 42,
      title: "Correct an error",
      headRef: null,
      headRepository: null,
      matchReasons: ["assigned"],
    },
  };
}

describe("card workspaces", () => {
  test("accepts current and saved legacy card worktree paths", () => {
    const repositoryPath = "/tmp/repository";

    expect(isCardWorktreePath(repositoryPath, "/tmp/repository/.worktrees/42-card")).toBe(true);
    expect(isCardWorktreePath(repositoryPath, "/tmp/repository/.worktree/42-card")).toBe(true);
    expect(isCardWorktreePath(repositoryPath, "/tmp/repository/other/42-card")).toBe(false);
  });

  test("creates a detached Planning checkout under the target repository", async () => {
    const fixture = repositoryFixture();

    const workspace = await createCardWorkspace(fixture.source, fixture.config);

    expect(worktreeRoot(fixture.repositoryPath)).toBe(join(fixture.repositoryPath, ".worktrees"));
    expect(workspace.worktreePath).toBe(join(fixture.repositoryPath, ".worktrees", "42-correct-an-error"));
    expect(workspace.branchName).toBeNull();
    expect(workspace.checkoutMode).toBe("detached");
    expect(git(workspace.worktreePath, "branch", "--show-current")).toBe("");
    expect(readFileSync(join(fixture.repositoryPath, ".git", "info", "exclude"), "utf8")).toContain("/.worktrees/");
    expect(git(fixture.repositoryPath, "status", "--short")).toBe("");
  });

  test("creates the selected Conventional Commit branch in the existing worktree", async () => {
    const fixture = repositoryFixture();
    const workspace = await createCardWorkspace(fixture.source, fixture.config);

    const branchName = await createCardBranch({
      repositoryPath: workspace.repositoryPath,
      worktreePath: workspace.worktreePath,
      changeType: "fix",
      githubNumber: fixture.source.githubNumber,
      title: fixture.source.title,
    });

    expect(branchName).toBe("fix/42-correct-an-error");
    expect(git(workspace.worktreePath, "branch", "--show-current")).toBe(branchName);
    expect(await createCardBranch({
      repositoryPath: workspace.repositoryPath,
      worktreePath: workspace.worktreePath,
      changeType: "fix",
      githubNumber: fixture.source.githubNumber,
      title: fixture.source.title,
    })).toBe(branchName);
  });
});
