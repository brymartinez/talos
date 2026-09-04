import { agentResultSchema, type AgentEvent, type AgentRunner, type ResumeRunInput, type StartRunInput } from "@/src/agents/types";
import { cancelAgentProcess, streamAgentProcess } from "@/src/agents/process";
import { prepareAgentPolicy } from "@/src/agents/policy";

export function parseClaudeLine(line: string): AgentEvent | null {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (value.type === "result" && typeof value.result === "string") {
      const marker = "ENGINEERING_WORK_BOARD_RESULT:";
      const index = value.result.lastIndexOf(marker);
      if (index >= 0) {
        const parsed = agentResultSchema.safeParse(JSON.parse(value.result.slice(index + marker.length).trim()));
        if (parsed.success) return { kind: "result", result: parsed.data };
      }
      return { kind: "text", text: value.result };
    }
    if (typeof value.session_id === "string") return { kind: "session", sessionId: value.session_id };
    if (value.type === "assistant") return { kind: "progress", message: "Claude response" };
    return { kind: "progress", message: typeof value.type === "string" ? value.type : "Claude event" };
  } catch {
    return null;
  }
}

export class ClaudeRunner implements AgentRunner {
  readonly provider = "claude" as const;
  start(input: StartRunInput): AsyncIterable<AgentEvent> { return this.#run(input); }
  resume(input: ResumeRunInput): AsyncIterable<AgentEvent> { return this.#run(input, input.sessionId); }
  cancel(runId: string): Promise<void> { return cancelAgentProcess(runId); }
  async *#run(input: StartRunInput, sessionId?: string): AsyncIterable<AgentEvent> {
    let activeSessionId = sessionId;
    for (const skill of input.skills.slice(0, -1)) {
      let exitCode: number | undefined;
      for await (const event of this.#runOnce({ ...input, prompt: `/${skill}` }, activeSessionId)) {
        if (event.kind === "session") {
          activeSessionId = event.sessionId;
          yield event;
        } else if (event.kind === "completed") {
          exitCode = event.exitCode;
        } else if (event.kind === "error") {
          yield event;
        }
      }
      if (exitCode !== 0) throw new Error(`Claude failed to load the ${skill} skill`);
      if (!activeSessionId) throw new Error(`Claude loaded the ${skill} skill without returning a session ID`);
    }
    const finalPrompt = [
      input.skills.at(-1) ? `/${input.skills.at(-1)}` : "",
      input.additionalContext,
      input.prompt,
    ].filter(Boolean).join("\n\n");
    yield* this.#runOnce({ ...input, prompt: finalPrompt }, activeSessionId);
  }
  async *#runOnce(input: StartRunInput, sessionId?: string): AsyncIterable<AgentEvent> {
    const policy = await prepareAgentPolicy({ ...input, provider: this.provider });
    const command = Bun.which("claude");
    if (!command) throw new Error("Claude Code CLI is not installed");
    const permissionMode = input.stage === "building" ? "acceptEdits" : "plan";
    const providerArgs = [
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--append-system-prompt",
      input.additionalContext,
      "--permission-mode",
      permissionMode,
    ];
    if (sessionId) providerArgs.push("--resume", sessionId);
    const args = ["-f", policy.sandboxProfile, command, ...providerArgs];
    yield* streamAgentProcess({
      ...input,
      command: policy.sandboxExecutable,
      args,
      environment: policy.environment,
      parseLine: parseClaudeLine,
    });
  }
}
