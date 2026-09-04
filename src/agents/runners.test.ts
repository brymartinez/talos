import { beforeEach, describe, expect, mock, test } from "bun:test";

import { runIdSchema } from "@/src/domain/types";

const processCalls: Array<Readonly<{ args: readonly string[]; prompt: string }>> = [];

mock.module("@/src/agents/process", () => ({
  cancelAgentProcess: async () => {},
  streamAgentProcess(input: Readonly<{ args: readonly string[]; prompt: string }>) {
    processCalls.push(input);
    return (async function* () {
      yield { kind: "session", sessionId: "provider-session" } as const;
      yield { kind: "completed", exitCode: 0 } as const;
    })();
  },
}));

mock.module("@/src/agents/policy", () => ({
  prepareAgentPolicy: async () => ({
    sandboxExecutable: "/usr/bin/sandbox-exec",
    sandboxProfile: "/tmp/eng-work-board-test.sb",
    environment: {},
  }),
}));

const [{ ClaudeRunner }, { CodexRunner }] = await Promise.all([
  import("@/src/agents/claude"),
  import("@/src/agents/codex"),
]);

const input = {
  runId: runIdSchema.parse(crypto.randomUUID()),
  stage: "planning",
  cwd: process.cwd(),
  prompt: "Task",
  additionalContext: "Board instructions",
  skills: ["pstack:unslop", "superpowers:brainstorming"],
  logPath: "/tmp/eng-work-board-test.log",
  guardDirectory: "/tmp/eng-work-board-test",
} as const;

async function run(events: AsyncIterable<unknown>): Promise<void> {
  for await (const event of events) {
    void event;
  }
}

beforeEach(() => {
  processCalls.length = 0;
});

describe("runner startup context", () => {
  test("Claude appends board instructions on start and resume", async () => {
    await run(new ClaudeRunner().start(input));

    expect(processCalls.map((call) => call.prompt)).toEqual([
      "/pstack:unslop",
      "/superpowers:brainstorming\n\nBoard instructions\n\nTask",
    ]);
    for (const call of processCalls) {
      const flag = call.args.indexOf("--append-system-prompt");
      expect(flag).toBeGreaterThan(-1);
      expect(call.args[flag + 1]).toBe(input.additionalContext);
    }

    processCalls.length = 0;
    await run(new ClaudeRunner().resume({ ...input, sessionId: "claude-session" }));
    expect(processCalls.map((call) => call.prompt)).toEqual([
      "/pstack:unslop",
      "/superpowers:brainstorming\n\nBoard instructions\n\nTask",
    ]);
    expect(processCalls.every((call) => call.args.includes("--resume"))).toBe(true);
  });

  test("Codex adds board instructions on start and resume", async () => {
    for (const events of [
      new CodexRunner().start(input),
      new CodexRunner().resume({ ...input, sessionId: "codex-session" }),
    ]) {
      processCalls.length = 0;
      await run(events);
      const call = processCalls.at(-1);
      if (!call) throw new Error("Runner did not start a process");
      const flag = call.args.indexOf("-c");
      expect(flag).toBeGreaterThan(-1);
      expect(call.args[flag + 1]).toBe('developer_instructions="Board instructions"');
      expect(call.prompt).toBe("$pstack:unslop\n$superpowers:brainstorming\n\nBoard instructions\n\nTask");
    }
  });
});
