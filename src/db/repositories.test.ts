import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AppConfig } from "@/src/config/env";
import { deriveAppPaths } from "@/src/config/paths";
import { closeBunDatabases, getBunDatabase } from "@/src/db/client-bun";
import {
  reconcileSourceItems,
  type ReconciledRepository,
  type ReconciledSourceItem,
} from "@/src/db/repositories";

function repository(id: string, fullName: string): ReconciledRepository {
  const [owner = "", name = ""] = fullName.split("/");
  return {
    id,
    owner,
    name,
    fullName,
    cloneUrl: `https://github.com/${fullName}.git`,
    sshUrl: `git@github.com:${fullName}.git`,
    defaultBranch: "main",
  };
}

function source(id: string, repositoryName: string): ReconciledSourceItem {
  return {
    id,
    repositoryName,
    githubNumber: Number(id),
    itemType: "issue",
    title: `Issue ${id}`,
    body: "",
    htmlUrl: `https://github.com/${repositoryName}/issues/${id}`,
    state: "open",
    merged: false,
    authorLogin: "bryan",
    assignees: ["bryan"],
    requestedTeams: [],
    labels: [],
    headRef: null,
    headRepository: null,
    baseRef: null,
    githubCreatedAt: "2026-09-03T00:00:00.000Z",
    githubUpdatedAt: "2026-09-03T00:00:00.000Z",
    githubClosedAt: null,
    matchReasons: ["assigned"],
  };
}

describe("repository scope reconciliation", () => {
  test("archives cards from repositories removed from configuration", () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "eng-work-board-test-"));
    const config = {
      githubToken: "token",
      githubOrganizations: [],
      githubRepositories: ["brymartinez/nest-starter"],
      excludedRepositories: [],
      teamAllowlist: [],
      mentionLookbackDays: 90,
      repositoryRoots: [],
      paths: deriveAppPaths(dataDirectory),
      workAgent: "codex",
      agentConcurrency: 1,
      codeCommand: "code",
    } satisfies AppConfig;
    const database = getBunDatabase(config);
    const currentRepository = repository("1", "brymartinez/nest-starter");
    const oldRepository = repository("2", "old-org/old-repository");
    const currentSource = source("101", currentRepository.fullName);
    const oldSource = source("202", oldRepository.fullName);

    try {
      reconcileSourceItems(database, {
        repositories: [currentRepository, oldRepository],
        sourceItems: [currentSource, oldSource],
        trackedMissing: [],
        workAgent: "codex",
        allowStaleReconciliation: true,
        preserveMatchReasons: [],
      });

      reconcileSourceItems(database, {
        repositories: [currentRepository],
        sourceItems: [currentSource],
        trackedMissing: [],
        workAgent: "codex",
        allowStaleReconciliation: true,
        preserveMatchReasons: [],
      });

      const cards = database.query<
        Readonly<{ repository: string; archived: number }>,
        []
      >(
        `SELECT repositories.full_name AS repository, cards.archived
         FROM cards
         JOIN source_items ON source_items.id = cards.source_item_id
         JOIN repositories ON repositories.id = source_items.repository_id
         ORDER BY repositories.full_name`,
      ).all();

      expect(cards).toEqual([
        { repository: "brymartinez/nest-starter", archived: 0 },
        { repository: "old-org/old-repository", archived: 1 },
      ]);
    } finally {
      closeBunDatabases();
      rmSync(dataDirectory, { recursive: true, force: true });
    }
  });
});
