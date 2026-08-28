# Engineering Work Board design

- Status: Approved
- Date: 2026-08-28
- Project path: `~/Documents/projects/eng-work-board`

## Goal

Build a trusted, single-user dashboard that runs on the user's Mac. The dashboard collects GitHub work into a local Kanban board and starts Codex or Claude Code when a card moves forward.

The dashboard keeps the user in control. Agents can plan, edit, test, and review. They cannot commit, push, open pull requests, or write to GitHub.

## Scope

The first version includes:

- One GitHub organization per app run.
- Optional repositories outside the organization.
- Assigned issues and pull requests.
- Pull requests authored by the user.
- Direct and team review requests.
- Mentions from open items updated within the last 90 days.
- A local Kanban board with manual card order.
- Manual GitHub refresh only.
- Codex and Claude Code runners.
- Per-card Git worktrees.
- A Dracula desktop interface.
- SQLite state and file-based agent logs.

The first version does not include:

- Multiple users or remote access.
- Multiple configured organizations in one app run.
- Scheduled refreshes or webhooks.
- Automatic commits, pushes, pull request creation, or GitHub comments.
- A built-in code diff viewer.
- A packaged desktop app or Docker image.
- A test suite.

## System structure

`bun dev` and `bun start` launch two local processes:

1. The Next.js process serves the board and API.
2. The worker handles GitHub refreshes, repository discovery, cloning, worktrees, queued jobs, agent subprocesses, and log files.

The web process never starts an agent directly. It saves a queue job in SQLite. The worker leases queued jobs and runs up to `AGENT_CONCURRENCY` jobs at once. The default limit is one.

Both processes use the same SQLite database. Enable foreign keys and write-ahead logging. The board reads active run state every two seconds.

If the worker starts while a job is still marked as running, the worker marks that run as interrupted. The user must select Retry before the worker continues.

See [ADR 0001](../../adr/0001-local-agent-kanban-workflow.md) for the architecture decision.

## Configuration

Read and validate configuration at startup. Show one page that lists every invalid or missing value. Do not start the worker when required configuration is invalid.

| Variable | Required | Meaning |
|---|---:|---|
| `GITHUB_TOKEN` | Yes | Personal access token used only by the dashboard worker. |
| `GITHUB_ORG` | Yes | The one organization included in this app run. |
| `GITHUB_REPOS` | No | Comma-separated extra `owner/repository` names. These may sit outside `GITHUB_ORG`. |
| `GITHUB_EXCLUDE_REPOS` | No | Comma-separated repositories removed from the final scope. |
| `GITHUB_TEAM_ALLOWLIST` | No | Comma-separated team slugs. Omit it to use all discovered teams in `GITHUB_ORG`. |
| `GITHUB_MENTION_LOOKBACK_DAYS` | No | Mention window. Default: `90`. |
| `REPO_ROOTS` | No | Comma-separated folders scanned for local clones. Default: `~/Documents/projects`. |
| `APP_DATA_DIR` | No | SQLite, managed clones, worktrees, and logs. Default: `~/.eng-work-board`. |
| `WORK_AGENT` | Yes | Default work agent. Value: `codex` or `claude`. |
| `AGENT_CONCURRENCY` | No | Maximum active agent runs. Default: `1`. |
| `CODE_COMMAND` | No | VS Code command. Default: `code`. |

The app reuses existing Codex and Claude Code command-line sign-ins. The app does not store their API keys.

## Domain records

SQLite stores these records:

| Record | Purpose |
|---|---|
| Repository | GitHub identity, clone URLs, default branch, and resolved local clone. |
| Source item | One normalized GitHub issue or pull request. |
| Match reason | One reason that a source item belongs on the board. |
| Card | Stage, manual order, notes, agent choice, archive state, and source item link. |
| Workspace | Clone, worktree, branch, base commit, and current Git state for a card. |
| Agent session | Provider and resumable conversation ID. |
| Agent run | Stage attempt, timestamps, status, summary, result fields, and log path. |
| Run event | Small normalized progress event shown by the interface. |
| Queue job | Durable pending, leased, completed, failed, cancelled, or interrupted work. |
| Refresh run | Manual refresh result and per-repository errors. |

Use one card for each source item. Store every current match reason on that card.

## GitHub refresh

The user starts every refresh with **Sync GitHub**. Do not poll GitHub in the background.

A refresh performs these steps:

1. Read the authenticated GitHub username from the token.
2. List accessible repositories in `GITHUB_ORG`.
3. Add `GITHUB_REPOS` and remove `GITHUB_EXCLUDE_REPOS`.
4. Discover the user's teams in `GITHUB_ORG`, then apply `GITHUB_TEAM_ALLOWLIST` when present.
5. Query open assigned issues, assigned pull requests, authored pull requests, direct review requests, team review requests, and mentions.
6. Normalize and deduplicate results by repository and GitHub number.
7. Save source items, match reasons, and card changes in one database transaction.

Mention queries must identify actual mentions. Do not use GitHub's broader `involves` filter. Limit mention results to open items updated within `GITHUB_MENTION_LOOKBACK_DAYS`.

Add new cards to the top of Backlog. If an open item stops matching, archive it when it remains in Backlog. Keep an active card and add **No longer assigned** when it stops matching.

When GitHub reports an issue or pull request as closed, or a pull request as merged, move its card to Done. GitHub facts override the local active stage.

A partial refresh saves successful results and keeps old data for failed repositories. Show each failure and offer Retry.

## Card workflows

Issues and authored or assigned pull requests use this workflow:

`Backlog → Planning → Building → Review → Done`

Pull requests that only request a review use this workflow:

`Backlog → Planning → Review → Done`

A mentioned pull request uses the full workflow only when the user authored it or it is assigned to the user. Other mentioned pull requests use the review-only workflow.

A valid forward move into Planning, Building, or Review saves with its queue job in one transaction. The move itself approves the agent run. A card cannot move while its run is active. A backward move does not start an agent.

Done is not a manual drop target. Only a GitHub refresh can move a closed or merged source item to Done. Review-to-Done never creates an agent job.

The card stays in the destination stage when a run fails, needs input, is cancelled, or is interrupted. The card shows the run status and Retry.

## Repository and worktree handling

Resolve code only when a card first enters Planning.

Search the configured `REPO_ROOTS` for Git repositories. Match a local repository by its normalized `origin` URL, not by its folder name. If no clone matches, clone the repository under `APP_DATA_DIR/repos`.

Create one worktree and branch for each card under `APP_DATA_DIR/worktrees`. Use the repository's current default branch as the base for an issue. Use the pull request head for an authored or assigned pull request. Fetch a review-requested pull request and check it out read-only.

Use the branch prefix `codex/` by default. The branch name includes the repository name, item type, GitHub number, and a short title slug.

Never delete a worktree automatically. A Done card keeps its worktree until the user selects a delete action. Refuse deletion when the worktree contains uncommitted changes unless the user confirms the exact worktree.

## Agent runners

Expose one internal runner shape for both providers. A runner can start, resume, and cancel a session. It emits normalized events and returns a structured stage result.

The Codex adapter uses non-interactive `codex exec` runs, JSON line output, and `codex exec resume`. The Claude Code adapter uses print mode, streaming JSON output, and session resume.

Planning and Building use one work agent selected before Planning. `WORK_AGENT` provides the default, and the card can override it. Building resumes the Planning session.

Review always starts a new session with the other provider. If Codex performs Planning and Building, Claude Code performs Review. If Claude Code performs Planning and Building, Codex performs Review.

### Planning result

Planning has read-only file access. It saves:

- A short triage summary.
- Whether the work is clear and possible.
- Questions or blockers.
- A file-level implementation plan.
- Suggested checks to run during Building.

Planning must not change files.

### Building result

Building can change files only inside the card worktree. It saves:

- A short result summary.
- Changed file paths.
- Commands and checks run.
- Check results.
- Blockers.
- A short draft pull request title and description.

Building must not commit, push, tag, open a pull request, or write to GitHub.

### Review result

Review has read-only file access. It receives the source item, plan, Building result, Git diff, and current check results. It saves:

- Review findings with severity and file locations when available.
- Check results.
- A review verdict.
- An updated draft pull request title and description.

Review must not change files.

## Agent safety

Spawn agent commands without a shell. Pass arguments as an array. Set the card worktree as the only writable project directory.

Do not pass `GITHUB_TOKEN` to agent subprocesses. Keep each provider's normal network settings so tests and package downloads can work.

Use provider command rules to deny:

- `git commit`, `git push`, and tag creation.
- Destructive Git cleanup or reset commands.
- GitHub CLI write commands.
- Commands that remove or change another worktree.

Record the worktree HEAD, status, and remote references before and after each run. Mark the run as failed when a stage changes state that its policy forbids.

## Queue and run states

Queue jobs use these states:

`pending`, `leased`, `completed`, `failed`, `cancelled`, `interrupted`

Agent runs use these states:

`queued`, `running`, `succeeded`, `failed`, `needs_input`, `cancelled`, `interrupted`

The worker leases jobs in creation order. A lease stores the worker ID and expiry time. A live worker renews the lease. A worker restart marks an expired active lease as interrupted.

Retry always creates a new agent run. Resume the saved provider session only when the provider session exists and the user has not changed the work agent. Keep every earlier run record and log.

Cancel stops the process tree and marks the run as cancelled. Keep all worktree files.

## Interface

Use the Dracula palette:

| Use | Color |
|---|---|
| Background | `#282a36` |
| Raised area | `#44475a` |
| Text | `#f8f8f2` |
| Muted text | `#6272a4` |
| Cyan | `#8be9fd` |
| Green | `#50fa7b` |
| Orange | `#ffb86c` |
| Pink | `#ff79c6` |
| Purple | `#bd93f9` |
| Red | `#ff5555` |
| Yellow | `#f1fa8c` |

The desktop board fills the page. Each stage is one column. Support horizontal scrolling when needed. Mobile layout is outside the first version.

A fixed top bar contains:

- Organization and repository filter.
- Issue or pull request filter.
- Match-reason filter.
- Agent-status filter.
- Last refresh time.
- Refresh errors.
- **Sync GitHub**.

Card order is manual and persists per stage. Dragging a card forward into Planning, Building, or Review starts its agent immediately. Dragging a card within a stage changes only its order. The interface does not allow a card to be dragged into Done.

Each card shows the title, repository, number, type, match reasons, selected work agent, and current run status.

Clicking a card opens a side drawer. The drawer contains the GitHub link, notes editor, work-agent selector, stage outputs, plan, changed files, check results, run history, draft pull request text, and full log links. Available actions include Retry, Cancel, and worktree deletion. Building and Review cards include **Open in VS Code**, which runs `CODE_COMMAND <worktree-path>`.

The work-agent selector is editable until Planning starts. Changing it after a failed Planning run starts a fresh provider session on Retry.

Do not build an embedded diff viewer. VS Code is the full code-review tool.

## Errors and recovery

- Invalid startup configuration blocks the worker and shows every configuration error.
- A failed repository scan, clone, fetch, or worktree operation leaves the card in its stage with Failed and Retry.
- A failed agent or check leaves the worktree unchanged and visible.
- A needs-input result shows the questions on the card and waits for the user to add notes before Retry.
- A partial GitHub refresh keeps old data for failed repositories.
- A browser reload does not change queue or run state.
- A worker restart marks unfinished runs as interrupted and never resumes them automatically.
- Log write errors fail the run because the dashboard cannot audit work without the raw output.

## Validation

Do not create a test suite, test files, a test runner, test scripts, or test-only dependencies. See [ADR 0002](../../adr/0002-validate-without-a-test-suite.md).

Validate implementation with:

- Type checking.
- Linting.
- A production build.
- Manual browser checks.
- One manual end-to-end run with a real GitHub item, Codex, and Claude Code.

The manual run checks these outcomes:

1. Sync imports expected items without duplicate cards.
2. Planning creates a worktree and plan without changing code.
3. Building resumes the same agent and leaves tested changes uncommitted.
4. Building saves a short pull request description.
5. Review uses the other agent and leaves code unchanged.
6. A review-requested pull request skips Building.
7. Partial GitHub failures preserve old cards and show Retry.
8. A worker restart marks an active run as interrupted.
9. A later sync moves a closed or merged item to Done.
10. **Open in VS Code** opens the correct card worktree.
11. A failed agent run stays in its stage and Retry creates a new run record.
12. Cancel stops an active run and keeps its worktree changes.

## References

- [OpenAI developer commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli)
- [GitHub issue and pull request filters](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/filtering-and-searching-issues-and-pull-requests)
- [GitHub repository API](https://docs.github.com/en/rest/repos/repos)
- [GitHub teams API](https://docs.github.com/en/rest/teams)
