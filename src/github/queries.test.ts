import { describe, expect, test } from "bun:test";

import { buildSourceQueries } from "@/src/github/queries";

describe("GitHub source queries", () => {
  test("queries open issues authored by the current user", () => {
    const queries = buildSourceQueries({
      username: "brymartinez",
      organizations: [],
      repositories: ["brymartinez/nest-starter"],
      teams: [],
      mentionLookbackDays: 90,
    });

    expect(queries.map((query) => query.query)).toContain(
      "is:issue is:open author:brymartinez repo:brymartinez/nest-starter",
    );
  });

  test("queries every configured organization and uncovered repository", () => {
    const queries = buildSourceQueries({
      username: "bryan",
      organizations: ["acme", "other-org"],
      repositories: ["acme/nest-starter", "outside/tool"],
      teams: [],
      mentionLookbackDays: 90,
    });

    const assignedIssueQueries = queries
      .filter((query) => query.reason === "assigned" && query.query.includes("is:issue"))
      .map((query) => query.query);

    expect(assignedIssueQueries).toEqual([
      "is:issue is:open assignee:bryan org:acme",
      "is:issue is:open assignee:bryan org:other-org",
      "is:issue is:open assignee:bryan repo:outside/tool",
    ]);
  });

  test("keeps each team attached to its organization scope", () => {
    const queries = buildSourceQueries({
      username: "bryan",
      organizations: ["acme"],
      repositories: ["outside/tool"],
      teams: [
        { organization: "acme", slug: "platform" },
        { organization: "outside", slug: "platform" },
      ],
      mentionLookbackDays: 90,
    });

    expect(queries
      .filter((query) => query.reason === "team_review_requested")
      .map((query) => query.query))
      .toEqual([
        "is:pr is:open team-review-requested:acme/platform org:acme",
        "is:pr is:open team-review-requested:outside/platform repo:outside/tool",
      ]);
  });
});
