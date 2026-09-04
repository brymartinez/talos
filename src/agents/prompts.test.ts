import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadAgentContext } from "@/src/agents/prompts";

const originalWorkingDirectory = process.cwd();
const temporaryDirectories: string[] = [];

function context(path?: string) {
  return loadAgentContext({ stage: "planning", path });
}

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "eng-work-board-prompts-"));
  temporaryDirectories.push(directory);
  return directory;
}

function temporaryFile(content?: string): string {
  const directory = temporaryDirectory();
  const path = join(directory, "AGENTS.md");
  if (content !== undefined) writeFileSync(path, content);
  return path;
}

afterEach(() => {
  process.chdir(originalWorkingDirectory);
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("stagePrompt agent instructions", () => {
  test("reads eng-work-board AGENTS.md outside the app working directory", () => {
    process.chdir(mkdtempSync(join(tmpdir(), "eng-work-board-cwd-")));
    temporaryDirectories.push(process.cwd());

    expect(context()).toEqual(expect.objectContaining({
      skills: ["pstack:unslop", "superpowers:brainstorming", "mattpocock-skills:grill-with-docs"],
    }));
  });

  test("throws when eng-work-board AGENTS.md cannot be read", () => {
    const missingPath = temporaryFile();

    expect(() => context(missingPath)).toThrow(`failed to read ${missingPath}`);
  });

  test("throws when a required shared section is missing", () => {
    const path = temporaryFile(`<!-- BEGIN:agent-defaults-planning -->
Planning defaults
<!-- END:agent-defaults-planning -->`);

    expect(() => context(path)).toThrow("agent-defaults-all");
  });

  test("includes shared and planning instructions", () => {
    const path = temporaryFile(`<!-- BEGIN:agent-defaults-all -->
/shared-skill
Shared instructions
<!-- END:agent-defaults-all -->
<!-- BEGIN:agent-defaults-planning -->
/planning-skill
Planning instructions
<!-- END:agent-defaults-planning -->`);

    expect(context(path)).toEqual({
      additionalContext: "Shared instructions\n\nPlanning instructions",
      skills: ["shared-skill", "planning-skill"],
    });
  });
});
