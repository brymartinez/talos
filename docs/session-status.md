# Session outcome reports

Approved direction: continue conversations in Codex or Claude Code and report fixed outcomes back to the board.

The agent reports Ready, Needs input, Blocked, or Changes requested, with a short reason and any useful result details. Reports describe work outcomes; they do not prove the session is running or connected. Card stages remain explicit, and GitHub closure or merging still controls Done.

A generated local command saves a report beside the run's guard files. It survives the board being closed. The worker imports reports into SQLite and keeps report history. Reports from old runs or stages cannot replace the current outcome. Duplicate imports must have no effect.

Initial prompts include reporting instructions. Existing sessions receive the same instructions through the card's continuation action, with a copyable alternative for a session already open in an agent UI. The board shows the latest reported outcome, when it was reported, and expandable results in history.

The command is bound to one run and stage. It accepts report data, not arbitrary card IDs or database changes. It never moves cards. Provider hooks and interpretation of ordinary chat text are outside this change.

Two delivery designs were considered. An HTTP callback needs a running server and offline retries. A local report file works while the board is closed and uses the run directory already permitted by the existing agent sandbox.
