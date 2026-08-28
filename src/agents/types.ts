import { z } from "zod";

import type { AgentProvider, RunId, Stage } from "@/src/domain/types";

export const agentResultSchema = z.object({
  summary: z.string(),
  blockers: z.array(z.string()).default([]),
  questions: z.array(z.string()).default([]),
  plan: z.array(z.object({ file: z.string(), change: z.string() })).default([]),
  changedFiles: z.array(z.string()).default([]),
  checks: z.array(z.object({ command: z.string(), result: z.string() })).default([]),
  findings: z.array(z.string()).default([]),
  verdict: z.string().optional(),
  prTitle: z.string().optional(),
  prDescription: z.string().optional(),
});
export type AgentResult = z.infer<typeof agentResultSchema>;

export type AgentEvent =
  | Readonly<{ kind: "text"; text: string }>
  | Readonly<{ kind: "command"; command: string }>
  | Readonly<{ kind: "progress"; message: string }>
  | Readonly<{ kind: "session"; sessionId: string }>
  | Readonly<{ kind: "result"; result: AgentResult }>
  | Readonly<{ kind: "error"; message: string }>
  | Readonly<{ kind: "completed"; exitCode: number }>;

export type StartRunInput = Readonly<{
  runId: RunId;
  stage: Exclude<Stage, "backlog" | "done">;
  cwd: string;
  prompt: string;
  logPath: string;
  guardDirectory: string;
}>;

export type ResumeRunInput = StartRunInput & Readonly<{ sessionId: string }>;

export interface AgentRunner {
  readonly provider: AgentProvider;
  start(input: StartRunInput): AsyncIterable<AgentEvent>;
  resume(input: ResumeRunInput): AsyncIterable<AgentEvent>;
  cancel(runId: string): Promise<void>;
}
