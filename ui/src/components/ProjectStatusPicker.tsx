import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "../lib/utils";
import { statusBadge, statusBadgeDefault } from "../lib/status-colors";

const PROJECT_STATUS_OPTIONS = [
  { value: "backlog", label: "Backlog" },
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

export function ProjectStatusPicker({
  status,
  onChange,
  disabled,
}: {
  status: string;
  onChange: (status: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const colorClass = statusBadge[status] ?? statusBadgeDefault;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap shrink-0 cursor-pointer hover:opacity-80 transition-opacity disabled:pointer-events-none disabled:opacity-50",
            colorClass,
          )}
        >
          {status.replace("_", " ")}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-40 p-1" align="start">
        {PROJECT_STATUS_OPTIONS.map((s) => (
          <Button
            key={s.value}
            variant="ghost"
            size="sm"
            className={cn("w-full justify-start gap-2 text-xs", s.value === status && "bg-accent")}
            onClick={() => {
              onChange(s.value);
              setOpen(false);
            }}
          >
            {s.label}
          </Button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
