"use client";

import { RefreshCw, Search } from "lucide-react";

export function FilterBar({
  repositories, repository, query, busy, onRepository, onQuery, onSync,
}: Readonly<{
  repositories: readonly string[]; repository: string; query: string; busy: boolean;
  onRepository: (value: string) => void; onQuery: (value: string) => void; onSync: () => void;
}>) {
  return (
    <div className="filter-bar">
      <label className="search-field"><Search size={16} /><span className="sr-only">Search cards</span><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search work" /></label>
      <label><span className="sr-only">Repository</span><select value={repository} onChange={(event) => onRepository(event.target.value)}><option value="">All repositories</option>{repositories.map((name) => <option key={name}>{name}</option>)}</select></label>
      <button className="primary-button" type="button" onClick={onSync} disabled={busy}><RefreshCw size={16} className={busy ? "spinning" : ""} />{busy ? "Syncing" : "Sync GitHub"}</button>
    </div>
  );
}
