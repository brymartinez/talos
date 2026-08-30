import { Bot, CircleDot, GitPullRequest, LockKeyhole } from "lucide-react";

import type { WorkCardData } from "@/src/components/board/types";
import { StatusBadge } from "@/src/components/ui/StatusBadge";

export function WorkCardPreview({ card }: Readonly<{ card: WorkCardData }>) {
  const activeRun = card.runs[0];
  const locked = activeRun?.status === "queued" || activeRun?.status === "running";
  return (
    <article className="work-card overlay">
      <div className="card-open">
        <span className="card-repository">{card.repository} · #{card.number}</span>
        <strong>{card.title}</strong>
      </div>
      <div className="card-meta">
        <span>{card.itemType === "pull_request" ? <GitPullRequest size={14} /> : <CircleDot size={14} />}{card.itemType === "pull_request" ? "PR" : "Issue"}</span>
        <span><Bot size={14} />{card.workAgent}</span>
        {locked ? <LockKeyhole size={14} aria-label="Agent work is active" /> : null}
      </div>
      <div className="reason-list">
        {card.matchReasons.slice(0, 2).map((reason) => <span key={reason}>{reason.replaceAll("_", " ")}</span>)}
      </div>
      {card.noLongerAssigned ? <p className="card-warning">No longer assigned</p> : null}
      {activeRun ? <StatusBadge status={activeRun.status} /> : null}
    </article>
  );
}
