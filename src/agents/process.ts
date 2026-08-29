import { createWriteStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { AgentEvent } from "@/src/agents/types";

const activeProcesses = new Map<string, ChildProcessWithoutNullStreams>();

function terminateProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

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
  const waitForLogDrain = async (): Promise<void> => {
    await new Promise<void>((resolvePromise, reject) => {
      const cleanup = (): void => {
        log.off("drain", onDrain);
        log.off("error", onError);
      };
      const onDrain = (): void => {
        cleanup();
        resolvePromise();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      log.once("drain", onDrain);
      log.once("error", onError);
    });
  };
  const read = async (stream: NodeJS.ReadableStream, source: "stdout" | "stderr"): Promise<void> => {
    try {
      for await (const line of createInterface({ input: stream })) {
        if (!log.write(`[${source}] ${line}\n`)) {
          await waitForLogDrain();
        }
        if (source === "stderr") {
          push({ kind: "progress", message: line });
        } else {
          push(input.parseLine(line) ?? { kind: "text", text: line });
        }
      }
    } catch (error) {
      failure.value = error instanceof Error ? error : new Error("Agent output failed");
      terminateProcessTree(child);
    } finally {
      openReaders -= 1;
      notify();
    }
  };
  log.on("error", (error) => {
    failure.value = error;
    terminateProcessTree(child);
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
    yield { kind: "completed", exitCode: failure.value ? 1 : processExit ?? 1 };
  } finally {
    activeProcesses.delete(input.runId);
    await new Promise<void>((resolvePromise) => log.end(resolvePromise));
  }
}

export async function cancelAgentProcess(runId: string): Promise<void> {
  const child = activeProcesses.get(runId);
  if (!child?.pid) return;
  try {
    terminateProcessTree(child);
  } finally {
    activeProcesses.delete(runId);
  }
}
