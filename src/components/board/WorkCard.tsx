"use client";
/* eslint-disable react-hooks/refs -- dnd-kit exposes reactive drag state and callback refs from this hook. */

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Bot, CircleDot, Code2, GitPullRequest, LockKeyhole } from "lucide-react";

import type { WorkCardData } from "@/src/components/board/types";
import { StatusBadge } from "@/src/components/ui/StatusBadge";

function openVsCode(cardId: string): void {
  void fetch(`/api/cards/${cardId}/open-vscode`, { method: "POST" });
}

export function WorkCard({ card, onOpen }: Readonly<{ card: WorkCardData; onOpen: () => void }>) {
  const activeRun = card.runs[0];
  const locked = activeRun?.status === "queued" || activeRun?.status === "running";
  const canOpenEditor = card.stage === "building" || card.stage === "review";
  const sortable = useSortable({ id: card.id, data: { card }, disabled: locked || card.stage === "done" });
  return (
    <article
      ref={sortable.setNodeRef}
      style={{ transform: CSS.Transform.toString(sortable.transform), transition: sortable.transition }}
      className={`work-card${sortable.isDragging ? " dragging" : ""}`}
      {...sortable.attributes}
      {...sortable.listeners}
    >
      <button className="card-open" type="button" onClick={onOpen} aria-label={`Open ${card.title}`}>
        <span className="card-repository">{card.repository} · #{card.number}</span>
        <strong>{card.title}</strong>
      </button>
      <div className="card-meta">
        <span>{card.itemType === "pull_request" ? <GitPullRequest size={14} /> : <CircleDot size={14} />}{card.itemType === "pull_request" ? "PR" : "Issue"}</span>
        <span><Bot size={14} />{card.workAgent}</span>
        {locked ? <LockKeyhole size={14} aria-label="Agent work is active" /> : null}
      </div>
      <div className="reason-list">
        {card.matchReasons.slice(0, 2).map((reason) => <span key={reason}>{reason.replaceAll("_", " ")}</span>)}
      </div>
      {card.noLongerAssigned ? <p className="card-warning">No longer assigned</p> : null}
      <div className="card-footer">
        {activeRun ? <StatusBadge status={activeRun.status} /> : null}
        {canOpenEditor ? (
          <button
            className="card-editor-link"
            type="button"
            onClick={(event) => { event.stopPropagation(); openVsCode(card.id); }}
            aria-label={`Open ${card.title} in VS Code`}
          >
            <Code2 size={13} /> Open in editor
          </button>
        ) : null}
      </div>
    </article>
  );
}
