# ADR 0002: Validate without a test suite

- Status: Accepted
- Date: 2026-08-28

## Context

The first version is a personal local tool. The user explicitly does not want a test suite for this project.

The project still needs checks that catch type errors, lint errors, build failures, and broken end-to-end behavior before implementation is considered complete.

## Decision

Do not add test files, a test runner, test scripts, or test-only dependencies.

Validate changes with these checks:

- Run the TypeScript type checker.
- Run the linter.
- Create a production build.
- Check the interface manually in a browser.
- Run one manual end-to-end workflow with a real GitHub item, Codex, and Claude Code.

The manual workflow covers GitHub sync, Planning, Building, Review, VS Code opening, failure handling, restart recovery, and Done detection.

## Consequences

- The project has less setup and fewer dependencies.
- Validation does not consume live agent usage except during the manual end-to-end check.
- Regressions in queue recovery, Git integration, and agent event parsing rely on manual checks.
- Future changes must not add a test suite unless the user reverses this decision.
