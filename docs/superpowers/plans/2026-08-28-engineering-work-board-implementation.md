# Engineering Work Board implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Next.js Kanban board that syncs personal GitHub work and runs Codex or Claude Code when cards move forward.

**Architecture:** Bun starts a Next.js web process and a separate worker. Both use one SQLite database. The web process saves durable jobs, while the worker owns GitHub refreshes, Git worktrees, agent subprocesses, and log files.

**Tech stack:** Bun, Next.js, React, TypeScript, `bun:sqlite`, Zod, dnd-kit, ESLint, GitHub REST and GraphQL APIs, Codex CLI, Claude Code CLI.

**Validation rule:** ADR 0002 prohibits a test suite. Do not add test files, a test runner, test scripts, or test-only dependencies. Validate with lint, type checking, a production build, focused command-line smoke checks, and one manual end-to-end run.

---

## File map

### Project and process entry points

- `package.json`: Dependencies and Bun scripts.
- `tsconfig.json`: Strict TypeScript settings and path aliases.
- `next.config.ts`: Next.js server settings and external Bun modules.
- `eslint.config.mjs`: Next.js and TypeScript lint rules.
- `.env.example`: Documented local configuration.
- `.gitignore`: Local data, environment files, build output, and logs.
- `scripts/dev.ts`: Start Next.js and the worker together for development.
- `scripts/start.ts`: Start the production web server and worker together.

### Core runtime

- `src/config/env.ts`: Parse and validate environment variables once.
- `src/config/paths.ts`: Expand `~` and derive database, clone, worktree, and log paths.
- `src/domain/types.ts`: Shared domain types and state values.
- `src/domain/workflow.ts`: Allowed card transitions and card workflow classification.
- `src/db/client.ts`: Open SQLite with foreign keys and write-ahead logging.
- `src/db/migrate.ts`: Apply numbered schema migrations through `PRAGMA user_version`.
- `src/db/schema.sql`: Initial database schema.
- `src/db/repositories.ts`: Focused data access functions for cards, runs, jobs, refreshes, and repositories.

### External systems

- `src/github/client.ts`: Authenticated REST and GraphQL requests with pagination and rate-limit errors.
- `src/github/queries.ts`: Build source queries for assignments, authorship, reviews, teams, and mentions.
- `src/github/sync.ts`: Normalize, deduplicate, and save one manual refresh.
- `src/git/run-git.ts`: Spawn Git safely with argument arrays and captured output.
- `src/git/repository-locator.ts`: Scan repository roots and match normalized `origin` URLs.
- `src/git/workspace.ts`: Clone missing repositories and create card worktrees.
- `src/git/state.ts`: Capture HEAD, status, and remote reference state.
- `src/agents/types.ts`: Shared runner, event, session, and structured result types.
- `src/agents/process.ts`: Spawn, stream, cancel, and log subprocesses.
- `src/agents/codex.ts`: Start and resume Codex JSONL runs.
- `src/agents/claude.ts`: Start and resume Claude Code streaming JSON runs.
- `src/agents/prompts.ts`: Stage prompts and output schemas.
- `src/agents/policy.ts`: Stage permissions, stripped environment, denied commands, and Git state checks.

### Worker

- `src/worker/main.ts`: Initialize storage, recover interrupted jobs, and run the lease loop.
- `src/worker/queue.ts`: Lease, renew, complete, fail, cancel, and interrupt jobs.
- `src/worker/handlers/sync-github.ts`: Execute a manual refresh job.
- `src/worker/handlers/run-stage.ts`: Resolve a workspace and execute Planning, Building, or Review.
- `src/worker/handlers/open-vscode.ts`: Validate a worktree path and run `code <path>`.
- `src/worker/handlers/delete-worktree.ts`: Delete only a clean, exact card worktree.

### Web API and interface

- `app/layout.tsx`: Root layout and metadata.
- `app/page.tsx`: Server-rendered shell and startup configuration errors.
- `app/globals.css`: Dracula tokens and app layout.
- `app/api/board/route.ts`: Board snapshot and filters.
- `app/api/sync/route.ts`: Queue a manual GitHub refresh.
- `app/api/cards/[cardId]/route.ts`: Save card notes and work-agent selection.
- `app/api/cards/[cardId]/move/route.ts`: Validate and save a move plus queue job atomically.
- `app/api/cards/[cardId]/order/route.ts`: Save manual order within a stage.
- `app/api/cards/[cardId]/retry/route.ts`: Queue a fresh stage run.
- `app/api/cards/[cardId]/cancel/route.ts`: Request active run cancellation.
- `app/api/cards/[cardId]/open-vscode/route.ts`: Queue VS Code opening.
- `app/api/cards/[cardId]/worktree/route.ts`: Delete a confirmed clean worktree.
- `app/api/runs/[runId]/log/route.ts`: Stream one authorized local run log without exposing its file path.
- `src/components/board/BoardClient.tsx`: Poll board state, hold filters, and coordinate drag and drop.
- `src/components/board/BoardColumn.tsx`: One sortable stage column.
- `src/components/board/WorkCard.tsx`: Compact card display and status badges.
- `src/components/board/FilterBar.tsx`: Filters and Sync GitHub action.
- `src/components/card/CardDrawer.tsx`: Notes, agent choice, stage output, run history, logs, and worktree actions.
- `src/components/ui/StatusBadge.tsx`: Shared run and match-reason badge.

## Task 1: Scaffold the local application

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `next-env.d.ts`
- Create: `next.config.ts`
- Create: `eslint.config.mjs`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `scripts/dev.ts`
- Create: `scripts/start.ts`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`
- Create: `app/globals.css`

- [ ] **Step 1: Create the package definition**

Use Bun scripts:

```json
{
  "scripts": {
    "dev": "bun run scripts/dev.ts",
    "dev:web": "next dev",
    "worker": "bun run src/worker/main.ts",
    "build": "next build",
    "start": "bun run scripts/start.ts",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit"
  }
}
```

Add runtime packages for Next.js, React, Zod, dnd-kit, and Lucide icons. Add only TypeScript, ESLint, React type packages, and Next.js ESLint configuration as development packages. Do not add test packages.

- [ ] **Step 2: Add strict TypeScript, Next.js, and ESLint configuration**

Use `strict: true`, `noUncheckedIndexedAccess: true`, and the `@/*` alias. Keep Next.js server output compatible with Bun.

- [ ] **Step 3: Add environment documentation and ignore rules**

Copy every variable from the approved spec into `.env.example`. Ignore `.env`, `.next`, `node_modules`, and `.eng-work-board` data when a user places it inside the project.

- [ ] **Step 4: Add the two-process launch scripts**

Use `Bun.spawn` with argument arrays. Forward `SIGINT` and `SIGTERM` to both children. Exit non-zero when either child fails and stop the other child.

- [ ] **Step 5: Add the first Dracula page shell**

Create the root layout and global color tokens. The initial page can render a loading board shell, but it must not contain mock data.

- [ ] **Step 6: Install dependencies and validate the scaffold**

Run:

```bash
bun install
bun run typecheck
bun run lint
bun run build
```

Expected: all commands exit `0`.

- [ ] **Step 7: Commit the scaffold**

```bash
git add package.json bun.lock tsconfig.json next-env.d.ts next.config.ts eslint.config.mjs .gitignore .env.example scripts app
git commit -m "chore: scaffold engineering work board"
```

## Task 2: Add configuration and SQLite storage

**Files:**
- Create: `src/config/env.ts`
- Create: `src/config/paths.ts`
- Create: `src/domain/types.ts`
- Create: `src/domain/workflow.ts`
- Create: `src/db/client.ts`
- Create: `src/db/migrate.ts`
- Create: `src/db/schema.sql`
- Create: `src/db/repositories.ts`
- Modify: `app/page.tsx`

- [ ] **Step 1: Define configuration parsing**

Parse comma-separated lists, positive integers, `codex | claude`, and paths. Return all startup errors together. Keep the token server-only and redact it from errors.

- [ ] **Step 2: Define domain values and transition rules**

Use string unions for card type, match reason, stage, job state, and run state. Export a function with this shape:

```ts
function getWorkflow(card: Pick<Card, "itemType" | "matchReasons">): readonly Stage[];
function canMoveCard(card: Card, destination: Stage): boolean;
```

Reject manual moves to Done and moves while a run is queued or active.

- [ ] **Step 3: Create the initial SQLite schema**

Create tables for repositories, source items, match reasons, cards, workspaces, agent sessions, agent runs, run events, queue jobs, refresh runs, and refresh errors. Add foreign keys, uniqueness for source item identity, queue indexes, and stable numeric card positions.

- [ ] **Step 4: Add database startup and migrations**

Create `APP_DATA_DIR` folders with owner-only permissions. Open SQLite once per process. Enable `foreign_keys`, `journal_mode=WAL`, and a busy timeout. Apply `schema.sql` when `user_version` is `0`.

- [ ] **Step 5: Add focused data access functions**

Keep SQL out of route handlers and worker handlers. Provide transaction helpers for refresh reconciliation, card moves plus queue insertion, manual ordering, run creation, and queue leasing.

- [ ] **Step 6: Block both processes on invalid startup configuration**

Expose one configuration result that both entry points use. When configuration is invalid, render one blocking panel listing every safe error in the web process. The worker must print the same safe errors and exit before it opens the queue, leases a job, scans a repository, or starts a subprocess. Do not render the board or start work.

- [ ] **Step 7: Run static validation and a database smoke command**

Run typecheck and lint. Run a short Bun command that points `APP_DATA_DIR` at a temporary folder, opens the database, applies migrations, prints the table names, and exits. Do not save this command as a test.

- [ ] **Step 8: Commit storage and configuration**

```bash
git add src/config src/domain src/db app/page.tsx
git commit -m "feat: add durable board storage"
```

## Task 3: Implement GitHub manual refresh

**Files:**
- Create: `src/github/client.ts`
- Create: `src/github/queries.ts`
- Create: `src/github/sync.ts`
- Modify: `src/db/repositories.ts`
- Modify: `src/domain/types.ts`

- [ ] **Step 1: Build the authenticated GitHub client**

Use native `fetch`. Add the current GitHub API version header, pagination, GraphQL error handling, rate-limit details, and token redaction. Expose typed `rest` and `graphql` helpers.

- [ ] **Step 2: Resolve the sync scope**

Read the authenticated username, organization repositories, optional extra repositories, exclusions, and user teams. Filter discovered teams by the optional allowlist.

- [ ] **Step 3: Build exact source queries**

Query assigned issues, assigned PRs, authored PRs, direct review requests, and team review requests. Query actual mentions within the configured date window. Do not use `involves` for mentions.

- [ ] **Step 4: Normalize and deduplicate source items**

Normalize one source item by `owner/repository` plus GitHub number. Merge match reasons. Record PR author, assignees, review requests, head and base details, state, merged state, labels, body, URL, and timestamps.

- [ ] **Step 5: Reconcile one refresh transaction**

Insert new cards at the top of Backlog. Archive stale Backlog cards. Mark active stale cards as no longer assigned. Fetch the current state for tracked items missing from the open result set and move closed or merged cards to Done.

- [ ] **Step 6: Preserve partial results**

Record each repository or query failure. Commit successful scope results and keep prior data for failed scope entries.

- [ ] **Step 7: Validate with a read-only GitHub smoke command**

With a configured token, print the authenticated login, scoped repository count, and source-item counts by match reason. Do not write to GitHub or SQLite in this first smoke command.

- [ ] **Step 8: Commit GitHub sync**

```bash
git add src/github src/db/repositories.ts src/domain/types.ts
git commit -m "feat: sync personal GitHub work"
```

## Task 4: Implement repository discovery and worktrees

**Files:**
- Create: `src/git/run-git.ts`
- Create: `src/git/repository-locator.ts`
- Create: `src/git/workspace.ts`
- Create: `src/git/state.ts`
- Modify: `src/db/repositories.ts`

- [ ] **Step 1: Add a safe Git subprocess helper**

Pass Git arguments as an array. Capture stdout, stderr, exit code, and cancellation. Never interpolate repository names or paths into a shell command.

- [ ] **Step 2: Scan configured repository roots**

Walk directories with a bounded depth and skip dependencies, build output, hidden app data, and existing worktrees. Read each repository's `origin` URL and normalize SSH and HTTPS GitHub URLs to the same identity.

- [ ] **Step 3: Resolve or clone a repository**

Reuse a matching local clone. Otherwise clone into `APP_DATA_DIR/repos/<owner>/<repository>`. Serialize clone and fetch operations per repository.

- [ ] **Step 4: Create one card worktree**

Use the default branch for issues and the PR head for authored or assigned PRs. Use a detached, read-only checkout for review-only PRs. Create full-workflow branches with the `codex/` prefix and a stable card-derived name.

- [ ] **Step 5: Capture before and after Git state**

Record HEAD, porcelain status, local branches, tags, and configured remote references. Provide comparison functions used by agent policy checks.

- [ ] **Step 6: Add guarded worktree deletion**

Delete only the workspace row's exact path. Refuse dirty worktrees unless the API receives explicit confirmation. Never use a broad recursive target.

- [ ] **Step 7: Validate against temporary local repositories**

Create temporary bare and working repositories with shell commands. Run repository matching, worktree creation, state capture, and clean deletion. Remove only the exact temporary directory after the smoke check.

- [ ] **Step 8: Commit Git workspace handling**

```bash
git add src/git src/db/repositories.ts
git commit -m "feat: isolate card worktrees"
```

## Task 5: Implement agent adapters and policy controls

**Files:**
- Create: `src/agents/types.ts`
- Create: `src/agents/process.ts`
- Create: `src/agents/codex.ts`
- Create: `src/agents/claude.ts`
- Create: `src/agents/prompts.ts`
- Create: `src/agents/policy.ts`

- [ ] **Step 1: Define the runner boundary**

Use this provider-neutral shape:

```ts
interface AgentRunner {
  start(input: StartRunInput): AsyncIterable<AgentEvent>;
  resume(input: ResumeRunInput): AsyncIterable<AgentEvent>;
  cancel(runId: string): Promise<void>;
}
```

Normalize text, command, progress, result, error, session ID, and completion events.

- [ ] **Step 2: Add subprocess streaming and required log files**

Write raw stdout and stderr to a per-run log under `APP_DATA_DIR/logs`. Open the log before starting the provider. If the log cannot open or any log write fails, stop the provider process and fail the run. Parse complete lines without losing malformed provider output. Track child process groups so Cancel stops the whole run.

- [ ] **Step 3: Add stage prompts and structured results**

Planning requests triage, blockers, a file-level plan, and suggested checks. Building requests changed files, commands, results, blockers, and a short PR title and description. Review requests findings, verdict, checks, and updated PR text.

- [ ] **Step 4: Implement Codex start and resume**

Use `codex exec --json`, the card worktree, a stage sandbox, and prompt input over stdin. Persist the session ID from JSON events. Resume Building with `codex exec resume <session-id>`.

- [ ] **Step 5: Implement Claude Code start and resume**

Use `claude --print --output-format stream-json`, a stage permission mode, and prompt input. Persist the session ID. Resume Building with `--resume <session-id>`.

- [ ] **Step 6: Enforce stage policy**

Strip `GITHUB_TOKEN` and Git credential variables from the child environment. Put guarded `git` and `gh` wrappers first on `PATH`. Deny commit, push, tag, destructive reset and clean, GitHub writes, and other-worktree changes. Give Planning and Review read-only file permissions. Give Building write access only to its worktree.

- [ ] **Step 7: Check post-run Git state**

Fail Planning or Review on any file change. Fail Building on HEAD, branch, tag, or remote-reference changes. Keep uncommitted file changes. Save the policy failure in the run summary.

- [ ] **Step 8: Validate adapter parsing without live usage**

Feed saved representative JSON lines through each parser using a one-off Bun command. Check normalized output in the terminal. Do not save fixtures as tests.

- [ ] **Step 9: Commit agent adapters**

```bash
git add src/agents
git commit -m "feat: add supervised coding agents"
```

## Task 6: Implement the durable worker

**Files:**
- Create: `src/worker/main.ts`
- Create: `src/worker/queue.ts`
- Create: `src/worker/handlers/sync-github.ts`
- Create: `src/worker/handlers/run-stage.ts`
- Create: `src/worker/handlers/open-vscode.ts`
- Create: `src/worker/handlers/delete-worktree.ts`
- Modify: `src/db/repositories.ts`

- [ ] **Step 1: Add queue leasing and recovery**

Lease pending jobs in creation order up to the configured concurrency. Renew active leases. On startup, mark expired leases and their active runs as interrupted.

- [ ] **Step 2: Handle manual refresh jobs**

Create a refresh run, execute the GitHub sync, record partial errors, and save the final result without blocking other read requests.

- [ ] **Step 3: Handle Planning jobs**

Resolve the workspace, start the selected work agent with read-only access, store normalized events, save the plan result, and keep the card in Planning. When the structured result contains questions or a blocker that needs user context, set the run to `needs_input` and store each question on the run.

- [ ] **Step 4: Handle Building jobs**

Require a successful Planning session. Resume that exact provider session, allow worktree edits, save check results and PR text, then enforce the Git state policy. Save blocker questions and use `needs_input` when the agent cannot continue without user context.

- [ ] **Step 5: Handle Review jobs**

Select the other provider, start a fresh read-only session, include prior outputs and the current diff, and save review findings without changing files. Save blocker questions and use `needs_input` when the review cannot finish without user context.

- [ ] **Step 6: Handle Retry, Cancel, VS Code, and deletion**

Retry creates a new run. For `needs_input`, reject Retry until the card notes have a modification time later than the blocked run and include the updated notes in the follow-up prompt. Resume only a valid unchanged work-agent session. Cancel signals the active process tree. Validate worktree paths before launching VS Code or deleting anything.

- [ ] **Step 7: Add clean shutdown**

Stop leasing new work, cancel lease renewal, wait briefly for active database writes, and leave active agent runs marked interrupted when the process exits unexpectedly.

- [ ] **Step 8: Run worker smoke checks with no pending jobs**

Start the worker against a temporary app-data directory. Confirm migration, startup recovery, idle polling, and signal shutdown in the terminal.

- [ ] **Step 9: Commit the worker**

```bash
git add src/worker src/db/repositories.ts
git commit -m "feat: run durable workflow jobs"
```

## Task 7: Add the board API

**Files:**
- Create: `app/api/board/route.ts`
- Create: `app/api/sync/route.ts`
- Create: `app/api/cards/[cardId]/route.ts`
- Create: `app/api/cards/[cardId]/move/route.ts`
- Create: `app/api/cards/[cardId]/order/route.ts`
- Create: `app/api/cards/[cardId]/retry/route.ts`
- Create: `app/api/cards/[cardId]/cancel/route.ts`
- Create: `app/api/cards/[cardId]/open-vscode/route.ts`
- Create: `app/api/cards/[cardId]/worktree/route.ts`
- Create: `app/api/runs/[runId]/log/route.ts`
- Create: `src/services/board.ts`
- Create: `src/services/cards.ts`

- [ ] **Step 1: Add the board snapshot service**

Return columns, ordered cards, counts, current refresh, active runs, saved needs-input questions, safe configuration summary, and available filters. Return an API log URL for each run with a log. Never return tokens, raw provider environment values, or unrestricted file paths.

- [ ] **Step 2: Add sync and card update routes**

Queue one refresh at a time. Save notes and the work-agent choice. Reject agent changes after Planning starts unless Planning failed and Retry will start a fresh session.

- [ ] **Step 3: Add move and ordering routes**

Validate workflow-specific destinations. Save a forward move and its stage job atomically. Reject manual moves to Done. Rebalance numeric positions when needed.

- [ ] **Step 4: Add run, log, and worktree action routes**

Retry the current stage, request cancellation, queue VS Code opening, and request guarded worktree deletion. Return clear conflict errors for active runs, unchanged notes after `needs_input`, or dirty deletion. Add a read-only log route that resolves the run ID through SQLite, verifies that the saved path sits under `APP_DATA_DIR/logs`, and streams plain text without returning the filesystem path.

- [ ] **Step 5: Add consistent API errors**

Return a stable JSON error shape with a safe message, code, and optional field details. Log the full local cause without leaking the token to the browser.

- [ ] **Step 6: Validate routes with direct HTTP requests**

Start the web process with a temporary database. Use `curl` to read the empty board, queue a sync without a token to confirm safe configuration blocking, and exercise invalid card IDs and invalid Done moves through seeded local rows.

- [ ] **Step 7: Commit the API**

```bash
git add app/api src/services
git commit -m "feat: expose board workflow API"
```

## Task 8: Build the Dracula Kanban interface

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/globals.css`
- Create: `src/components/board/BoardClient.tsx`
- Create: `src/components/board/BoardColumn.tsx`
- Create: `src/components/board/WorkCard.tsx`
- Create: `src/components/board/FilterBar.tsx`
- Create: `src/components/card/CardDrawer.tsx`
- Create: `src/components/ui/StatusBadge.tsx`

- [ ] **Step 1: Build the full-width board shell**

Render Backlog, Planning, Building, Review, and Done with horizontal overflow. Poll every two seconds only while a refresh or agent run is active. Add clear empty, loading, and startup-error states.

- [ ] **Step 2: Build filters and manual sync**

Add organization or repository, item type, match reason, and agent status filters. Keep filters in the URL. Show last refresh, partial errors, and Sync GitHub progress.

- [ ] **Step 3: Add sortable cards and columns**

Use dnd-kit for pointer and keyboard drag. Persist same-column order. Allow only workflow-valid forward and backward destinations. Do not make Done a manual drop target. Lock active cards.

- [ ] **Step 4: Add compact card content**

Show title, repository and number, item type, match reasons, work agent, and run status. Use accessible text with Dracula colors rather than color alone.

- [ ] **Step 5: Build the detail drawer**

Add the GitHub link, editable notes, pre-Planning agent choice, plan, changed files, check results, review findings, PR title and description, run history, log links, Retry, Cancel, Open in VS Code, and guarded worktree deletion.

- [ ] **Step 6: Add user feedback and error recovery**

Show optimistic ordering only. For stage moves, wait for the transactional API result before showing success. Restore the card when a request fails and show the safe API message.

- [ ] **Step 7: Run keyboard and browser checks**

Check filters, drawer focus, keyboard drag, horizontal scrolling, Retry and Cancel visibility, and readable status without relying only on color. Use local seeded rows and do not add browser tests.

- [ ] **Step 8: Commit the interface**

```bash
git add app src/components
git commit -m "feat: add Dracula workflow board"
```

## Task 9: Final validation and local handoff

**Files:**
- Create: `README.md`
- Modify: `.env.example`
- Modify: `docs/superpowers/plans/2026-08-28-engineering-work-board-implementation.md`

- [ ] **Step 1: Write the local setup guide**

Document Bun install expectations, `.env` setup, GitHub token permissions, Codex and Claude Code sign-ins, `code` command setup, `bun dev`, data paths, logs, and safe worktree cleanup.

- [ ] **Step 2: Run all static validation**

```bash
bun run lint
bun run typecheck
bun run build
```

Expected: all commands exit `0`.

- [ ] **Step 3: Run focused local smoke checks**

Use a temporary `APP_DATA_DIR`. Confirm startup migration, empty board API, worker idle loop, safe shutdown, and VS Code command validation. Confirm no test files, test scripts, test runner, or test-only dependencies exist.

- [ ] **Step 4: Run the manual end-to-end workflow when credentials are available**

Follow the twelve outcomes in the approved design. Stop and report any outcome that cannot be checked because credentials, repository access, or live agent usage is unavailable.

- [ ] **Step 5: Inspect safety boundaries**

Confirm agent child environments omit `GITHUB_TOKEN`. Confirm invalid Done moves fail. Confirm Building leaves HEAD unchanged. Confirm Review cannot edit. Confirm worktree deletion rejects dirty state without explicit confirmation.

- [ ] **Step 6: Review the final diff and mark completed plan items**

Run `git diff --check`, inspect the branch diff against `main`, and update this plan's checkboxes to match completed work.

- [ ] **Step 7: Commit the handoff**

```bash
git add README.md .env.example docs/superpowers/plans/2026-08-28-engineering-work-board-implementation.md
git commit -m "docs: add local dashboard setup"
```
