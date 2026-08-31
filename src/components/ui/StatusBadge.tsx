import { AlertTriangle, Clock, Loader2 } from "lucide-react";

type StatusBadgeProps = Readonly<{ status: string }>;

export function StatusBadge({ status }: StatusBadgeProps) {
  return (
    <span className={`status-badge status-${status.replaceAll("_", "-")}`}>
      {status === "running" ? <Loader2 size={12} className="spin" /> : null}
      {status === "queued" ? <Clock size={12} /> : null}
      {status === "changes_requested" ? <AlertTriangle size={12} /> : null}
      {status.replaceAll("_", " ")}
    </span>
  );
}
