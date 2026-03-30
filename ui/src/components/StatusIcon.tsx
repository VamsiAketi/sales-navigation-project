import { useState } from "react";
import { cn } from "../lib/utils";
import { issueStatusIcon, issueStatusIconDefault } from "../lib/status-colors";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import type { ProjectIssueStatus } from "@paperclipai/shared";

const defaultStatuses = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled", "blocked"];

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

interface StatusIconProps {
  status: string;
  onChange?: (status: string) => void;
  className?: string;
  showLabel?: boolean;
  /** When provided, the popover lists these custom statuses instead of the defaults */
  projectStatuses?: ProjectIssueStatus[];
}

export function StatusIcon({ status, onChange, className, showLabel, projectStatuses }: StatusIconProps) {
  const [open, setOpen] = useState(false);

  // Resolve color: custom hex from project statuses, else Tailwind class from map
  const customStatus = projectStatuses?.find((s) => s.value === status);
  const tailwindClass = issueStatusIcon[status] ?? issueStatusIconDefault;
  const isDone = status === "done" || customStatus?.value === "done";

  const circle = customStatus ? (
    <span
      className={cn("relative inline-flex h-4 w-4 rounded-full border-2 shrink-0", onChange && !showLabel && "cursor-pointer", className)}
      style={{ borderColor: customStatus.color, color: customStatus.color }}
    >
      {isDone && <span className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-current" />}
    </span>
  ) : (
    <span
      className={cn("relative inline-flex h-4 w-4 rounded-full border-2 shrink-0", tailwindClass, onChange && !showLabel && "cursor-pointer", className)}
    >
      {isDone && <span className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-current" />}
    </span>
  );

  const label = customStatus?.name ?? statusLabel(status);

  if (!onChange) {
    return showLabel ? <span className="inline-flex items-center gap-1.5">{circle}<span className="text-sm">{label}</span></span> : circle;
  }

  const trigger = showLabel ? (
    <button className="inline-flex items-center gap-1.5 cursor-pointer hover:bg-accent/50 rounded px-1 -mx-1 py-0.5 transition-colors">
      {circle}
      <span className="text-sm">{label}</span>
    </button>
  ) : circle;

  // Build the list to show in the dropdown
  const listItems: Array<{ value: string; name: string; color?: string; isTailwind: boolean }> = projectStatuses
    ? projectStatuses.filter((s) => s.isActive).map((s) => ({ value: s.value, name: s.name, color: s.color, isTailwind: false }))
    : defaultStatuses.map((s) => ({ value: s, name: statusLabel(s), isTailwind: true }));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-44 p-1" align="start">
        {listItems.map((s) => (
          <Button
            key={s.value}
            variant="ghost"
            size="sm"
            className={cn("w-full justify-start gap-2 text-xs", s.value === status && "bg-accent")}
            onClick={() => { onChange(s.value); setOpen(false); }}
          >
            {s.isTailwind ? (
              <span className={cn("relative inline-flex h-4 w-4 rounded-full border-2 shrink-0", issueStatusIcon[s.value] ?? issueStatusIconDefault)}>
                {s.value === "done" && <span className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-current" />}
              </span>
            ) : (
              <span
                className="relative inline-flex h-4 w-4 rounded-full border-2 shrink-0"
                style={{ borderColor: s.color, color: s.color }}
              >
                {s.value === "done" && <span className="absolute inset-0 m-auto h-2 w-2 rounded-full bg-current" />}
              </span>
            )}
            {s.name}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
