import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { AgentEvent } from "@/src/agents/types";

const activeProcesses = new Map<string, ChildProcessWithoutNullStreams>();

export async function* streamAgentProcess(input: Readonly<{
  runId: string;
  command: string;
  args: readonly string[];
  cwd: string;
  environment: NodeJS.ProcessEnv;
  prompt: string;
  logPath: string;
  parseLine: (line: string) => AgentEvent | null;
}>): AsyncIterable<AgentEvent> {
  await mkdir(dirname(input.logPath), { recursive: true });
  const log = createWriteStream(input.logPath, { flags: "a" });
  await new Promise<void>((resolvePromise, reject) => {
    log.once("open", () => resolvePromise());
    log.once("error", reject);
  });

  const child = spawn(input.command, [...input.args], {
    cwd: input.cwd,
    env: input.environment,
    detached: true,
    stdio: "pipe",
  });
  activeProcesses.set(input.runId, child);
  child.stdin.end(input.prompt);

  const queue: AgentEvent[] = [];
  let wake: (() => void) | undefined;
  let openReaders = 2;
  let processExit: number | null = null;
  const failure: { value: Error | null } = { value: null };
  const notify = (): void => {
    wake?.();
    wake = undefined;
  };
  const push = (event: AgentEvent): void => {
    queue.push(event);
    notify();
  };
  const read = async (stream: NodeJS.ReadableStream, source: "stdout" | "stderr"): Promise<void> => {
    try {
      for await (const line of createInterface({ input: stream })) {
        if (!log.write(`[${source}] ${line}\n`)) {
          await new Promise<void>((resolvePromise) => log.once("drain", resolvePromise));
        }
        if (source === "stderr") {
          push({ kind: "progress", message: line });
        } else {
          push(input.parseLine(line) ?? { kind: "text", text: line });
        }
      }
    } catch (error) {
      failure.value = error instanceof Error ? error : new Error("Agent output failed");
      child.kill("SIGTERM");
    } finally {
      openReaders -= 1;
      notify();
    }
  };
  log.on("error", (error) => {
    failure.value = error;
    child.kill("SIGTERM");
    notify();
  });
  void read(child.stdout, "stdout");
  void read(child.stderr, "stderr");
  child.once("error", (error) => {
    failure.value = error;
    processExit = 1;
    notify();
  });
  child.once("exit", (code) => {
    processExit = code ?? 1;
    notify();
  });

  try {
    while (queue.length > 0 || openReaders > 0 || processExit === null) {
      const event = queue.shift();
      if (event) {
        yield event;
        continue;
      }
      await new Promise<void>((resolvePromise) => {
        wake = resolvePromise;
      });
    }
    if (failure.value) yield { kind: "error", message: failure.value.message };
    yield { kind: "completed", exitCode: processExit ?? 1 };
  } finally {
    activeProcesses.delete(input.runId);
    await new Promise<void>((resolvePromise) => log.end(resolvePromise));
  }
}

export async function cancelAgentProcess(runId: string): Promise<void> {
  const process = activeProcesses.get(runId);
  if (!process?.pid) return;
  try {
    process.kill("SIGTERM");
  } finally {
    activeProcesses.delete(runId);
  }
}
