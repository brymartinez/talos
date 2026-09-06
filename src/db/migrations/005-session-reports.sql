CREATE TABLE agent_runs_new (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
  stage TEXT NOT NULL CHECK (stage IN ('planning', 'building', 'review')),
  provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'needs_input', 'blocked', 'changes_requested', 'cancelled', 'interrupted')),
  summary TEXT,
  result_json TEXT,
  questions_json TEXT,
  error_message TEXT,
  log_path TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO agent_runs_new SELECT * FROM agent_runs;
DROP TABLE agent_runs;
ALTER TABLE agent_runs_new RENAME TO agent_runs;
CREATE INDEX agent_runs_card_created_idx ON agent_runs(card_id, created_at DESC);
CREATE INDEX agent_runs_status_idx ON agent_runs(status);
CREATE UNIQUE INDEX agent_runs_one_active_card_idx
  ON agent_runs(card_id)
  WHERE status IN ('queued', 'running');

CREATE TABLE session_reporters (
  run_id TEXT PRIMARY KEY REFERENCES agent_runs(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES agent_sessions(id) ON DELETE CASCADE,
  provider_session_id TEXT,
  token TEXT NOT NULL
);

CREATE TABLE session_reports (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  result_json TEXT NOT NULL,
  reported_at TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  applied INTEGER NOT NULL CHECK (applied IN (0, 1)),
  ignored_reason TEXT
);
CREATE INDEX session_reports_run_time_idx ON session_reports(run_id, reported_at DESC, id DESC);

PRAGMA user_version = 5;
