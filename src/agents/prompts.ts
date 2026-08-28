import type { Stage } from "@/src/domain/types";

export function stagePrompt(input: Readonly<{
  stage: Exclude<Stage, "backlog" | "done">;
  title: string;
  body: string;
  notes: string;
  priorResult?: string;
}>): string {
  const task = {
    planning: "Triage the work. Find blockers. Return a file-level plan and checks. Do not edit files.",
    building: "Implement the approved plan. Run useful checks. Do not commit, push, tag, or create a PR.",
    review: "Review the uncommitted changes. Do not edit files. Give concrete findings and a verdict.",
  }[input.stage];
  return `${task}

Title: ${input.title}
Description: ${input.body || "No description"}
Senior engineer notes: ${input.notes || "No notes"}
Prior result: ${input.priorResult ?? "None"}

End with exactly one line beginning ENGINEERING_WORK_BOARD_RESULT: followed by JSON with these keys: summary, blockers, questions, plan, changedFiles, checks, findings, verdict, prTitle, prDescription. Use empty arrays when a section does not apply. Keep the PR description short.`;
}
