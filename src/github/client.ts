import { z } from "zod";

const githubErrorSchema = z.object({
  message: z.string(),
  documentation_url: z.string().optional(),
});

const graphQLErrorSchema = z.object({ message: z.string() });

export class GitHubError extends Error {
  readonly code: string;
  readonly status: number;
  readonly scope: string;

  constructor(input: Readonly<{ message: string; code: string; status: number; scope: string }>) {
    super(input.message);
    this.name = "GitHubError";
    this.code = input.code;
    this.status = input.status;
    this.scope = input.scope;
  }
}

type GitHubClientInput = Readonly<{
  token: string;
  apiBaseUrl?: string;
}>;

export class GitHubClient {
  readonly #token: string;
  readonly #apiBaseUrl: string;

  constructor(input: GitHubClientInput) {
    this.#token = input.token;
    this.#apiBaseUrl = input.apiBaseUrl ?? "https://api.github.com";
  }

  async rest<T>(input: Readonly<{ path: string; schema: z.ZodType<T>; scope: string }>): Promise<T> {
    const response = await fetch(`${this.#apiBaseUrl}${input.path}`, {
      headers: this.#headers(),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      throw this.#httpError({ response, body, scope: input.scope });
    }
    return input.schema.parse(body);
  }

  async restPages<T>(input: Readonly<{
    path: string;
    itemSchema: z.ZodType<T>;
    scope: string;
  }>): Promise<readonly T[]> {
    const results: T[] = [];
    let page = 1;
    while (true) {
      const separator = input.path.includes("?") ? "&" : "?";
      const response = await fetch(
        `${this.#apiBaseUrl}${input.path}${separator}per_page=100&page=${page}`,
        { headers: this.#headers() },
      );
      const body: unknown = await response.json();
      if (!response.ok) {
        throw this.#httpError({ response, body, scope: input.scope });
      }
      const pageItems = z.array(input.itemSchema).parse(body);
      results.push(...pageItems);
      if (pageItems.length < 100) {
        return results;
      }
      page += 1;
    }
  }

  async graphql<T>(input: Readonly<{
    query: string;
    variables: Readonly<Record<string, string | number | boolean | null>>;
    schema: z.ZodType<T>;
    scope: string;
  }>): Promise<T> {
    const response = await fetch(`${this.#apiBaseUrl}/graphql`, {
      method: "POST",
      headers: { ...this.#headers(), "Content-Type": "application/json" },
      body: JSON.stringify({ query: input.query, variables: input.variables }),
    });
    const body: unknown = await response.json();
    const envelope = z
      .object({
        data: z.unknown().optional(),
        errors: z.array(graphQLErrorSchema).optional(),
      })
      .parse(body);
    if (!response.ok || envelope.errors?.length) {
      throw new GitHubError({
        message: envelope.errors?.map((error) => error.message).join("; ") ?? response.statusText,
        code: `graphql_${response.status}`,
        status: response.status,
        scope: input.scope,
      });
    }
    return input.schema.parse(envelope.data);
  }

  #headers(): HeadersInit {
    return {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${this.#token}`,
      "X-GitHub-Api-Version": "2026-03-10",
      "User-Agent": "eng-work-board",
    };
  }

  #httpError(input: Readonly<{ response: Response; body: unknown; scope: string }>): GitHubError {
    const parsed = githubErrorSchema.safeParse(input.body);
    const remaining = input.response.headers.get("x-ratelimit-remaining");
    const reset = input.response.headers.get("x-ratelimit-reset");
    const rateLimit = remaining === "0" && reset ? ` Rate limit resets at ${reset}.` : "";
    return new GitHubError({
      message: `${parsed.success ? parsed.data.message : input.response.statusText}.${rateLimit}`,
      code: `http_${input.response.status}`,
      status: input.response.status,
      scope: input.scope,
    });
  }
}
