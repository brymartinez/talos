<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Default skills for card runs

The two sections below are injected verbatim into every card's agent prompt by
`src/agents/prompts.ts` — `agent-defaults-all` into every stage, `agent-defaults-planning` into
Planning only — regardless of which repository the card targets. Edit the text inside the
markers to change what a run is told to do; it's read fresh each run, no restart needed. Keep
that text to just the directives themselves (no commentary) since every token here is spent on
every run.

<!-- BEGIN:agent-defaults-all -->
Use the pstack:unslop skill by default.

Read and follow `~/.agents/skills/AGENTS.md` by default, to minimize token use.
<!-- END:agent-defaults-all -->

<!-- BEGIN:agent-defaults-planning -->
Use the superpowers:brainstorming and mattpocock-skills:grill-with-docs skills by default.
<!-- END:agent-defaults-planning -->
