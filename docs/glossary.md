# Engineering Work Board glossary

## Agent run

One attempt by Codex or Claude Code to complete the task for a stage.

## Agent session

A provider conversation that the app can resume. Planning and Building share the work-agent session. Review starts a separate session with the other agent. Retrying a stage resumes its eligible session.

## Outcome

The agent's reported result for the current stage: Ready, Needs input, Blocked, or Changes requested. Ready means that stage's work is complete. An outcome does not say whether the agent is still running.

## Outcome report

A record of an outcome, the agent's reason, and any supporting results. A report belongs to one run and stage. It does not move the card to another stage.

## Card

The local Kanban record for one GitHub source item. A card stores its stage, manual order, agent choice, run history, outcome reports, and workspace.

## Match reason

Why a source item belongs on the board. Reasons include assignment, authorship, direct review request, team review request, and mention. One card can have several reasons.

## Source item

One GitHub issue or pull request. The repository name and GitHub number identify it within the dashboard.

## Stage

The card's current Kanban column. The stages are Backlog, Planning, Building, Review, and Done.

## Work agent

The agent selected for Planning and Building on one card.

## Review agent

The agent that reviews the work-agent output. It is always the other supported agent.

## Worktree

A separate Git checkout for one card. It isolates uncommitted changes from other cards that use the same repository.

## Worker

The local process that owns GitHub refreshes, Git operations, the queue, and agent subprocesses.
