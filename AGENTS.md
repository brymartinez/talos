<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Default skills for card runs

The two sections below are passed to the agent provider as startup context by
`src/agents/prompts.ts`. `agent-defaults-all` goes into every stage.
`agent-defaults-planning` goes into Planning only. This applies regardless of
which repository the card targets. Edit the text inside the markers to change
what a run is told to do. The app reads it fresh for each run, so no restart is
needed. Keep the sections to the directives themselves because every token is
spent on every run. Put each required skill on its own `/skill-name` line. The
runner loads those skills before it sends the task.

<!-- BEGIN:agent-defaults-all -->
/pstack:unslop

Read and follow `~/.agents/skills/AGENTS.md` by default, to minimize token use.
<!-- END:agent-defaults-all -->

<!-- BEGIN:agent-defaults-planning -->
/superpowers:brainstorming
/mattpocock-skills:grill-with-docs
<!-- END:agent-defaults-planning -->
