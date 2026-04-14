import { cn } from "../lib/utils";
import { statusBadge, statusBadgeDefault } from "../lib/status-colors";
import { azureAgentStatusBadge, azureAgentStatusBadgeDefault } from "../lib/azure-agents-page";

export function StatusBadge({
  status,
  variant = "default",
}: {
  status: string;
  variant?: "default" | "azure";
}) {
  const palette =
    variant === "azure"
      ? (azureAgentStatusBadge[status] ?? azureAgentStatusBadgeDefault)
      : (statusBadge[status] ?? statusBadgeDefault);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0",
        variant === "azure" && "rounded-sm border border-black/[0.04] dark:border-white/[0.08]",
        palette,
      )}
    >
      {status.replace("_", " ")}
    </span>
  );
}
