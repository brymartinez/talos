type StatusBadgeProps = Readonly<{ status: string }>;

export function StatusBadge({ status }: StatusBadgeProps) {
  return <span className={`status-badge status-${status.replaceAll("_", "-")}`}>{status.replaceAll("_", " ")}</span>;
}
