"use client";

import { Check, Copy, ExternalLink, RotateCcw, Square, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { displayedRunStatus, type WorkCardData } from "@/src/components/board/types";
import { ResultDetails } from "./ResultDetails";
import { StatusBadge } from "@/src/components/ui/StatusBadge";
import { changeTypeSchema, changeTypes, type ChangeType } from "@/src/domain/types";

const changeTypeLabels: Readonly<Record<ChangeType, string>> = {
  feat: "Feature",
  fix: "Bug fix",
  refactor: "Refactor",
  perf: "Performance",
  docs: "Documentation",
  test: "Tests",
  build: "Build",
  ci: "CI",
  chore: "Chore",
};

async function action(url: string, method = "POST", body?: unknown): Promise<void> {
  const response = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (!response.ok) throw new Error(((await response.json()) as { error?: { message?: string } }).error?.message ?? "Action failed");
}

export function CardDrawer({ card, onClose, onChanged }: Readonly<{ card: WorkCardData; onClose: () => void; onChanged: () => void }>) {
  const [agent, setAgent] = useState(card.workAgent);
  const [changeTypeOverride, setChangeType] = useState<ChangeType | "">();
  const changeType = changeTypeOverride ?? card.changeType ?? "";
  const [message, setMessage] = useState("");
  const [detailsSaved, setDetailsSaved] = useState(false);
  const [copied, setCopied] = useState("");
  const [prCopied, setPrCopied] = useState(false);
  const latest = card.runs[0];
  const active = latest?.status === "queued" || latest?.status === "running";
  const canChangeAgent = card.stage === "backlog" || (
    card.stage === "planning" && ["failed", "interrupted", "cancelled"].includes(latest ? displayedRunStatus(latest) : "")
  );
  const canChangeType = card.stage === "backlog" || card.stage === "planning";
  const draft = card.runs.filter(item => item.stage === "building")
    .flatMap(item => [...item.reports.filter(report => report.applied).map(report => report.result), ...(item.result ? [item.result] : [])])
    .find(result => result.outcome === "succeeded" && (result.prTitle || result.prDescription));
  useEffect(() => { document.getElementById("drawer-close")?.focus(); }, []);
  const run = async (operation: () => Promise<void>): Promise<void> => {
    setMessage("");
    try { await operation(); onChanged(); } catch (error) { setMessage(error instanceof Error ? error.message : "Action failed"); }
  };
  const copyContinuation = async (kind: "command" | "instructions"): Promise<void> => {
    const response = await fetch(`/api/cards/${card.id}/continue`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message ?? "Session could not be prepared");
    await navigator.clipboard.writeText(data[kind]);
    setCopied(kind);
    setTimeout(() => setCopied(""), 2_000);
  };
  const copyPrDraft = async (text: string): Promise<void> => {
    await navigator.clipboard.writeText(text);
    setPrCopied(true);
    setTimeout(() => setPrCopied(false), 2_000);
  };
  return (
    <div className="drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside className="card-drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
        <header><div><p className="eyebrow">{card.repository} · #{card.number}</p><h2 id="drawer-title">{card.title}</h2></div><button id="drawer-close" className="icon-button" type="button" onClick={onClose} aria-label="Close details"><X /></button></header>
        <a className="github-link" href={card.url} target="_blank" rel="noreferrer">Open on GitHub <ExternalLink size={15} /></a>
        <p className="drawer-body">{card.body || "No description."}</p>
        <label className="field"><span>Work agent</span><select value={agent} disabled={!canChangeAgent} onChange={(event) => {
          const value = event.currentTarget.value;
          if (value === "codex" || value === "claude") setAgent(value);
        }}><option value="codex">Codex</option><option value="claude">Claude Code</option></select></label>
        <label className="field"><span>Change type</span><select value={changeType} disabled={!canChangeType} onChange={(event) => {
          const parsed = changeTypeSchema.safeParse(event.currentTarget.value);
          setChangeType(parsed.success ? parsed.data : "");
        }}><option value="">Select a change type</option>{changeTypes.map((type) => (
          <option key={type} value={type}>{changeTypeLabels[type]} ({type})</option>
        ))}</select></label>
        {canChangeAgent || canChangeType ? <button className="primary-button" type="button" onClick={() => run(async () => {
          await action(`/api/cards/${card.id}`, "PATCH", {
            ...(canChangeAgent ? { workAgent: agent } : {}),
            ...(canChangeType ? { changeType: changeType || null } : {}),
          });
          setDetailsSaved(true);
          setTimeout(() => setDetailsSaved(false), 2_000);
        })}>Save details</button> : null}
        {detailsSaved ? <p className="notes-saved" role="status">Saved</p> : null}
        {latest ? <section className="run-panel">
          <div className="run-heading"><h3>Latest {latest.stage}</h3><StatusBadge status={displayedRunStatus(latest)} /></div>
          <p>{latest.reportedOutcome?.result.summary ?? latest.summary}</p>
          <small>{latest.reportedOutcome
            ? `Agent report · ${new Date(latest.reportedOutcome.reportedAt).toLocaleString()}`
            : `Board run · ${new Date(latest.finishedAt ?? latest.createdAt).toLocaleString()}`}</small>
          {latest.reportedOutcome ? <p className="run-session-id">Last reported outcome; external session activity is unknown.</p> : null}
          {latest.errorMessage ? <p className="action-error">Board run: {latest.errorMessage}</p> : null}
          {latest.sessionId ? <p className="run-session-id">Session <code>{latest.sessionId}</code></p> : null}
          {latest.sessionId && card.worktreePath && latest.stage === card.stage && !["cancelled", "interrupted"].includes(latest.status) ? <div className="run-section">
            <h4>Continue session</h4>
            <p>Continue in your agent. Each reply can report its outcome here.</p>
            <div className="drawer-actions">
              <button type="button" disabled={active} onClick={() => run(() => copyContinuation("command"))}>
                {copied === "command" ? <Check size={14} /> : <Copy size={14} />} {copied === "command" ? "Copied" : "Copy terminal command"}
              </button>
              <button type="button" disabled={active} onClick={() => run(() => copyContinuation("instructions"))}>
                {copied === "instructions" ? <Check size={14} /> : <Copy size={14} />} {copied === "instructions" ? "Copied" : "Copy instructions for open session"}
              </button>
            </div>
            {active ? <p>Wait for the board run to finish before continuing elsewhere.</p> : null}
          </div> : null}
        </section> : null}
        {draft ? <section className="run-panel">
          <div className="run-heading">
            <h3>Draft pull request</h3>
            <button
              type="button"
              className="copy-button"
              aria-label="Copy PR title and description"
              onClick={() => copyPrDraft([draft.prTitle, draft.prDescription].filter(Boolean).join("\n\n"))}
            >
              {prCopied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          </div>
          {draft.prTitle ? <div className="run-section"><h4>Title</h4><p>{draft.prTitle}</p></div> : null}
          {draft.prDescription ? <div className="run-section"><h4>Description</h4><pre>{draft.prDescription}</pre></div> : null}
        </section> : null}
        {card.runs.length ? <section className="run-panel"><h3>History</h3><ol className="run-history">{card.runs.map((item) => <li key={item.id}>
          <h4>{item.stage} with {item.provider === "claude" ? "Claude Code" : "Codex"}</h4>
          {item.reports.map(report => <details key={report.id}>
            <summary><StatusBadge status={report.result.outcome} /> {report.result.summary}</summary>
            <small>Agent report · {new Date(report.reportedAt).toLocaleString()}</small>
            {!report.applied ? <p className="card-warning">Not applied: {report.ignoredReason}</p> : null}
            <ResultDetails result={report.result} />
          </details>)}
          <details>
            <summary><StatusBadge status={item.status} /> {item.summary ?? item.errorMessage ?? "Board run"}</summary>
            <small>Board run · {new Date(item.finishedAt ?? item.createdAt).toLocaleString()}</small>
            {item.sessionId ? <p className="run-session-id">Session <code>{item.sessionId}</code></p> : null}
            {item.errorMessage ? <p className="action-error">{item.errorMessage}</p> : null}
            <ResultDetails result={item.result} />
            {item.logUrl ? <a href={item.logUrl} target="_blank">Open log</a> : null}
          </details>
        </li>)}</ol></section> : null}
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
