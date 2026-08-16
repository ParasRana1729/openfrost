export type StatusBadgeProps = {
  label: string;
  tone?: "neutral" | "success" | "warning";
};

export function getStatusBadgeClassName(tone: StatusBadgeProps["tone"] = "neutral"): string {
  switch (tone) {
    case "success":
      return "openfrost-badge openfrost-badge--success";
    case "warning":
      return "openfrost-badge openfrost-badge--warning";
    default:
      return "openfrost-badge openfrost-badge--neutral";
  }
}

export function formatStatusLabel(label: string): string {
  return label.trim();
}
