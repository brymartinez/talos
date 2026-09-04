import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AppConfig } from "@/src/config/env";
import { deriveAppPaths } from "@/src/config/paths";
import { closeBunDatabases, getBunDatabase } from "@/src/db/client-bun";
import { reconcileSourceItems } from "@/src/db/repositories";
import type { Database } from "@/src/db/sqlite";
import { cardIdSchema, type CardId } from "@/src/domain/types";
import { moveCard, saveSuggestedChangeType, updateCard } from "@/src/services/cards";

const temporaryDirectories: string[] = [];

function databaseWithCard(): Readonly<{ database: Database; cardId: CardId }> {
  const dataDirectory = mkdtempSync(join(tmpdir(), "eng-work-board-cards-"));
  temporaryDirectories.push(dataDirectory);
  const config = {
    githubToken: "token",
    githubOrganizations: [],
    githubRepositories: ["owner/repository"],
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
  reconcileSourceItems(database, {
    repositories: [{
      id: "repository-1",
      owner: "owner",
      name: "repository",
      fullName: "owner/repository",
      cloneUrl: "https://github.com/owner/repository.git",
      sshUrl: "git@github.com:owner/repository.git",
      defaultBranch: "main",
    }],
    sourceItems: [{
      id: "source-1",
      repositoryName: "owner/repository",
      githubNumber: 42,
      itemType: "issue",
      title: "Correct an error",
      body: "",
      htmlUrl: "https://github.com/owner/repository/issues/42",
      state: "open",
      merged: false,
      authorLogin: "bryan",
      assignees: ["bryan"],
      requestedTeams: [],
      labels: [],
      headRef: null,
      headRepository: null,
      baseRef: null,
      githubCreatedAt: "2026-09-04T00:00:00.000Z",
      githubUpdatedAt: "2026-09-04T00:00:00.000Z",
      githubClosedAt: null,
      matchReasons: ["assigned"],
    }],
    trackedMissing: [],
    workAgent: "codex",
    allowStaleReconciliation: true,
    preserveMatchReasons: [],
  });
  const card = database.query<Readonly<{ id: string }>, []>("SELECT id FROM cards").get();
  if (!card) throw new Error("Test card was not created");
  return { database, cardId: cardIdSchema.parse(card.id) };
}

function finishPlanning(database: Database, cardId: string): void {
  database.query<unknown, [string]>("UPDATE agent_runs SET status = 'succeeded' WHERE card_id = ?").run(cardId);
  database.query<unknown, [string]>("UPDATE queue_jobs SET state = 'completed' WHERE card_id = ?").run(cardId);
}

afterEach(() => {
  closeBunDatabases();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("card change type", () => {
  test("uses the Planning suggestion unless the user already selected a type", () => {
    const { database, cardId } = databaseWithCard();
    moveCard(database, cardId, { destination: "planning" });
    finishPlanning(database, cardId);

    saveSuggestedChangeType(database, cardId, "fix");
    expect(database.query<Readonly<{ change_type: string | null }>, [string]>(
      "SELECT change_type FROM cards WHERE id = ?",
    ).get(cardId)?.change_type).toBe("fix");

    updateCard(database, cardId, { changeType: "feat" });
    saveSuggestedChangeType(database, cardId, "fix");
    expect(database.query<Readonly<{ change_type: string | null }>, [string]>(
      "SELECT change_type FROM cards WHERE id = ?",
    ).get(cardId)?.change_type).toBe("feat");
  });

  test("can be selected in Backlog or Planning", () => {
    const { database, cardId } = databaseWithCard();

    updateCard(database, cardId, { changeType: "feat" });
    expect(database.query<Readonly<{ change_type: string | null }>, [string]>(
      "SELECT change_type FROM cards WHERE id = ?",
    ).get(cardId)?.change_type).toBe("feat");

    moveCard(database, cardId, { destination: "planning" });
    finishPlanning(database, cardId);
    updateCard(database, cardId, { changeType: "fix" });
    expect(database.query<Readonly<{ change_type: string | null }>, [string]>(
      "SELECT change_type FROM cards WHERE id = ?",
    ).get(cardId)?.change_type).toBe("fix");
  });

  test("is required before Building", () => {
    const { database, cardId } = databaseWithCard();
    moveCard(database, cardId, { destination: "planning" });
    finishPlanning(database, cardId);

    expect(() => moveCard(database, cardId, { destination: "building" })).toThrow(
      "Select a change type before Building.",
    );
  });
});
