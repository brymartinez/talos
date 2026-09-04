import type { MatchReason } from "@/src/domain/types";

export type SourceQuery = Readonly<{
  reason: MatchReason;
  query: string;
  scope: string;
}>;

type SourceQueryInput = Readonly<{
  username: string;
  organizations: readonly string[];
  repositories: readonly string[];
  teams: readonly Readonly<{ organization: string; slug: string }>[];
  mentionLookbackDays: number;
}>;

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

type SourceScope = Readonly<{ owner: string; qualifier: string }>;

function sourceScopes(input: SourceQueryInput): readonly SourceScope[] {
  const organizations = new Set(input.organizations);
  return [
    ...input.organizations.map((organization) => ({
      owner: organization,
      qualifier: `org:${organization}`,
    })),
    ...input.repositories
      .filter((repository) => !organizations.has(repository.split("/")[0] ?? ""))
      .map((repository) => ({
        owner: repository.split("/")[0] ?? "",
        qualifier: `repo:${repository}`,
      })),
  ];
}

export function buildSourceQueries(input: SourceQueryInput): readonly SourceQuery[] {
  const definitions: readonly Readonly<{ reason: MatchReason; base: string }>[] = [
    { reason: "assigned", base: `is:issue is:open assignee:${input.username}` },
    { reason: "assigned", base: `is:pr is:open assignee:${input.username}` },
    { reason: "authored", base: `is:issue is:open author:${input.username}` },
    { reason: "authored", base: `is:pr is:open author:${input.username}` },
    {
      reason: "review_requested",
      base: `is:pr is:open review-requested:${input.username}`,
    },
    {
      reason: "mentioned",
      base: `is:open mentions:${input.username} updated:>=${dateDaysAgo(input.mentionLookbackDays)}`,
    },
  ];

  const results: SourceQuery[] = [];
  const scopes = sourceScopes(input);
  for (const definition of definitions) {
    for (const scope of scopes) {
      const query = `${definition.base} ${scope.qualifier}`;
      results.push({
        reason: definition.reason,
        query,
        scope: query,
      });
    }
  }
  for (const team of input.teams) {
    const base = `is:pr is:open team-review-requested:${team.organization}/${team.slug}`;
    for (const scope of scopes.filter((candidate) => candidate.owner === team.organization)) {
      const query = `${base} ${scope.qualifier}`;
      results.push({ reason: "team_review_requested", query, scope: query });
    }
  }
  return results;
}
