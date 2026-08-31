import { agentResultSchema, type AgentEvent, type AgentRunner, type ResumeRunInput, type StartRunInput } from "@/src/agents/types";
import { cancelAgentProcess, streamAgentProcess } from "@/src/agents/process";
import { prepareAgentPolicy } from "@/src/agents/policy";

export function parseCodexLine(line: string): AgentEvent | null {
  try {
    const value = JSON.parse(line) as Record<string, unknown>;
    if (value.type === "thread.started" && typeof value.thread_id === "string") return { kind: "session", sessionId: value.thread_id };
    const item = value.item as Record<string, unknown> | undefined;
    if (item?.type === "agent_message" && typeof item.text === "string") return resultOrText(item.text);
    if (item?.type === "command_execution" && typeof item.command === "string") return { kind: "command", command: item.command };
    if (value.type === "error" && typeof value.message === "string") return { kind: "error", message: value.message };
    return { kind: "progress", message: typeof value.type === "string" ? value.type : "Codex event" };
  } catch {
    return null;
  }
}

function resultOrText(text: string): AgentEvent {
  const marker = "ENGINEERING_WORK_BOARD_RESULT:";
  const index = text.lastIndexOf(marker);
  if (index < 0) return { kind: "text", text };
  const parsed = agentResultSchema.safeParse(JSON.parse(text.slice(index + marker.length).trim()));
  return parsed.success ? { kind: "result", result: parsed.data } : { kind: "text", text };
}

export class CodexRunner implements AgentRunner {
  readonly provider = "codex" as const;
  start(input: StartRunInput): AsyncIterable<AgentEvent> { return this.#run(input); }
  resume(input: ResumeRunInput): AsyncIterable<AgentEvent> { return this.#run(input, input.sessionId); }
  cancel(runId: string): Promise<void> { return cancelAgentProcess(runId); }
  async *#run(input: StartRunInput, sessionId?: string): AsyncIterable<AgentEvent> {
    const policy = await prepareAgentPolicy({ ...input, provider: this.provider });
    const command = Bun.which("codex");
    if (!command) throw new Error("Codex CLI is not installed");
    // Codex's own sandbox mode calls sandbox_init() a second time on macOS, nested inside
    // the sandbox-exec profile we already apply below — the OS rejects that with
    // "sandbox_apply: Operation not permitted". This flag is Codex's documented escape
    // hatch for exactly that ("environments that are externally sandboxed"); our own
    // profile already enforces the real restrictions (no git commit, worktree-scoped
    // writes), so Codex's internal sandbox would only be redundant here anyway.
    const providerArgs = sessionId
      ? ["exec", "resume", "--json", "--dangerously-bypass-approvals-and-sandbox", sessionId, "-"]
      : ["exec", "--json", "--dangerously-bypass-approvals-and-sandbox", "-C", input.cwd, "-"];
    const args = ["-f", policy.sandboxProfile, command, ...providerArgs];
    yield* streamAgentProcess({
      ...input,
      command: policy.sandboxExecutable,
      args,
      environment: policy.environment,
      parseLine: parseCodexLine,
    });
  }
}
