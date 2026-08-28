import { z } from "zod";

export const agentProviderSchema = z.enum(["codex", "claude"]);
export type AgentProvider = z.infer<typeof agentProviderSchema>;

export const itemTypeSchema = z.enum(["issue", "pull_request"]);
export type ItemType = z.infer<typeof itemTypeSchema>;

export const matchReasonSchema = z.enum([
  "assigned",
  "authored",
  "review_requested",
  "team_review_requested",
  "mentioned",
]);
export type MatchReason = z.infer<typeof matchReasonSchema>;

export const stageSchema = z.enum([
  "backlog",
  "planning",
  "building",
  "review",
  "done",
]);
export type Stage = z.infer<typeof stageSchema>;

export const jobStateSchema = z.enum([
  "pending",
  "leased",
  "completed",
  "failed",
  "cancelled",
  "interrupted",
]);
export type JobState = z.infer<typeof jobStateSchema>;

export const runStateSchema = z.enum([
  "queued",
  "running",
  "succeeded",
  "failed",
  "needs_input",
  "cancelled",
  "interrupted",
]);
export type RunState = z.infer<typeof runStateSchema>;

export const jobKindSchema = z.enum([
  "sync_github",
  "run_stage",
  "open_vscode",
  "delete_worktree",
]);
export type JobKind = z.infer<typeof jobKindSchema>;

export const cardIdSchema = z.string().uuid().brand<"CardId">();
export type CardId = z.infer<typeof cardIdSchema>;

export const runIdSchema = z.string().uuid().brand<"RunId">();
export type RunId = z.infer<typeof runIdSchema>;

export const jobIdSchema = z.string().uuid().brand<"JobId">();
export type JobId = z.infer<typeof jobIdSchema>;

export const refreshIdSchema = z.string().uuid().brand<"RefreshId">();
export type RefreshId = z.infer<typeof refreshIdSchema>;

export function newCardId(): CardId {
  return cardIdSchema.parse(crypto.randomUUID());
}

export function newRunId(): RunId {
  return runIdSchema.parse(crypto.randomUUID());
}

export function newJobId(): JobId {
  return jobIdSchema.parse(crypto.randomUUID());
}

export function newRefreshId(): RefreshId {
  return refreshIdSchema.parse(crypto.randomUUID());
}

export type Card = Readonly<{
  id: CardId;
  itemType: ItemType;
  matchReasons: readonly MatchReason[];
  stage: Stage;
  position: number;
  notes: string;
  notesUpdatedAt: string | null;
  workAgent: AgentProvider;
  archived: boolean;
  noLongerAssigned: boolean;
  activeRunState: RunState | null;
}>;

export type RunStatus =
  | Readonly<{ kind: "queued" }>
  | Readonly<{ kind: "running"; startedAt: string }>
  | Readonly<{ kind: "succeeded"; finishedAt: string }>
  | Readonly<{ kind: "failed"; finishedAt: string; message: string }>
  | Readonly<{
      kind: "needs_input";
      finishedAt: string;
      questions: readonly string[];
    }>
  | Readonly<{ kind: "cancelled"; finishedAt: string }>
  | Readonly<{ kind: "interrupted"; finishedAt: string }>;
