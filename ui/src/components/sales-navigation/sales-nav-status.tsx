import { useState } from "react";
import {
  SALES_NAV_CONTACT_STATUSES,
  SALES_NAV_STATUS_LABELS,
  type SalesNavContactStatus,
} from "@paperclipai/shared";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const STATUS_BADGE_CLASS: Record<SalesNavContactStatus, string> = {
  not_contacted:
    "border-border/80 bg-muted/40 text-muted-foreground dark:bg-muted/30",
  unverified:
    "border-border/80 bg-muted/60 text-muted-foreground dark:bg-muted/40",
  verified:
    "border-emerald-500/35 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200",
  connected:
    "border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200",
  outreach_sent:
    "border-sky-500/35 bg-sky-500/15 text-sky-900 dark:text-sky-100",
  contacted:
    "border-sky-500/35 bg-sky-500/15 text-sky-900 dark:text-sky-100",
  meeting_scheduled:
    "border-violet-500/35 bg-violet-500/15 text-violet-900 dark:text-violet-100",
  warm_intro_complete:
    "border-amber-500/35 bg-amber-500/15 text-amber-900 dark:text-amber-100",
  in_progress:
    "border-blue-500/35 bg-blue-500/15 text-blue-900 dark:text-blue-100",
  in_discussion:
    "border-indigo-500/35 bg-indigo-500/15 text-indigo-900 dark:text-indigo-100",
  converted:
    "border-emerald-700/40 bg-emerald-700/20 text-emerald-950 dark:text-emerald-50",
  closed_won:
    "border-emerald-600/40 bg-emerald-600/20 text-emerald-950 dark:text-emerald-50",
  closed_lost:
    "border-red-500/35 bg-red-500/15 text-red-900 dark:text-red-100",
};

export function SalesNavStatusBadge({
  status,
  className,
}: {
  status: SalesNavContactStatus;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-md px-2 py-0.5 text-[11px] font-semibold",
        STATUS_BADGE_CLASS[status],
        className,
      )}
    >
      {SALES_NAV_STATUS_LABELS[status]}
    </Badge>
  );
}

export function SalesNavStatusSelect({
  value,
  onChange,
  disabled = false,
  className,
}: {
  value: SalesNavContactStatus;
  onChange: (status: SalesNavContactStatus) => void;
  disabled?: boolean;
  className?: string;
}) {
  if (disabled) {
    return <SalesNavStatusBadge status={value} className={className} />;
  }

  const [open, setOpen] = useState(false);

  return (
    <Select
      value={value}
      onValueChange={(next) => onChange(next as SalesNavContactStatus)}
      open={open}
      onOpenChange={setOpen}
    >
      <SelectTrigger
        className={cn(
          "h-auto w-full justify-between gap-2 border-border/70 bg-background px-2 py-1.5 shadow-none",
          className,
        )}
        aria-label="Engagement status"
      >
        <SalesNavStatusBadge status={value} />
      </SelectTrigger>
      <SelectContent
        position="popper"
        side="bottom"
        align="start"
        sideOffset={6}
        className="z-[9999] min-w-[var(--radix-select-trigger-width)]"
      >
        {SALES_NAV_CONTACT_STATUSES.map((status) => (
          <SelectItem key={status} value={status} className="py-2">
            <SalesNavStatusBadge status={status} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
