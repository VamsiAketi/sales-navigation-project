import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Loader2, Wallet } from "lucide-react";
import {
  WALLET_PREPAID_TOPUP_MAX_CENTS,
  WALLET_PREPAID_TOPUP_MIN_CENTS,
  WALLET_PREPAID_TOPUP_PRESET_CENTS,
} from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn, formatCents } from "@/lib/utils";

const DEFAULT_PRESET_CENTS = WALLET_PREPAID_TOPUP_PRESET_CENTS[0];

function formatPresetLabel(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatMajorBounds(): { min: string; max: string } {
  return {
    min: (WALLET_PREPAID_TOPUP_MIN_CENTS / 100).toLocaleString("en-US", {
      minimumFractionDigits: WALLET_PREPAID_TOPUP_MIN_CENTS % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }),
    max: (WALLET_PREPAID_TOPUP_MAX_CENTS / 100).toLocaleString("en-US", {
      maximumFractionDigits: 0,
    }),
  };
}

function centsToInputValue(cents: number): string {
  const major = cents / 100;
  return Number.isInteger(major) ? String(major) : major.toFixed(2);
}

/** Keep only digits and an optional decimal while typing (max 2 decimal places). */
function sanitizeDollarInput(value: string): string {
  const stripped = value.replace(/,/g, "");
  if (stripped === "") return "";
  const match = stripped.match(/^\d*\.?\d{0,2}/);
  return match?.[0] ?? "";
}

function parseDollarInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100);
}

function validateTopUpCents(cents: number | null): string | null {
  if (cents === null) return "Enter an amount to continue.";
  if (cents < WALLET_PREPAID_TOPUP_MIN_CENTS) {
    return `Minimum top-up is $${formatMajorBounds().min}.`;
  }
  if (cents > WALLET_PREPAID_TOPUP_MAX_CENTS) {
    return `Maximum top-up is $${formatMajorBounds().max}.`;
  }
  return null;
}

export function WalletTopUpDialog({
  open,
  onOpenChange,
  onConfirm,
  isSubmitting,
  submitError,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (amountCents: number, idempotencyKey: string) => void;
  isSubmitting?: boolean;
  submitError?: string | null;
}) {
  const customAmountId = useId();
  const bounds = useMemo(() => formatMajorBounds(), []);
  const [customInput, setCustomInput] = useState(() => centsToInputValue(DEFAULT_PRESET_CENTS));
  const [touched, setTouched] = useState(false);

  const resolvedCents = useMemo(() => parseDollarInput(customInput), [customInput]);
  const validationError = useMemo(() => validateTopUpCents(resolvedCents), [resolvedCents]);
  const canSubmit = !isSubmitting && validationError === null;

  const resetForm = useCallback(() => {
    setCustomInput(centsToInputValue(DEFAULT_PRESET_CENTS));
    setTouched(false);
  }, []);

  useEffect(() => {
    if (open) resetForm();
  }, [open, resetForm]);

  const selectPreset = (cents: number) => {
    setCustomInput(centsToInputValue(cents));
    setTouched(false);
  };

  const handleCustomChange = (value: string) => {
    setCustomInput(sanitizeDollarInput(value));
    setTouched(true);
  };

  const handleCustomBlur = () => {
    setTouched(true);
    const parsed = parseDollarInput(customInput);
    if (parsed !== null) {
      setCustomInput(centsToInputValue(parsed));
    }
  };

  const handleSubmit = () => {
    setTouched(true);
    if (validationError !== null || resolvedCents === null) return;
    const idempotencyKey =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `topup-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    onConfirm(resolvedCents, idempotencyKey);
  };

  const isPresetActive = (cents: number) => customInput === centsToInputValue(cents);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden rounded-2xl border-border/70 p-0 shadow-lg">
        <DialogHeader className="space-y-3 border-b border-border/60 bg-muted/20 px-6 py-5 text-left">
          <div className="flex items-start gap-3">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-background text-foreground"
              aria-hidden
            >
              <Wallet className="h-5 w-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <DialogTitle className="text-base font-semibold tracking-tight">Add wallet funds</DialogTitle>
              <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
                Choose an amount to add to your prepaid balance. You will confirm payment securely in Stripe
                Checkout.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 px-6 py-5">
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Quick select</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {WALLET_PREPAID_TOPUP_PRESET_CENTS.map((cents) => {
                const active = isPresetActive(cents);
                return (
                  <button
                    key={cents}
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => selectPreset(cents)}
                    className={cn(
                      "h-11 rounded-lg border text-sm font-medium transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                      active
                        ? "border-primary bg-primary text-primary-foreground shadow-xs"
                        : "border-border/70 bg-background text-foreground hover:border-border hover:bg-muted/40",
                    )}
                  >
                    {formatPresetLabel(cents)}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor={customAmountId} className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Custom amount (USD)
            </Label>
            <div className="relative">
              <span
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground"
                aria-hidden
              >
                $
              </span>
              <Input
                id={customAmountId}
                value={customInput}
                onChange={(event) => handleCustomChange(event.target.value)}
                onBlur={handleCustomBlur}
                inputMode="decimal"
                placeholder="0.00"
                disabled={isSubmitting}
                className="h-11 pl-7 text-base tabular-nums"
                aria-invalid={touched && Boolean(validationError)}
                aria-describedby={`${customAmountId}-hint${touched && validationError ? ` ${customAmountId}-error` : ""}`}
              />
            </div>
            <p id={`${customAmountId}-hint`} className="text-xs text-muted-foreground">
              Allowed range: ${bounds.min} – ${bounds.max} per top-up.
            </p>
            {touched && validationError ? (
              <p id={`${customAmountId}-error`} className="text-xs text-destructive" role="alert">
                {validationError}
              </p>
            ) : null}
            {submitError ? (
              <p className="text-xs text-destructive" role="alert">
                {submitError}
              </p>
            ) : null}
          </div>

          <div className="rounded-xl border border-border/60 bg-muted/25 px-4 py-3">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Amount to add</span>
              <span className="text-base font-semibold tabular-nums text-foreground">
                {validationError === null && resolvedCents !== null
                  ? formatCents(resolvedCents)
                  : "—"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Funds are credited to your wallet after Stripe confirms payment.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 border-t border-border/60 bg-muted/10 px-6 py-4 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-10"
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            className="h-10 min-w-[10rem] gap-2"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Opening checkout…
              </>
            ) : (
              <>Add now</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
