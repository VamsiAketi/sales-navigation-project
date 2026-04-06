import { useEffect, useState } from "react";
import { Link } from "@/lib/router";
import { AlertTriangle, CheckCircle2, Info, OctagonX, X } from "lucide-react";
import { useToast, type ToastItem, type ToastTone } from "../context/ToastContext";
import { cn } from "../lib/utils";

const toneClasses: Record<ToastTone, string> = {
  info: "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-500/25 dark:bg-sky-950/60 dark:text-sky-100",
  success: "border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-500/25 dark:bg-emerald-950/60 dark:text-emerald-100",
  warn: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/25 dark:bg-amber-950/60 dark:text-amber-100",
  error: "border-red-300 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-950/60 dark:text-red-100",
};

const toneIconClasses: Record<ToastTone, string> = {
  info: "text-sky-600 dark:text-sky-300",
  success: "text-emerald-600 dark:text-emerald-300",
  warn: "text-amber-600 dark:text-amber-300",
  error: "text-red-600 dark:text-red-300",
};

function ToastToneIcon({ tone, className }: { tone: ToastTone; className?: string }) {
  const iconClass = cn("h-5 w-5 shrink-0", toneIconClasses[tone], className);
  switch (tone) {
    case "success":
      return <CheckCircle2 className={iconClass} aria-hidden />;
    case "warn":
      return <AlertTriangle className={iconClass} aria-hidden />;
    case "error":
      return <OctagonX className={iconClass} aria-hidden />;
    default:
      return <Info className={iconClass} aria-hidden />;
  }
}

function AnimatedToast({
  toast,
  onDismiss,
}: {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <li
      className={cn(
        "pointer-events-auto rounded-md border shadow-lg backdrop-blur-xl transition-[transform,opacity] duration-200 ease-out",
        visible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        toneClasses[toast.tone],
      )}
    >
      <div className="flex items-start gap-3 px-3 py-2.5">
        <ToastToneIcon tone={toast.tone} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-5">{toast.title}</p>
          {toast.body && (
            <p className="mt-1 text-xs leading-4 opacity-70">
              {toast.body}
            </p>
          )}
          {toast.action && (
            <Link
              to={toast.action.href}
              onClick={() => onDismiss(toast.id)}
              className="mt-2 inline-flex text-xs font-medium underline underline-offset-4 hover:opacity-90"
            >
              {toast.action.label}
            </Link>
          )}
        </div>
        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={() => onDismiss(toast.id)}
          className="mt-0.5 shrink-0 rounded p-1 opacity-50 hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

export function ToastViewport() {
  const { toasts, dismissToast } = useToast();

  if (toasts.length === 0) return null;

  return (
    <aside
      aria-live="polite"
      aria-atomic="false"
      className="pointer-events-none fixed bottom-4 left-4 top-auto right-auto z-[120] w-[min(100vw-2rem,24rem)] max-w-sm"
    >
      <ol className="flex w-full flex-col-reverse gap-2">
        {toasts.map((toast) => (
          <AnimatedToast
            key={toast.id}
            toast={toast}
            onDismiss={dismissToast}
          />
        ))}
      </ol>
    </aside>
  );
}
