import type { AgentResult } from "@/src/agents/types";
import type { ChangeType } from "@/src/domain/types";

export type Stage = "backlog" | "planning" | "building" | "review" | "done";
export type Run = Readonly<{
  id: string; stage: Stage; provider: "codex" | "claude"; status: string;
  summary: string | null; result: AgentResult | null; questions: readonly string[];
  errorMessage: string | null; logUrl: string | null; sessionId: string | null;
  createdAt: string; finishedAt: string | null;
}>;
export type WorkCardData = Readonly<{
  id: string; stage: Stage; position: number; title: string; body: string; url: string;
  itemType: "issue" | "pull_request"; number: number; repository: string;
  labels: readonly string[]; matchReasons: readonly string[]; notes: string;
  notesUpdatedAt: string | null; workAgent: "codex" | "claude";
  changeType: ChangeType | null;
  noLongerAssigned: boolean; runs: readonly Run[]; worktreePath: string | null;
}>;
export type BoardData = Readonly<{
  columns: readonly Stage[];
  cards: readonly WorkCardData[];
  syncPending: boolean;
  refresh: null | Readonly<{
    id: string; status: string; repositoryCount: number; sourceItemCount: number;
    startedAt: string; finishedAt: string | null;
    errors: readonly Readonly<{ scope: string; code: string; message: string }>[];
  }>;
  config: Readonly<{
    organizations: readonly string[];
    repositories: readonly string[];
    workAgent: string;
    concurrency: number;
  }>;
}>;
