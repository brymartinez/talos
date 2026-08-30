import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Stage } from "@/src/domain/types";

function extractSection(content: string, name: string): string {
  const startMarker = `<!-- BEGIN:${name} -->`;
  const endMarker = `<!-- END:${name} -->`;
  const start = content.indexOf(startMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) return "";
  return content.slice(start + startMarker.length, end).trim();
}

// Read fresh each call (not cached) so editing AGENTS.md takes effect on the next
// run without restarting the worker. eng-work-board's own AGENTS.md is never the
// agent's cwd for a card (that's always the target repo's worktree), so this is
// the only way its guidance reaches a run.
function agentDefaults(stage: Exclude<Stage, "backlog" | "done">): string {
  try {
    const content = readFileSync(resolve(process.cwd(), "AGENTS.md"), "utf-8");
    const sections = [extractSection(content, "agent-defaults-all")];
    if (stage === "planning") sections.push(extractSection(content, "agent-defaults-planning"));
    return sections.filter(Boolean).join("\n\n");
  } catch {
    return "";
  }
}

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
  const defaults = agentDefaults(input.stage);
  return `${task}
${defaults ? `\n${defaults}\n` : ""}
Title: ${input.title}
Description: ${input.body || "No description"}
Senior engineer notes: ${input.notes || "No notes"}
Prior result: ${input.priorResult ?? "None"}

End with exactly one line beginning ENGINEERING_WORK_BOARD_RESULT: followed by JSON matching this exact shape (all fields required, use "" or [] when a section does not apply):
{"summary": string, "blockers": string[], "questions": string[], "plan": {"file": string, "change": string}[], "changedFiles": string[], "checks": {"command": string, "result": string}[], "findings": string[], "verdict": string, "prTitle": string, "prDescription": string}
Every findings entry must be a single plain string (e.g. "src/foo.ts:42 missing null check"), not an object. Keep the PR description short.`;
}
