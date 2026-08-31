"use client";

import { RefreshCw, Search } from "lucide-react";

export function FilterBar({
  repositories, repository, query, itemType, reason, status, busy, onFilter, onSync,
}: Readonly<{
  repositories: readonly string[]; repository: string; query: string; itemType: string;
  reason: string; status: string; busy: boolean;
  onFilter: (name: string, value: string) => void; onSync: () => void;
}>) {
  return (
    <div className="filter-bar">
      <label className="search-field"><Search size={16} /><span className="sr-only">Search cards</span><input value={query} onChange={(event) => onFilter("query", event.target.value)} placeholder="Search work" /></label>
      <label><span className="sr-only">Repository</span><select value={repository} onChange={(event) => onFilter("repository", event.target.value)}><option value="">All repositories</option>{repositories.map((name) => <option key={name}>{name}</option>)}</select></label>
      <label><span className="sr-only">Item type</span><select value={itemType} onChange={(event) => onFilter("type", event.target.value)}><option value="">Issues and PRs</option><option value="issue">Issues</option><option value="pull_request">Pull requests</option></select></label>
      <label><span className="sr-only">Match reason</span><select value={reason} onChange={(event) => onFilter("reason", event.target.value)}><option value="">All reasons</option><option value="assigned">Assigned</option><option value="authored">Authored</option><option value="review_requested">Review requested</option><option value="team_review_requested">Team review</option><option value="mentioned">Mentioned</option></select></label>
      <label><span className="sr-only">Agent status</span><select value={status} onChange={(event) => onFilter("status", event.target.value)}><option value="">All statuses</option><option value="queued">Queued</option><option value="running">Running</option><option value="needs_input">Needs input</option><option value="changes_requested">Changes requested</option><option value="failed">Failed</option><option value="succeeded">Succeeded</option></select></label>
      <button className="primary-button" type="button" onClick={onSync} disabled={busy}><RefreshCw size={16} className={busy ? "spinning" : ""} />{busy ? "Syncing" : "Sync GitHub"}</button>
    </div>
  );
}
