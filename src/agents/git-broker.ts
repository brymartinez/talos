import { createServer } from "node:http";

import { runGit } from "@/src/git/run-git";

const allowedCommands = new Set([
  "blame",
  "cat-file",
  "check-ignore",
  "describe",
  "diff",
  "diff-index",
  "diff-tree",
  "for-each-ref",
  "log",
  "ls-files",
  "ls-tree",
  "merge-base",
  "name-rev",
  "rev-parse",
  "shortlog",
  "show",
  "status",
]);

const blockedArguments = new Set([
  "--ext-diff",
  "--textconv",
  "--open-files-in-pager",
  "--filters",
]);

function validateArguments(args: readonly string[]): string | null {
  if (args.length === 0 || !allowedCommands.has(args[0] ?? "")) {
    return "Engineering Work Board only allows read-only Git inspection";
  }
  if (args.length > 128 || args.some((argument) => argument.length > 4_096)) {
    return "Git request is too large";
  }
  if (args.some((argument) => blockedArguments.has(argument) || argument.startsWith("--output="))) {
    return "Engineering Work Board blocked an unsafe Git option";
  }
  return null;
}

function hardenedArguments(args: readonly string[]): readonly string[] {
  const command = args[0] ?? "";
  if (["diff", "diff-index", "diff-tree", "log", "show"].includes(command)) {
    return [command, "--no-ext-diff", "--no-textconv", ...args.slice(1)];
  }
  return args;
}

export async function startGitBroker(input: Readonly<{
  cwd: string;
}>): Promise<Readonly<{ endpoint: string; token: string; close: () => Promise<void> }>> {
  const token = crypto.randomUUID();
  const server = createServer((request, response) => {
    if (request.method !== "POST" || request.headers.authorization !== `Bearer ${token}`) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    request.setEncoding("utf8");
    let requestBody = "";
    request.on("data", (chunk: string) => {
      requestBody += chunk;
      if (requestBody.length > 64 * 1024) request.destroy();
    });
    request.on("end", () => {
      void (async () => {
        const body = requestBody.endsWith("\n") ? requestBody.slice(0, -1) : requestBody;
        const args = body.length > 0 ? body.split("\n") : [];
        const validationError = validateArguments(args);
        if (validationError) {
          response.writeHead(200, { "Content-Type": "text/plain" }).end(`77\n${validationError}\n`);
          return;
        }
        const result = await runGit({
          args: hardenedArguments(args),
          cwd: input.cwd,
          allowFailure: true,
          preserveWhitespace: true,
          environment: {
            NODE_ENV: process.env.NODE_ENV,
            PATH: process.env.PATH,
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_OPTIONAL_LOCKS: "0",
            GIT_PAGER: "cat",
            GIT_TERMINAL_PROMPT: "0",
          },
        });
        const output = result.exitCode === 0 ? result.stdout : result.stderr || result.stdout;
        response.writeHead(200, { "Content-Type": "text/plain" }).end(`${result.exitCode}\n${output}`);
      })().catch((error: unknown) => {
        response.writeHead(500, { "Content-Type": "text/plain" }).end(
          `1\n${error instanceof Error ? error.message : "Git inspection failed"}\n`,
        );
      });
    });
  });
  await new Promise<void>((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Git broker did not bind a local TCP port");
  return {
    endpoint: `http://127.0.0.1:${address.port}/git`,
    token,
    close: async () => {
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => error ? reject(error) : resolvePromise());
      });
    },
  };
}
