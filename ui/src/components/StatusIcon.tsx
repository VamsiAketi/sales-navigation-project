import { useState } from "react";
import { cn } from "../lib/utils";
import {
  issueStatusJiraLozenge,
  issueStatusJiraLozengeDefault,
  issueJiraLozengeColorsFromHex,
} from "../lib/status-colors";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { projectIssueStatusRestrictedNextValues, type ProjectIssueStatus } from "@paperclipai/shared";
import { useOptionalTheme } from "../context/ThemeContext";

const defaultStatuses = ["backlog", "todo", "in_progress", "in_review", "done", "cancelled", "blocked"];

export function statusLabel(status: string): string {
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

type LozengeMode = "pill" | "menuRow";

function JiraStatusLozenge({
  statusValue,
  displayName,
  hexColor,
  theme,
  className,
  mode = "pill",
}: {
  statusValue: string;
  displayName: string;
  hexColor?: string | null;
  theme: "light" | "dark";
  className?: string;
  mode?: LozengeMode;
}) {
  const label = displayName.toUpperCase();
  const textStyle = "text-[10px] font-bold uppercase tracking-wide";
  const shape =
    mode === "menuRow"
      ? "block w-full min-w-0 truncate rounded-sm px-2.5 py-2 text-left"
      : "inline-flex max-w-full min-w-0 truncate rounded px-2 py-0.5";

  if (hexColor) {
    const style = issueJiraLozengeColorsFromHex(hexColor, theme);
    if (style) {
      return (
        <span
          className={cn(shape, textStyle, className)}
          style={{ backgroundColor: style.backgroundColor, color: style.color }}
        >
          {label}
        </span>
      );
    }
  }

  const builtInClass = issueStatusJiraLozenge[statusValue] ?? issueStatusJiraLozengeDefault;

  return (
    <span className={cn(shape, textStyle, builtInClass, className)}>
      {label}
    </span>
  );
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
  const theme = useOptionalTheme();

  const customStatus = projectStatuses?.find((s) => s.value === status);
  const label = customStatus?.name ?? statusLabel(status);

  const lozenge = (
    <JiraStatusLozenge
      statusValue={status}
      displayName={label}
      hexColor={customStatus?.color ?? null}
      theme={theme}
      className={className}
      mode="pill"
    />
  );

  if (!onChange) {
    return showLabel ? <span className="inline-flex min-w-0 max-w-full items-center">{lozenge}</span> : lozenge;
  }

  /** No extra border/shadow around the lozenge — the pill already reads as the control. */
  const triggerBase =
    "rounded-md px-1 py-0.5 outline-none transition-colors hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background data-[state=open]:bg-accent/40 data-[state=open]:ring-2 data-[state=open]:ring-primary/25";

  const trigger = showLabel ? (
    <button type="button" className={cn("inline-flex min-w-0 max-w-full cursor-pointer items-center", triggerBase)}>
      {lozenge}
    </button>
  ) : (
    <button
      type="button"
      className={cn(
        "inline-flex min-w-0 max-w-[min(100%,11rem)] cursor-pointer items-center",
        triggerBase,
        className,
      )}
    >
      <JiraStatusLozenge
        statusValue={status}
        displayName={label}
        hexColor={customStatus?.color ?? null}
        theme={theme}
        mode="pill"
      />
    </button>
  );

  const fromMeta = projectStatuses?.find((s) => s.value === status);
  const restrictedNext = projectIssueStatusRestrictedNextValues(fromMeta);

  const listItems: Array<{ value: string; name: string; color?: string; isTailwind: boolean }> = projectStatuses
    ? (() => {
        if (restrictedNext) {
          const byValue = new Map(projectStatuses.map((s) => [s.value, s]));
          return restrictedNext.map((value) => {
            const row = byValue.get(value);
            return row
              ? { value: row.value, name: row.name, color: row.color, isTailwind: false as const }
              : { value, name: statusLabel(value), isTailwind: true as const };
          });
        }
        return projectStatuses
          .filter((s) => s.isActive)
          .map((s) => ({ value: s.value, name: s.name, color: s.color, isTailwind: false as const }));
      })()
    : defaultStatuses.map((s) => ({ value: s, name: statusLabel(s), isTailwind: true }));

  const selectableItems = listItems.filter((s) => s.value !== status);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-64 p-1 shadow-md"
      >
        {selectableItems.length === 0 ? (
          <p className="px-3 py-3 text-center text-xs leading-snug text-muted-foreground">
            No other statuses to switch to.
          </p>
        ) : (
          <div className="flex flex-col gap-0.5" role="listbox" aria-label="Change status">
            {selectableItems.map((s) => (
              <button
                key={s.value}
                type="button"
                role="option"
                aria-selected={false}
                className={cn(
                  "w-full rounded-md border border-transparent p-0.5 text-left outline-none transition-[background-color,border-color,box-shadow]",
                  "hover:border-primary/25 hover:bg-primary/8 dark:hover:bg-primary/15",
                  "focus-visible:border-primary/40 focus-visible:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
                )}
                onClick={() => {
                  onChange(s.value);
                  setOpen(false);
                }}
              >
                <JiraStatusLozenge
                  statusValue={s.value}
                  displayName={s.name}
                  hexColor={!s.isTailwind ? s.color : undefined}
                  theme={theme}
                  mode="menuRow"
                />
              </button>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
