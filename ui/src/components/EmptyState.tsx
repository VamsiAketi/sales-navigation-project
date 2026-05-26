import { Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  icon: LucideIcon;
  message: string;
  description?: string;
  action?: string;
  onAction?: () => void;
  compact?: boolean;
}

export function EmptyState({
  icon: Icon,
  message,
  description,
  action,
  onAction,
  compact = false,
}: EmptyStateProps) {
  if (compact) {
    return (
      <div className="flex items-start gap-3 rounded-lg border border-dashed border-border/80 bg-muted/15 px-4 py-3.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground/70" />
        <div className="min-w-0 text-left">
          <p className="text-sm text-muted-foreground">{message}</p>
          {description ? <p className="mt-0.5 text-xs text-muted-foreground/80">{description}</p> : null}
          {action && onAction ? (
            <Button type="button" variant="link" size="sm" className="mt-1 h-auto px-0" onClick={onAction}>
              {action}
            </Button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-4 bg-muted/50 p-4">
        <Icon className="h-10 w-10 text-muted-foreground/50" />
      </div>
      <p className="mb-4 text-sm text-muted-foreground">{message}</p>
      {description ? <p className="mb-4 -mt-2 max-w-sm text-xs text-muted-foreground/80">{description}</p> : null}
      {action && onAction && (
        <Button onClick={onAction}>
          <Plus className="mr-1.5 h-4 w-4" />
          {action}
        </Button>
      )}
    </div>
  );
}
