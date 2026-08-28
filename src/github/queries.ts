import type { MatchReason } from "@/src/domain/types";

export type SourceQuery = Readonly<{
  reason: MatchReason;
  query: string;
  scope: string;
}>;

type SourceQueryInput = Readonly<{
  username: string;
  organization: string;
  extraRepositories: readonly string[];
  teams: readonly string[];
  mentionLookbackDays: number;
}>;

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

function scopedQueries(base: string, input: SourceQueryInput): readonly string[] {
  return [
    `${base} org:${input.organization}`,
    ...input.extraRepositories.map((repository) => `${base} repo:${repository}`),
  ];
}

export function buildSourceQueries(input: SourceQueryInput): readonly SourceQuery[] {
  const definitions: readonly Readonly<{ reason: MatchReason; base: string }>[] = [
    { reason: "assigned", base: `is:issue is:open assignee:${input.username}` },
    { reason: "assigned", base: `is:pr is:open assignee:${input.username}` },
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
  for (const definition of definitions) {
    for (const query of scopedQueries(definition.base, input)) {
      results.push({
        reason: definition.reason,
        query,
        scope: query,
      });
    }
  }
  for (const team of input.teams) {
    const base = `is:pr is:open team-review-requested:${input.organization}/${team}`;
    for (const query of scopedQueries(base, input)) {
      results.push({ reason: "team_review_requested", query, scope: query });
    }
  }
  return results;
}
