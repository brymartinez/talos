export type GitResult = Readonly<{
  stdout: string;
  stderr: string;
  exitCode: number;
}>;

export async function runGit(input: Readonly<{
  args: readonly string[];
  cwd?: string;
  signal?: AbortSignal;
  allowFailure?: boolean;
  preserveWhitespace?: boolean;
}>): Promise<GitResult> {
  const gitExecutable = Bun.which("git");
  if (!gitExecutable) {
    throw new Error("git is not installed or is not available on PATH");
  }
  const process = Bun.spawn([gitExecutable, ...input.args], {
    cwd: input.cwd,
    stdout: "pipe",
    stderr: "pipe",
    signal: input.signal,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  const result = {
    stdout: input.preserveWhitespace ? stdout : stdout.trim(),
    stderr: stderr.trim(),
    exitCode,
  };
  if (exitCode !== 0 && !input.allowFailure) {
    throw new Error(`git ${input.args[0] ?? "command"} failed: ${result.stderr || result.stdout}`);
  }
  return result;
}
