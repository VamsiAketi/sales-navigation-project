import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { PERMISSION_DENIED_EVENT } from "../api/client";
import { displayBrandSafe } from "../lib/displayBrandSafe";

export type ToastTone = "info" | "success" | "warn" | "error";

export interface ToastAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface ToastInput {
  id?: string;
  dedupeKey?: string;
  title: string;
  body?: string;
  tone?: ToastTone;
  ttlMs?: number;
  action?: ToastAction;
  secondaryAction?: ToastAction;
}

export interface ToastItem {
  id: string;
  title: string;
  body?: string;
  tone: ToastTone;
  ttlMs: number;
  action?: ToastAction;
  secondaryAction?: ToastAction;
  createdAt: number;
}

interface ToastContextValue {
  toasts: ToastItem[];
  pushToast: (input: ToastInput) => string | null;
  dismissToast: (id: string) => void;
  clearToasts: () => void;
}

const DEFAULT_TTL_BY_TONE: Record<ToastTone, number> = {
  info: 4000,
  success: 3500,
  warn: 8000,
  error: 10000,
};
const MIN_TTL_MS = 1500;
/** Upper bound for custom durations (e.g. task-created toast at 15s). */
const MAX_TTL_MS = 60_000;
const MAX_TOASTS = 5;
const DEDUPE_WINDOW_MS = 3500;
const DEDUPE_MAX_AGE_MS = 20000;

const ToastContext = createContext<ToastContextValue | null>(null);

function normalizeTtl(value: number | undefined, tone: ToastTone) {
  const fallback = DEFAULT_TTL_BY_TONE[tone];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(MIN_TTL_MS, Math.min(MAX_TTL_MS, Math.floor(value)));
}

function generateToastId() {
  return `toast_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef(new Map<string, number>());
  const dedupeRef = useRef(new Map<string, number>());

  const clearTimer = useCallback((id: string) => {
    const handle = timersRef.current.get(id);
    if (handle !== undefined) {
      window.clearTimeout(handle);
      timersRef.current.delete(id);
    }
  }, []);

  const dismissToast = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    },
    [clearTimer],
  );

  const clearToasts = useCallback(() => {
    for (const handle of timersRef.current.values()) {
      window.clearTimeout(handle);
    }
    timersRef.current.clear();
    setToasts([]);
  }, []);

  const pushToast = useCallback(
    (input: ToastInput) => {
      const now = Date.now();
      const tone = input.tone ?? "info";
      const ttlMs = normalizeTtl(input.ttlMs, tone);
      const dedupeKey =
        input.dedupeKey ?? input.id ?? `${tone}|${input.title}|${input.body ?? ""}|${input.action?.href ?? ""}`;

      for (const [key, ts] of dedupeRef.current.entries()) {
        if (now - ts > DEDUPE_MAX_AGE_MS) {
          dedupeRef.current.delete(key);
        }
      }

      const lastSeen = dedupeRef.current.get(dedupeKey);
      if (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS) {
        return null;
      }
      dedupeRef.current.set(dedupeKey, now);

      const id = input.id ?? generateToastId();
      clearTimer(id);

      setToasts((prev) => {
        const safeInput = displayBrandSafe(input);
        const nextToast: ToastItem = {
          id,
          title: safeInput.title,
          body: safeInput.body,
          tone,
          ttlMs,
          action: safeInput.action,
          secondaryAction: safeInput.secondaryAction,
          createdAt: now,
        };

        const withoutCurrent = prev.filter((toast) => toast.id !== id);
        return [nextToast, ...withoutCurrent].slice(0, MAX_TOASTS);
      });

      const timeout = window.setTimeout(() => {
        dismissToast(id);
      }, ttlMs);
      timersRef.current.set(id, timeout);
      return id;
    },
    [clearTimer, dismissToast],
  );

  useEffect(() => () => {
    for (const handle of timersRef.current.values()) {
      window.clearTimeout(handle);
    }
    timersRef.current.clear();
  }, []);

  useEffect(() => {
    const handlePermissionDenied = (event: Event) => {
      const detail =
        event instanceof CustomEvent
          ? (event.detail as { method?: string; path?: string; message?: string } | undefined)
          : undefined;
      const message = (detail?.message ?? "").trim();
      const normalizedMessage = message.toLowerCase();
      const hasSpecificMessage =
        normalizedMessage.length > 0 &&
        normalizedMessage !== "permission denied" &&
        normalizedMessage !== "forbidden";
      pushToast({
        title: "Permission denied",
        body: hasSpecificMessage
          ? message
          : "You do not have permission to perform this action. Contact your administrator.",
        tone: "error",
        dedupeKey: `permission-denied|${detail?.method ?? "UNKNOWN"}|${detail?.path ?? "unknown"}`,
      });
    };
    window.addEventListener(PERMISSION_DENIED_EVENT, handlePermissionDenied);
    return () => window.removeEventListener(PERMISSION_DENIED_EVENT, handlePermissionDenied);
  }, [pushToast]);

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      pushToast,
      dismissToast,
      clearToasts,
    }),
    [toasts, pushToast, dismissToast, clearToasts],
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}
