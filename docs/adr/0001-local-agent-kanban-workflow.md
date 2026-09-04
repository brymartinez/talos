# ADR 0001: Use a local worker and stage-based agent workflow

- Status: Accepted
- Date: 2026-08-28

## Context

The dashboard is a personal Kanban board for GitHub work. It collects open issues and pull requests from one configured organization and optional extra repositories. A card can match because it is assigned to the user, authored by the user, requests a review from the user or one of the user's teams, or mentions the user.

Moving a card forward must start agent work. Planning and Building need local repository access. Building must leave changes uncommitted so the user can review them in VS Code before raising a pull request. Review must use a different agent and must not change code.

Agent runs can take longer than a web request. A browser reload or a Next.js development restart must not lose the run queue or the board state.

## Decision

### Run the web app and worker as separate local processes

`bun dev` starts both processes:

- A Next.js process serves the board and API.
- A worker handles GitHub refreshes, repository discovery, cloning, Git worktrees, agent commands, and log files.

The web app adds work to a SQLite queue. Only the worker starts Codex or Claude Code. The worker runs one job at a time by default. An environment variable can raise the limit.

SQLite stores GitHub items, cards, manual card order, stage changes, agent sessions, run summaries, queue state, and refresh errors. Full agent output stays in local log files. While a run is active, the board reads updated status from SQLite every two seconds.

If the worker restarts, it marks unfinished runs as interrupted and offers Retry. It does not resume an interrupted run without user approval.

### Store one card for each GitHub item

A source item is one GitHub issue or pull request. The dashboard stores one card for each source item. The card can keep several match reasons.

A manual GitHub refresh performs these actions:

- Read accessible repositories from every organization in `GITHUB_ORGS`.
- Add every repository in `GITHUB_REPOS`.
- Remove repositories from `GITHUB_EXCLUDE_REPOS`.
- Find assigned or authored issues, assigned pull requests, authored pull requests, direct review requests, team review requests, and mentions updated within the last 90 days.
- Add new cards to the top of Backlog.
- Archive a stale card if it is still in Backlog.
- Mark a stale active card as **No longer assigned**.
- Move a closed or merged source item to Done.

The app discovers the user's teams inside the configured organization. An optional environment variable limits the team list.

### Use stages that name the next kind of work

Issues and authored or assigned pull requests use this workflow:

`Backlog → Planning → Building → Review → Done`

Pull requests that only request a review use this workflow:

`Backlog → Planning → Review → Done`

A mentioned pull request uses the full workflow only when the user authored it or it is assigned to the user. Other mentioned pull requests use the review-only workflow.

A valid forward move saves the new stage and immediately queues its agent run. A card cannot move while its agent is running. A backward move does not start an agent.

### Give each active stage one agent task

Planning performs these actions:

- Find an existing local clone under the configured repository roots by matching its `origin` URL.
- Clone the repository into an app-managed folder when no local clone exists.
- Create an isolated Git worktree and branch for the card.
- Inspect the GitHub item and the relevant code.
- Save a triage summary and a written plan on the card.
- Make no code changes.

Building continues the Planning conversation with the same agent. It makes and tests local code changes in the card's worktree. It saves a short draft pull request description on the card. It does not commit, push, or open a pull request.

Review starts a new conversation with the other agent. It inspects the local diff, reruns relevant checks, reports findings, and updates the draft pull request description. It does not change code.

Done reflects a GitHub fact. Only a manual GitHub refresh moves a card to Done when the source issue or pull request is closed or the pull request is merged.

Planning and Building use Codex or Claude Code based on the card's work-agent choice. Review always uses the other agent.

### Preserve manual control over repository and GitHub writes

Agent subprocesses keep the user's normal Codex or Claude Code network settings. The worker does not pass `GITHUB_TOKEN` to an agent subprocess.

Provider command rules block commits, pushes, destructive Git commands, and GitHub write commands. Planning and Review receive read-only file access. Building can write only inside its card worktree. The worker compares the Git state before and after each run. A policy violation marks the run as failed.

## Alternatives considered

### Start agents inside Next.js

This option has fewer processes. It mixes long-running local commands with web request handling. Next.js restarts can interrupt work and make recovery harder.

### Run a permanent local service

This option can keep working after the dashboard closes. It requires installation and service management that the first version does not need.

## Consequences

- The queue and board survive browser reloads.
- The worker has one clear owner for Git and agent processes.
- Each card has an isolated worktree, so queued cards do not share uncommitted files.
- The user keeps control of commits, pushes, and pull request creation.
- Review comes from a different agent than Planning and Building.
- Agents can use the network for tests and package downloads without receiving the dashboard's GitHub token.
- Local setup must provide Bun, Git, VS Code, Codex, Claude Code, and valid command-line sign-ins.
- The app must manage two local processes and recover interrupted queue records.
