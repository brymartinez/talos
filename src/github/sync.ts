import { z } from "zod";

import type { AppConfig } from "@/src/config/env";
import {
  beginRefresh,
  completeRefresh,
  listTrackedOpenSources,
  reconcileSourceItems,
  recordRefreshError,
  type ReconciledRepository,
  type ReconciledSourceItem,
} from "@/src/db/repositories";
import type { MatchReason } from "@/src/domain/types";
import { GitHubClient, GitHubError } from "@/src/github/client";
import { buildSourceQueries } from "@/src/github/queries";
import type { Database } from "bun:sqlite";

const userSchema = z.object({ login: z.string() });
const repositorySchema = z.object({
  id: z.number(),
  name: z.string(),
  full_name: z.string(),
  owner: z.object({ login: z.string() }),
  clone_url: z.string(),
  ssh_url: z.string(),
  default_branch: z.string(),
  archived: z.boolean().optional().default(false),
});
const teamSchema = z.object({
  slug: z.string(),
  organization: z.object({ login: z.string() }),
});
const searchItemSchema = z.object({
  id: z.number(),
  number: z.number(),
  title: z.string(),
  body: z.string().nullable(),
  html_url: z.string(),
  state: z.enum(["open", "closed"]),
  user: z.object({ login: z.string() }),
  assignees: z.array(z.object({ login: z.string() })).optional().default([]),
  labels: z
    .array(z.union([z.string(), z.object({ name: z.string().nullable() })]))
    .optional()
    .default([]),
  pull_request: z.object({ url: z.string() }).optional(),
  repository_url: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  closed_at: z.string().nullable(),
});
const searchResponseSchema = z.object({
  total_count: z.number(),
  incomplete_results: z.boolean(),
  items: z.array(searchItemSchema),
});
const pullRequestSchema = z.object({
  merged: z.boolean(),
  head: z.object({ ref: z.string(), repo: z.object({ full_name: z.string() }).nullable() }),
  base: z.object({ ref: z.string() }),
  requested_teams: z.array(z.object({ slug: z.string() })).optional().default([]),
});
const itemStateSchema = z.object({
  state: z.enum(["open", "closed"]),
  closed_at: z.string().nullable(),
});

type SearchItem = z.infer<typeof searchItemSchema>;
type RepositoryResponse = z.infer<typeof repositorySchema>;

export type RefreshSummary = Readonly<{
  refreshId: string;
  status: "completed" | "partial" | "failed";
  repositoryCount: number;
  sourceItemCount: number;
  errorCount: number;
}>;

type SourceAccumulator = Readonly<{
  item: SearchItem;
  reasons: Set<MatchReason>;
}>;

function repositoryNameFromUrl(url: string): string {
  const match = /\/repos\/([^/]+\/[^/]+)$/.exec(url);
  if (!match?.[1]) {
    throw new Error(`Cannot read repository name from ${url}`);
  }
  return match[1].toLowerCase();
}

function normalizedLabels(item: SearchItem): readonly string[] {
  return item.labels.flatMap((label) => {
    if (typeof label === "string") {
      return [label];
    }
    return label.name ? [label.name] : [];
  });
}

function refreshError(error: unknown, fallbackScope: string): Readonly<{
  scope: string;
  code: string;
  message: string;
}> {
  if (error instanceof GitHubError) {
    return { scope: error.scope, code: error.code, message: error.message };
  }
  return {
    scope: fallbackScope,
    code: "unexpected_error",
    message: error instanceof Error ? error.message : "Unexpected GitHub error",
  };
}

async function searchIssues(client: GitHubClient, query: string): Promise<readonly SearchItem[]> {
  const items: SearchItem[] = [];
  let page = 1;
  while (true) {
    const path = `/search/issues?q=${encodeURIComponent(query)}&per_page=100&page=${page}`;
    const response = await client.rest({ path, schema: searchResponseSchema, scope: query });
    items.push(...response.items);
    if (response.items.length < 100) {
      return items;
    }
    page += 1;
  }
}

async function readRepositories(
  client: GitHubClient,
  config: AppConfig,
): Promise<readonly RepositoryResponse[]> {
  const organizationRepositories = await client.restPages({
    path: `/orgs/${encodeURIComponent(config.githubOrganization)}/repos?type=all`,
    itemSchema: repositorySchema,
    scope: `organization:${config.githubOrganization}`,
  });
  const byName = new Map(
    organizationRepositories
      .filter((repository) => !repository.archived)
      .map((repository) => [repository.full_name.toLowerCase(), repository]),
  );
  for (const repositoryName of config.extraRepositories) {
    if (!byName.has(repositoryName)) {
      const repository = await client.rest({
        path: `/repos/${repositoryName}`,
        schema: repositorySchema,
        scope: `repository:${repositoryName}`,
      });
      if (!repository.archived) {
        byName.set(repository.full_name.toLowerCase(), repository);
      }
    }
  }
  for (const excluded of config.excludedRepositories) {
    byName.delete(excluded);
  }
  return [...byName.values()];
}

async function readTeams(client: GitHubClient, config: AppConfig): Promise<readonly string[]> {
  const teams = await client.restPages({
    path: "/user/teams",
    itemSchema: teamSchema,
    scope: "teams",
  });
  const allowlist = new Set(config.teamAllowlist.map((team) => team.toLowerCase()));
  return teams
    .filter((team) => team.organization.login.toLowerCase() === config.githubOrganization.toLowerCase())
    .map((team) => team.slug)
    .filter((team) => allowlist.size === 0 || allowlist.has(team.toLowerCase()));
}

export async function syncGitHub(input: Readonly<{
  database: Database;
  config: AppConfig;
}>): Promise<RefreshSummary> {
  const refreshId = beginRefresh(input.database);
  const client = new GitHubClient({ token: input.config.githubToken });
  const errors: Readonly<{ scope: string; code: string; message: string }>[] = [];

  try {
    const user = await client.rest({ path: "/user", schema: userSchema, scope: "authenticated-user" });
    const repositories = await readRepositories(client, input.config);
    const allowedNames = new Set(repositories.map((repository) => repository.full_name.toLowerCase()));
    const teams = await readTeams(client, input.config);
    const queries = buildSourceQueries({
      username: user.login,
      organization: input.config.githubOrganization,
      extraRepositories: input.config.extraRepositories,
      teams,
      mentionLookbackDays: input.config.mentionLookbackDays,
    });

    const sources = new Map<string, SourceAccumulator>();
    for (const sourceQuery of queries) {
      try {
        for (const item of await searchIssues(client, sourceQuery.query)) {
          const repositoryName = repositoryNameFromUrl(item.repository_url);
          if (!allowedNames.has(repositoryName)) {
            continue;
          }
          const key = `${repositoryName}#${item.number}`;
          const existing = sources.get(key);
          if (existing) {
            existing.reasons.add(sourceQuery.reason);
          } else {
            sources.set(key, { item, reasons: new Set([sourceQuery.reason]) });
          }
        }
      } catch (error) {
        errors.push(refreshError(error, sourceQuery.scope));
      }
    }

    const reconciledSources: ReconciledSourceItem[] = [];
    for (const [key, source] of sources) {
      const repositoryName = repositoryNameFromUrl(source.item.repository_url);
      let pullRequest: z.infer<typeof pullRequestSchema> | null = null;
      if (source.item.pull_request) {
        try {
          pullRequest = await client.rest({
            path: `/repos/${repositoryName}/pulls/${source.item.number}`,
            schema: pullRequestSchema,
            scope: key,
          });
        } catch (error) {
          errors.push(refreshError(error, key));
          continue;
        }
      }
      reconciledSources.push({
        id: String(source.item.id),
        repositoryName,
        githubNumber: source.item.number,
        itemType: source.item.pull_request ? "pull_request" : "issue",
        title: source.item.title,
        body: source.item.body ?? "",
        htmlUrl: source.item.html_url,
        state: source.item.state,
        merged: pullRequest?.merged ?? false,
        authorLogin: source.item.user.login,
        assignees: source.item.assignees.map((assignee) => assignee.login),
        requestedTeams: pullRequest?.requested_teams.map((team) => team.slug) ?? [],
        labels: normalizedLabels(source.item),
        headRef: pullRequest?.head.ref ?? null,
        headRepository: pullRequest?.head.repo?.full_name ?? null,
        baseRef: pullRequest?.base.ref ?? null,
        githubCreatedAt: source.item.created_at,
        githubUpdatedAt: source.item.updated_at,
        githubClosedAt: source.item.closed_at,
        matchReasons: [...source.reasons],
      });
    }

    const trackedOpen = listTrackedOpenSources(input.database, [...allowedNames]);
    const currentKeys = new Set(
      reconciledSources.map((source) => `${source.repositoryName.toLowerCase()}#${source.githubNumber}`),
    );
    for (const tracked of trackedOpen) {
      const key = `${tracked.repositoryName.toLowerCase()}#${tracked.githubNumber}`;
      if (currentKeys.has(key)) {
        continue;
      }
      try {
        if (tracked.itemType === "pull_request") {
          const pullRequest = await client.rest({
            path: `/repos/${tracked.repositoryName}/pulls/${tracked.githubNumber}`,
            schema: pullRequestSchema.extend({ state: z.enum(["open", "closed"]), closed_at: z.string().nullable() }),
            scope: key,
          });
          tracked.state = pullRequest.state;
          tracked.merged = pullRequest.merged;
          tracked.closedAt = pullRequest.closed_at;
        } else {
          const issue = await client.rest({
            path: `/repos/${tracked.repositoryName}/issues/${tracked.githubNumber}`,
            schema: itemStateSchema,
            scope: key,
          });
          tracked.state = issue.state;
          tracked.closedAt = issue.closed_at;
        }
      } catch (error) {
        errors.push(refreshError(error, key));
      }
    }

    const reconciledRepositories: ReconciledRepository[] = repositories.map((repository) => ({
      id: String(repository.id),
      owner: repository.owner.login,
      name: repository.name,
      fullName: repository.full_name,
      cloneUrl: repository.clone_url,
      sshUrl: repository.ssh_url,
      defaultBranch: repository.default_branch,
    }));

    reconcileSourceItems(input.database, {
      repositories: reconciledRepositories,
      sourceItems: reconciledSources,
      trackedMissing: trackedOpen,
      workAgent: input.config.workAgent,
      allowStaleReconciliation: errors.length === 0,
    });
    for (const error of errors) {
      recordRefreshError(input.database, refreshId, error);
    }
    const status = errors.length > 0 ? "partial" : "completed";
    completeRefresh(input.database, {
      refreshId,
      status,
      repositoryCount: repositories.length,
      sourceItemCount: reconciledSources.length,
    });
    return {
      refreshId,
      status,
      repositoryCount: repositories.length,
      sourceItemCount: reconciledSources.length,
      errorCount: errors.length,
    };
  } catch (error) {
    const normalized = refreshError(error, "refresh");
    recordRefreshError(input.database, refreshId, normalized);
    completeRefresh(input.database, {
      refreshId,
      status: "failed",
      repositoryCount: 0,
      sourceItemCount: 0,
    });
    return {
      refreshId,
      status: "failed",
      repositoryCount: 0,
      sourceItemCount: 0,
      errorCount: 1,
    };
  }
}
