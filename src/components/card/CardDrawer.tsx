"use client";

import { ExternalLink, RotateCcw, Square, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import type { WorkCardData } from "@/src/components/board/types";
import { StatusBadge } from "@/src/components/ui/StatusBadge";

async function action(url: string, method = "POST", body?: unknown): Promise<void> {
  const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(((await response.json()) as { error?: { message?: string } }).error?.message ?? "Action failed");
}

export function CardDrawer({ card, onClose, onChanged }: Readonly<{ card: WorkCardData; onClose: () => void; onChanged: () => void }>) {
  const [notes, setNotes] = useState(card.notes);
  const [agent, setAgent] = useState(card.workAgent);
  const [message, setMessage] = useState("");
  const latest = card.runs[0];
  useEffect(() => { document.getElementById("drawer-close")?.focus(); }, []);
  const run = async (operation: () => Promise<void>): Promise<void> => {
    setMessage("");
    try { await operation(); onChanged(); } catch (error) { setMessage(error instanceof Error ? error.message : "Action failed"); }
  };
  const result = latest?.result;
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="card-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header><div><p className="eyebrow">{card.repository} · #{card.number}</p><h2 id="drawer-title">{card.title}</h2></div><button id="drawer-close" className="icon-button" type="button" onClick={onClose} aria-label="Close details"><X /></button></header>
        <a className="github-link" href={card.url} target="_blank" rel="noreferrer">Open on GitHub <ExternalLink size={15} /></a>
        <p className="drawer-body">{card.body || "No description."}</p>
        <label className="field"><span>Senior engineer notes</span><textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <label className="field"><span>Work agent</span><select value={agent} disabled={card.stage !== "backlog"} onChange={(event) => setAgent(event.target.value as "codex" | "claude")}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
        <button className="primary-button" type="button" onClick={() => run(() => action(`/api/cards/${card.id}`, "PATCH", { notes, workAgent: agent }))}>Save notes</button>
        {latest ? <section className="run-panel"><div className="run-heading"><h3>Latest {latest.stage}</h3><StatusBadge status={latest.status} /></div>{latest.summary ? <p>{latest.summary}</p> : null}{latest.questions.length ? <><h4>Questions</h4><ul>{latest.questions.map((question) => <li key={question}>{question}</li>)}</ul></> : null}{result ? <pre>{JSON.stringify(result, null, 2)}</pre> : null}{latest.logUrl ? <a href={latest.logUrl} target="_blank">Open run log</a> : null}</section> : null}
        <div className="drawer-actions">
          <button type="button" onClick={() => run(() => action(`/api/cards/${card.id}/retry`))}><RotateCcw size={15} />Retry</button>
          <button type="button" onClick={() => run(() => action(`/api/cards/${card.id}/cancel`))}><Square size={15} />Cancel</button>
          <button type="button" onClick={() => run(() => action(`/api/cards/${card.id}/open-vscode`))}>Open in VS Code</button>
          <button className="danger-button" type="button" onClick={() => run(() => action(`/api/cards/${card.id}/worktree`, "DELETE", { force: false }))}><Trash2 size={15} />Delete worktree</button>
        </div>
        {message ? <p className="action-error" role="alert">{message}</p> : null}
      </aside>
    </div>
  );
}
