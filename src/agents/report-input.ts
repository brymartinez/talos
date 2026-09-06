import { z } from "zod";
import { agentResultSchema } from "./types";

export const sessionOutcomeSchema = z.enum(["ready", "needs_input", "blocked", "changes_requested"]);
export const reportDetailsSchema = agentResultSchema.omit({ outcome: true, summary: true }).partial().strict();
export const sessionReportInputSchema = z.object({
  outcome: sessionOutcomeSchema,
  summary: z.string().trim().min(1).max(4_000),
  details: reportDetailsSchema.default({}),
}).strict();
export const reportFileSchema = z.object({
  id: z.string().uuid(),
  runId: z.string().uuid(),
  token: z.string().uuid(),
  createdAt: z.iso.datetime(),
  report: sessionReportInputSchema,
}).strict();

export function reportResult(input: z.infer<typeof sessionReportInputSchema>) {
  return agentResultSchema.parse({
    ...input.details,
    outcome: input.outcome === "ready" ? "succeeded" : input.outcome,
    summary: input.summary,
  });
}
