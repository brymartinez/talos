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

// "outcome" is the one field the app trusts to decide what happens to this run — it
// does not re-derive status from "questions" length or parse "verdict" text. Get it
// wrong and the card lands in the wrong column state.
const RESULT_FORMAT = `End with exactly one line beginning ENGINEERING_WORK_BOARD_RESULT: followed by JSON matching this exact shape (all fields required, use "" or [] when a section does not apply):
{"outcome": "succeeded" | "needs_input" | "changes_requested", "summary": string, "blockers": string[], "questions": string[], "plan": {"file": string, "change": string}[], "changedFiles": string[], "checks": {"command": string, "result": string}[], "findings": string[], "verdict": string, "prTitle": string, "prDescription": string}
Set "outcome" to exactly one of:
- "needs_input" — "questions" is non-empty and you need an answer before you can continue.
- "changes_requested" — this is a review and the changes are not ready to ship yet.
- "succeeded" — everything else, including a review that is ready to ship.
Every findings entry must be a single plain string (e.g. "src/foo.ts:42 missing null check"), not an object. Keep the PR description short.`;

export function stagePrompt(input: Readonly<{
  stage: Exclude<Stage, "backlog" | "done">;
  title: string;
  body: string;
  notes: string;
  priorResult?: string;
  itemType: "issue" | "pull_request";
  githubNumber: number;
}>): string {
  const task = {
    planning: "Triage the work. Find blockers. Return a file-level plan and checks. Do not edit files.",
    building: "Implement the approved plan. Run useful checks. Do not commit, push, tag, or create a PR.",
    review: "Review the uncommitted changes. Do not edit files. Give concrete findings and a verdict.",
  }[input.stage];
  const defaults = agentDefaults(input.stage);
  const verdictNote = input.stage === "review"
    ? `\nSet "verdict" to a short human-readable summary of your review decision — this is shown to the engineer, not parsed by the app.\n`
    : "";
  const buildingNote = input.stage === "building"
    ? `\nDraft "prTitle" and "prDescription" for the pull request this change would become (you do not create the PR yourself).${
        input.itemType === "issue"
          ? ` This closes issue #${input.githubNumber}, so include the line "Closes #${input.githubNumber}" in "prDescription".`
          : ""
      }\n`
    : "";
  return `${task}
${defaults ? `\n${defaults}\n` : ""}${verdictNote}${buildingNote}
Title: ${input.title}
Description: ${input.body || "No description"}
Senior engineer notes: ${input.notes || "No notes"}
Prior result: ${input.priorResult ?? "None"}

${RESULT_FORMAT}`;
}

// Used when resuming a session that already has real conversation history (e.g. it was
// continued in a terminal outside the app, or a prior run left it needs_input). Sending
// the full stagePrompt task framing again here would read as "start the stage over" —
// this instead asks the session to report where it actually stands right now.
export function resumeCheckInPrompt(input: Readonly<{
  stage: Exclude<Stage, "backlog" | "done">;
  notes: string;
  itemType: "issue" | "pull_request";
  githubNumber: number;
}>): string {
  const defaults = agentDefaults(input.stage);
  const buildingNote = input.stage === "building"
    ? `\nIf the implementation is done, draft "prTitle" and "prDescription" for the pull request this change would become (you do not create the PR yourself).${
        input.itemType === "issue"
          ? ` This closes issue #${input.githubNumber}, so include the line "Closes #${input.githubNumber}" in "prDescription".`
          : ""
      }\n`
    : "";
  return `Check in on this session: report the current status of this ${input.stage} work — do not restart or redo work you already completed.
${defaults ? `\n${defaults}\n` : ""}${buildingNote}
Senior engineer notes since you last reported: ${input.notes || "None"}

If the work is genuinely complete, or a question you previously asked has since been resolved (e.g. answered directly in this conversation), report that. Only include a question in "questions" if it is still genuinely unresolved right now.

${RESULT_FORMAT}`;
}
