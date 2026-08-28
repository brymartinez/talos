CREATE TABLE repositories (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  full_name TEXT NOT NULL UNIQUE,
  clone_url TEXT NOT NULL,
  ssh_url TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  local_clone_path TEXT,
  last_synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE source_items (
  id TEXT PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
  github_number INTEGER NOT NULL,
  item_type TEXT NOT NULL CHECK (item_type IN ('issue', 'pull_request')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  html_url TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
  merged INTEGER NOT NULL DEFAULT 0 CHECK (merged IN (0, 1)),
  author_login TEXT NOT NULL,
  assignees_json TEXT NOT NULL DEFAULT '[]',
  requested_teams_json TEXT NOT NULL DEFAULT '[]',
  labels_json TEXT NOT NULL DEFAULT '[]',
  head_ref TEXT,
  head_repository TEXT,
  base_ref TEXT,
  github_created_at TEXT NOT NULL,
  github_updated_at TEXT NOT NULL,
  github_closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (repository_id, github_number)
);

CREATE TABLE match_reasons (
  source_item_id TEXT NOT NULL REFERENCES source_items(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (reason IN ('assigned', 'authored', 'review_requested', 'team_review_requested', 'mentioned')),
  PRIMARY KEY (source_item_id, reason)
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  source_item_id TEXT NOT NULL UNIQUE REFERENCES source_items(id) ON DELETE CASCADE,
  stage TEXT NOT NULL CHECK (stage IN ('backlog', 'planning', 'building', 'review', 'done')),
  position REAL NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  notes_updated_at TEXT,
  work_agent TEXT NOT NULL CHECK (work_agent IN ('codex', 'claude')),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  no_longer_assigned INTEGER NOT NULL DEFAULT 0 CHECK (no_longer_assigned IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX cards_stage_position_idx ON cards(stage, archived, position);

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL UNIQUE REFERENCES cards(id) ON DELETE CASCADE,
  repository_path TEXT NOT NULL,
  worktree_path TEXT NOT NULL UNIQUE,
  branch_name TEXT,
  base_commit TEXT NOT NULL,
  checkout_mode TEXT NOT NULL CHECK (checkout_mode IN ('branch', 'detached')),
  before_state_json TEXT,
  after_state_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude')),
  purpose TEXT NOT NULL CHECK (purpose IN ('work', 'review')),
  provider_session_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  session_id TEXT REFERENCES agent_sessions(id) ON DELETE SET NULL,
  stage TEXT NOT NULL CHECK (stage IN ('planning', 'building', 'review')),
  provider TEXT NOT NULL CHECK (provider IN ('codex', 'claude')),
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'needs_input', 'cancelled', 'interrupted')),
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

CREATE INDEX agent_runs_card_created_idx ON agent_runs(card_id, created_at DESC);
CREATE INDEX agent_runs_status_idx ON agent_runs(status);

CREATE TABLE run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX run_events_run_id_idx ON run_events(run_id, id);

CREATE TABLE queue_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('sync_github', 'run_stage', 'open_vscode', 'delete_worktree')),
  card_id TEXT REFERENCES cards(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES agent_runs(id) ON DELETE CASCADE,
  payload_json TEXT NOT NULL DEFAULT '{}',
  state TEXT NOT NULL CHECK (state IN ('pending', 'leased', 'completed', 'failed', 'cancelled', 'interrupted')),
  lease_worker_id TEXT,
  lease_expires_at TEXT,
  cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1)),
  attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX queue_jobs_lease_idx ON queue_jobs(state, created_at);
CREATE INDEX queue_jobs_card_idx ON queue_jobs(card_id, state);

CREATE TABLE refresh_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  repository_count INTEGER NOT NULL DEFAULT 0,
  source_item_count INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE refresh_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  refresh_run_id TEXT NOT NULL REFERENCES refresh_runs(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

PRAGMA user_version = 1;
