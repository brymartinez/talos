import { describe, expect, test } from "bun:test";

import { parseEnvironment } from "@/src/config/env";

const baseEnvironment = {
  ENG_GITHUB_TOKEN: "token",
  NODE_ENV: "test",
  WORK_AGENT: "codex",
} satisfies NodeJS.ProcessEnv;

describe("GitHub source configuration", () => {
  test("accepts organizations without explicit repositories", () => {
    const result = parseEnvironment({
      ...baseEnvironment,
      GITHUB_ORGS: "Acme, Other-Org",
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      config: expect.objectContaining({
        githubOrganizations: ["acme", "other-org"],
        githubRepositories: [],
      }),
    }));
  });

  test("accepts explicit repositories without organizations", () => {
    const result = parseEnvironment({
      ...baseEnvironment,
      GITHUB_REPOS: "Acme/nest-starter, Other/tool",
    });

    expect(result).toEqual(expect.objectContaining({
      ok: true,
      config: expect.objectContaining({
        githubOrganizations: [],
        githubRepositories: ["acme/nest-starter", "other/tool"],
      }),
    }));
  });

  test("requires at least one organization or repository", () => {
    const result = parseEnvironment(baseEnvironment);

    expect(result).toEqual({
      ok: false,
      errors: [{
        field: "GITHUB_ORGS/GITHUB_REPOS",
        message: "at least one organization or repository is required",
      }],
    });
  });

  test("requires explicit repositories to include their owner", () => {
    const result = parseEnvironment({
      ...baseEnvironment,
      GITHUB_REPOS: "nest-starter",
    });

    expect(result).toEqual({
      ok: false,
      errors: [{ field: "GITHUB_REPOS", message: "nest-starter must use owner/repository" }],
    });
  });
});
