# Engineering Work Board

A local Kanban board for GitHub work. It gathers issues and pull requests that need your attention. Each forward stage move starts a supervised Codex or Claude Code run.

The app never commits, pushes, or opens a pull request. Building leaves changes uncommitted in an isolated Git worktree. You review them in VS Code and raise the pull request yourself. The card keeps a short draft pull request title and description.

## Requirements

- [Bun](https://bun.sh/) 1.3 or newer
- Git
- [Codex CLI](https://developers.openai.com/codex/cli/) and a valid `codex login`
- Claude Code and a valid `claude auth login`
- VS Code with the `code` command installed

Check the agent sign-ins before starting:

```bash
codex login status
claude auth status
```

## Setup

Install packages and create your local environment file:

```bash
bun install
cp .env.example .env
```

Set these required values in `.env`:

```dotenv
ENG_GITHUB_TOKEN=github_pat_...
WORK_AGENT=codex
```

Configure at least one organization or repository. You can configure both:

```dotenv
# Include every accessible repository from these organizations
GITHUB_ORGS=your-organization,another-organization

# Include these repositories by their full owner/repository names
GITHUB_REPOS=your-owner/nest-starter,another-owner/tool
```

Give the fine-grained GitHub token access to every configured organization and repository. Read access to repository metadata, issues, and pull requests is enough. Some organizations require an owner to approve the token. The app makes read-only GitHub API calls and does not pass this token to agent processes.

Useful optional settings:

```dotenv
# Comma-separated owner/repository names to hide
GITHUB_EXCLUDE_REPOS=your-organization/archived-tool

# Comma-separated team slugs. Empty means all your teams in the configured organizations and repository owners.
GITHUB_TEAM_ALLOWLIST=platform,backend

# Comma-separated folders searched for existing clones
REPO_ROOTS=~/Documents/projects

# One agent at a time by default
AGENT_CONCURRENCY=1
```

GitHub documents the current token rules in [Permissions required for fine-grained personal access tokens](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens) and [List teams for the authenticated user](https://docs.github.com/en/rest/teams/teams#list-teams-for-the-authenticated-user).

## Run

```bash
bun dev
```

Open [http://localhost:3000](http://localhost:3000). `bun dev` starts both Next.js and the durable worker. Use **Sync GitHub** to refresh the board.

The web server binds to `127.0.0.1`. It is not exposed to other devices on the local network.

The normal flow is:

1. Move a card from Backlog to Planning. The selected work agent triages it and writes a plan without editing files.
2. Review the plan and add notes when needed.
3. Move implementation work to Building. The same agent session edits the isolated worktree and runs checks.
4. Open the worktree in VS Code and inspect the uncommitted changes.
5. Move the card to Review. The other agent reviews the diff without editing it.
6. Commit, push, and open the pull request yourself. Copy the draft title and description from the card.
7. Sync GitHub after the issue or pull request is closed or merged. The card then moves to Done.

Review-only pull requests skip Building.

## Local data

By default, app data lives under `~/.eng-work-board`:

- `board.sqlite` stores board state and the durable queue.
- `repos/` stores app-managed clones.
- `worktrees/<card-id>/` stores isolated card worktrees.
- `logs/<run-id>.log` stores full agent output.

Change the root with `APP_DATA_DIR`.

The drawer can delete a clean worktree. Dirty worktrees are refused unless an explicit forced deletion is requested. The worker checks the exact saved path before opening VS Code or deleting a worktree.

## Safety model

- Planning and Review run with read-only file access.
- Building can edit only its card worktree.
- Agent environments omit GitHub and Git credential variables.
- Guarded `git` and `gh` commands block commit, push, tag, destructive reset, clean, and GitHub writes.
- Git state is compared before and after each run.
- Done is based on GitHub closed or merged state. It is not a manual drop target.

See [ADR 0001](docs/adr/0001-local-agent-kanban-workflow.md) for the workflow design and [ADR 0002](docs/adr/0002-validate-without-a-test-suite.md) for the requested validation approach.

## Validation

This project intentionally has no automated test suite. Run the static checks:

```bash
bun run lint
bun run typecheck
bun run build
```
