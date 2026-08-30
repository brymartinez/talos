import { z } from "zod";

import { deriveAppPaths, expandPath, type AppPaths } from "@/src/config/paths";
import { agentProviderSchema, type AgentProvider } from "@/src/domain/types";

const positiveInteger = z.coerce.number().int().positive();
const repositoryName = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/, "must use owner/repository");

const rawEnvironmentSchema = z.object({
  ENG_GITHUB_TOKEN: z.string().trim().min(1, "is required"),
  GITHUB_ORG: z.string().trim().min(1, "is required"),
  GITHUB_REPOS: z.string().optional().default(""),
  GITHUB_EXCLUDE_REPOS: z.string().optional().default(""),
  GITHUB_TEAM_ALLOWLIST: z.string().optional().default(""),
  GITHUB_MENTION_LOOKBACK_DAYS: positiveInteger.optional().default(90),
  REPO_ROOTS: z.string().optional().default("~/Documents/projects"),
  APP_DATA_DIR: z.string().optional().default("~/.eng-work-board"),
  WORK_AGENT: agentProviderSchema,
  AGENT_CONCURRENCY: positiveInteger.optional().default(1),
  CODE_COMMAND: z.string().trim().min(1).optional().default("code"),
});

export type AppConfig = Readonly<{
  githubToken: string;
  githubOrganization: string;
  extraRepositories: readonly string[];
  excludedRepositories: readonly string[];
  teamAllowlist: readonly string[];
  mentionLookbackDays: number;
  repositoryRoots: readonly string[];
  paths: AppPaths;
  workAgent: AgentProvider;
  agentConcurrency: number;
  codeCommand: string;
}>;

export type ConfigError = Readonly<{
  field: string;
  message: string;
}>;

export type ConfigResult =
  | Readonly<{ ok: true; config: AppConfig }>
  | Readonly<{ ok: false; errors: readonly ConfigError[] }>;

function parseList(value: string): readonly string[] {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseRepositories(
  field: string,
  value: string,
): Readonly<{ values: readonly string[]; errors: readonly ConfigError[] }> {
  const values: string[] = [];
  const errors: ConfigError[] = [];
  for (const entry of parseList(value)) {
    const parsed = repositoryName.safeParse(entry);
    if (parsed.success) {
      values.push(parsed.data.toLowerCase());
    } else {
      errors.push({ field, message: `${entry} must use owner/repository` });
    }
  }
  return { values, errors };
}

function fieldName(path: PropertyKey[]): string {
  return path.length > 0 ? path.join(".") : "environment";
}

export function parseEnvironment(environment: NodeJS.ProcessEnv): ConfigResult {
  const parsed = rawEnvironmentSchema.safeParse(environment);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        field: fieldName(issue.path),
        message: issue.message,
      })),
    };
  }

  const included = parseRepositories("GITHUB_REPOS", parsed.data.GITHUB_REPOS);
  const excluded = parseRepositories(
    "GITHUB_EXCLUDE_REPOS",
    parsed.data.GITHUB_EXCLUDE_REPOS,
  );
  const repositoryErrors = [...included.errors, ...excluded.errors];
  if (repositoryErrors.length > 0) {
    return { ok: false, errors: repositoryErrors };
  }

  return {
    ok: true,
    config: {
      githubToken: parsed.data.ENG_GITHUB_TOKEN,
      githubOrganization: parsed.data.GITHUB_ORG,
      extraRepositories: included.values,
      excludedRepositories: excluded.values,
      teamAllowlist: parseList(parsed.data.GITHUB_TEAM_ALLOWLIST),
      mentionLookbackDays: parsed.data.GITHUB_MENTION_LOOKBACK_DAYS,
      repositoryRoots: parseList(parsed.data.REPO_ROOTS).map(expandPath),
      paths: deriveAppPaths(parsed.data.APP_DATA_DIR),
      workAgent: parsed.data.WORK_AGENT,
      agentConcurrency: parsed.data.AGENT_CONCURRENCY,
      codeCommand: parsed.data.CODE_COMMAND,
    },
  };
}

let cachedConfiguration: ConfigResult | undefined;

export function getConfigResult(): ConfigResult {
  cachedConfiguration ??= parseEnvironment(process.env);
  return cachedConfiguration;
}

export function resetConfigCache(): void {
  cachedConfiguration = undefined;
}
