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
  const canChangeAgent = card.stage === "backlog" || (
    card.stage === "planning" && ["failed", "interrupted", "cancelled"].includes(latest?.status ?? "")
  );
  const draft = card.runs.find((run) => run.result?.prTitle || run.result?.prDescription)?.result;
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
        <label className="field"><span>Work agent</span><select value={agent} disabled={!canChangeAgent} onChange={(event) => {
          const value = event.currentTarget.value;
          if (value === "codex" || value === "claude") setAgent(value);
        }}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
        <button className="primary-button" type="button" onClick={() => run(() => action(`/api/cards/${card.id}`, "PATCH", { notes, workAgent: agent }))}>Save notes</button>
        {latest ? <section className="run-panel">
          <div className="run-heading"><h3>Latest {latest.stage}</h3><StatusBadge status={latest.status} /></div>
          {latest.summary ? <p>{latest.summary}</p> : null}
          {latest.errorMessage ? <p className="action-error">{latest.errorMessage}</p> : null}
          {latest.questions.length ? <div className="run-section"><h4>Questions</h4><ul>{latest.questions.map((question) => <li key={question}>{question}</li>)}</ul></div> : null}
          {result?.plan.length ? <div className="run-section"><h4>Plan</h4><ul>{result.plan.map((item) => <li key={`${item.file}-${item.change}`}><code>{item.file}</code> {item.change}</li>)}</ul></div> : null}
          {result?.changedFiles.length ? <div className="run-section"><h4>Changed files</h4><ul>{result.changedFiles.map((file) => <li key={file}><code>{file}</code></li>)}</ul></div> : null}
          {result?.checks.length ? <div className="run-section"><h4>Checks</h4><ul>{result.checks.map((check) => <li key={`${check.command}-${check.result}`}><code>{check.command}</code> {check.result}</li>)}</ul></div> : null}
          {result?.findings.length ? <div className="run-section"><h4>Review findings</h4><ul>{result.findings.map((finding) => <li key={finding}>{finding}</li>)}</ul></div> : null}
          {result?.verdict ? <div className="run-section"><h4>Verdict</h4><p>{result.verdict}</p></div> : null}
          {latest.logUrl ? <a href={latest.logUrl} target="_blank">Open run log</a> : null}
        </section> : null}
        {draft ? <section className="run-panel"><h3>Draft pull request</h3>{draft.prTitle ? <div className="run-section"><h4>Title</h4><p>{draft.prTitle}</p></div> : null}{draft.prDescription ? <div className="run-section"><h4>Description</h4><pre>{draft.prDescription}</pre></div> : null}</section> : null}
        {card.runs.length ? <section className="run-panel"><h3>Run history</h3><ol className="run-history">{card.runs.map((item) => <li key={item.id}><div className="run-heading"><span>{item.stage} with {item.provider === "claude" ? "Claude Code" : "Codex"}</span><StatusBadge status={item.status} /></div>{item.summary ? <p>{item.summary}</p> : null}{item.errorMessage ? <p className="action-error">{item.errorMessage}</p> : null}<small>{new Date(item.createdAt).toLocaleString()}</small>{item.logUrl ? <a href={item.logUrl} target="_blank">Open log</a> : null}</li>)}</ol></section> : null}
        <div className="drawer-actions">
          <button type="button" onClick={() => run(() => action(`/api/cards/${card.id}/retry`))}><RotateCcw size={15} />Retry</button>
          <button type="button" onClick={() => run(() => action(`/api/cards/${card.id}/cancel`))}><Square size={15} />Cancel</button>
          {card.stage === "building" || card.stage === "review" ? <button type="button" onClick={() => run(() => action(`/api/cards/${card.id}/open-vscode`))}>Open in VS Code</button> : null}
          <button className="danger-button" type="button" onClick={() => run(() => action(`/api/cards/${card.id}/worktree`, "DELETE", { force: false }))}><Trash2 size={15} />Delete worktree</button>
        </div>
        {message ? <p className="action-error" role="alert">{message}</p> : null}
      </aside>
    </div>
  );
}
