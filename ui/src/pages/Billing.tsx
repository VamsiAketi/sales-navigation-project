import { useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, CheckCircle2, Clock3, ExternalLink, GripVertical, Plus, Receipt, Zap } from "lucide-react";
import type { CostDailyTotal } from "@paperclipai/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSearchParams } from "@/lib/router";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { useSidebar } from "../context/SidebarContext";
import { costsApi } from "../api/costs";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { queryKeys } from "../lib/queryKeys";
import { WalletTopUpDialog } from "../components/WalletTopUpDialog";
import { cn, formatCents } from "../lib/utils";

const INVOICE_MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

type BillingModuleId = "accountCredit" | "tokenUsage" | "payment" | "yourUsage" | "invoices";

const DEFAULT_BILLING_MODULE_ORDER: BillingModuleId[] = [
  "accountCredit",
  "tokenUsage",
  "payment",
  "yourUsage",
  "invoices",
];

function utcMonthKeyFromIso(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatUtcMonthKeyLabel(key: string): string {
  const [ys, ms] = key.split("-");
  const y = Number.parseInt(ys ?? "", 10);
  const mo = Number.parseInt(ms ?? "", 10) - 1;
  if (!Number.isFinite(y) || !Number.isFinite(mo) || mo < 0) return key;
  return new Date(Date.UTC(y, mo, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatInvoiceRowDateUtc(iso: string): string {
  const d = new Date(iso);
  const day = String(d.getUTCDate()).padStart(2, "0");
  const mon = INVOICE_MONTH_LABELS[d.getUTCMonth()] ?? "";
  const y = d.getUTCFullYear();
  return `${day} ${mon} ${y}`;
}

function formatInvoiceAmountMajor(cents: number, currency: string): string {
  const major = (cents / 100).toFixed(2);
  return `${major} ${currency.trim().toUpperCase() || "USD"}`;
}

function currentUtcMonthRangeIso(): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)).toISOString();
  const to = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)).toISOString();
  return { from, to };
}

function enumerateUtcDaysInclusive(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  const start = new Date(fromIso);
  const end = new Date(toIso);
  const cur = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endUtc = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  while (cur <= endUtc) {
    out.push(cur.toISOString().slice(0, 10));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

/** `YYYY-MM-DD` for today’s date in UTC (calendar day). */
function utcTodayCalendarKey(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
}

function formatChartDayLabelUtc(dayKey: string): string {
  const [ys, ms, ds] = dayKey.split("-");
  const y = Number.parseInt(ys ?? "", 10);
  const mo = Number.parseInt(ms ?? "", 10) - 1;
  const day = Number.parseInt(ds ?? "", 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(day)) return dayKey;
  return new Date(Date.UTC(y, mo, day)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function buildBillingUsageChartSeries(
  daily: CostDailyTotal[] | undefined,
  fromIso: string,
  toIso: string,
  /** Stop the X-axis at this UTC day (inclusive); usually today so we do not plot empty future days in the month. */
  endCapKeyUtc: string,
): {
  dayKey: string;
  label: string;
  dailyTokens: number;
  cumulativeTokens: number;
  dailyModelCents: number;
  cumulativeModelCents: number;
}[] {
  const monthEndKey = new Date(toIso).toISOString().slice(0, 10);
  const endKey = monthEndKey <= endCapKeyUtc ? monthEndKey : endCapKeyUtc;
  const keys = enumerateUtcDaysInclusive(fromIso, `${endKey}T12:00:00.000Z`);
  const byDay = new Map((daily ?? []).map((r) => [r.day, r]));
  let cumT = 0;
  let cumM = 0;
  return keys.map((dayKey) => {
    const row = byDay.get(dayKey);
    const dailyTokens = row ? row.inputTokens + row.cachedInputTokens + row.outputTokens : 0;
    const dailyModelCents = row?.modelCostCents ?? 0;
    cumT += dailyTokens;
    cumM += dailyModelCents;
    return {
      dayKey,
      label: formatChartDayLabelUtc(dayKey),
      dailyTokens,
      cumulativeTokens: cumT,
      dailyModelCents,
      cumulativeModelCents: cumM,
    };
  });
}

function UsageBar({ value, max, className }: { value: number; max: number; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div
        className="h-full rounded-full bg-primary transition-[width] duration-300"
        style={{ width: `${pct}%` }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
      />
    </div>
  );
}

function formatUsedPercent(used: number, total: number): string {
  if (total <= 0) return "0%";
  const raw = (used / total) * 100;
  if (raw > 0 && raw < 0.1) return "<0.1%";
  return raw < 1 ? `${raw.toFixed(1)}%` : `${Math.round(raw)}%`;
}

function SortableBillingModule({
  id,
  order,
  children,
}: {
  id: BillingModuleId;
  order: number;
  children: ReactNode;
}) {
  const { isMobile } = useSidebar();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const dragHandleProps = isMobile ? {} : { ...attributes, ...listeners };
  const mobileModuleDragProps = isMobile ? { ...attributes, ...listeners } : {};
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    order,
    ...(isMobile ? { touchAction: "none" as const } : {}),
  };
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn("space-y-2", isDragging && "opacity-80", isMobile && "max-lg:touch-none")}
      {...mobileModuleDragProps}
    >
      <div className={cn("flex items-start gap-2", isMobile && "max-lg:gap-0")}>
        <button
          type="button"
          className="mt-1 inline-flex h-6 w-6 max-lg:hidden shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/60 transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing"
          aria-label="Drag billing module to reorder"
          {...dragHandleProps}
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}

export function Billing() {
  const queryClient = useQueryClient();
  const chartMoneyFillId = useId().replace(/:/g, "");
  const [searchParams] = useSearchParams();
  const { isMobile } = useSidebar();
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  const monthRange = useMemo(() => currentUtcMonthRangeIso(), []);

  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const canReadBilling = sidebarBadges?.canReadBilling ?? true;
  const canReadCosts = sidebarBadges?.canReadCosts ?? true;
  const canReadBillingInvoices = sidebarBadges?.canReadBillingInvoices ?? true;
  const canManageBillingPayments = sidebarBadges?.canManageBillingPayments ?? true;

  const costsEnabled = Boolean(selectedCompanyId && canReadCosts);
  const billingPrepaidEnabled = Boolean(selectedCompanyId && canReadBilling);

  const { data: costSummary, isLoading: summaryLoading } = useQuery({
    queryKey: ["costs", "billing-summary", selectedCompanyId, monthRange.from, monthRange.to],
    queryFn: () => costsApi.summary(selectedCompanyId!, monthRange.from, monthRange.to),
    enabled: costsEnabled,
  });

  const { data: byBiller, isLoading: byBillerLoading } = useQuery({
    queryKey: ["costs", "billing-by-biller", selectedCompanyId, monthRange.from, monthRange.to],
    queryFn: () => costsApi.byBiller(selectedCompanyId!, monthRange.from, monthRange.to),
    enabled: costsEnabled,
  });

  const { data: usageDailyMonth, isLoading: usageDailyLoading } = useQuery({
    queryKey: queryKeys.costsDaily(selectedCompanyId!, monthRange.from, monthRange.to),
    queryFn: () => costsApi.daily(selectedCompanyId!, monthRange.from, monthRange.to),
    enabled: costsEnabled,
  });

  const prepaidQuery = useQuery({
    queryKey: queryKeys.billingPrepaidBalance(selectedCompanyId!),
    queryFn: () => costsApi.prepaidBalance(selectedCompanyId!),
    enabled: billingPrepaidEnabled,
  });
  const { data: prepaidBalance, isLoading: prepaidLoading, isError: prepaidError } = prepaidQuery;
  const { data: stripeStatus, isLoading: stripeStatusLoading } = useQuery({
    queryKey: ["billing", "stripe-status", selectedCompanyId],
    queryFn: () => costsApi.stripeStatus(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId && canReadBilling),
  });
  const stripeReadyForCheckout = Boolean(stripeStatus?.enabled);
  const stripeWebhookConfigured = Boolean(stripeStatus?.hasWebhookSecret);
  const { data: stripeInvoicesData, isLoading: stripeInvoicesLoading, isError: stripeInvoicesError } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.billingStripeInvoices(selectedCompanyId) : ["billing", "stripe-invoices", "none"],
    queryFn: () => costsApi.stripeInvoices(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId && canReadBillingInvoices && stripeReadyForCheckout),
  });
  const stripePortalMutation = useMutation({
    mutationFn: () => costsApi.createStripePortalSession(selectedCompanyId!),
    onSuccess: (result) => {
      window.location.assign(result.url);
    },
  });
  const [walletTopUpDialogOpen, setWalletTopUpDialogOpen] = useState(false);
  const [walletTopUpSubmitError, setWalletTopUpSubmitError] = useState<string | null>(null);
  const stripeTopUpMutation = useMutation({
    mutationFn: (amountCents: number) =>
      costsApi.createStripeCheckoutSession(selectedCompanyId!, amountCents),
    onMutate: () => setWalletTopUpSubmitError(null),
    onSuccess: (result) => {
      window.location.assign(result.url);
    },
    onError: (error: Error) => {
      setWalletTopUpSubmitError(error.message || "Could not start Stripe checkout.");
    },
  });

  const tokenRollup = useMemo(() => {
    if (!byBiller?.length) {
      return {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        modelCostCents: 0,
      };
    }
    return byBiller.reduce(
      (acc, row) => ({
        inputTokens: acc.inputTokens + row.inputTokens,
        cachedInputTokens: acc.cachedInputTokens + row.cachedInputTokens,
        outputTokens: acc.outputTokens + row.outputTokens,
        costCents: acc.costCents + row.costCents,
        modelCostCents: acc.modelCostCents + row.modelCostCents,
      }),
      {
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        costCents: 0,
        modelCostCents: 0,
      },
    );
  }, [byBiller]);

  const totalTokens =
    tokenRollup.inputTokens + tokenRollup.cachedInputTokens + tokenRollup.outputTokens;

  const usageChartEndCapUtc = utcTodayCalendarKey();
  const usageChartSeries = useMemo(
    () => buildBillingUsageChartSeries(usageDailyMonth, monthRange.from, monthRange.to, usageChartEndCapUtc),
    [usageDailyMonth, monthRange.from, monthRange.to, usageChartEndCapUtc],
  );

  const budgetCents = costSummary?.budgetCents ?? 0;
  const modelSpendMonth = costSummary?.modelSpendCents ?? 0;

  const [invoiceMonthKey, setInvoiceMonthKey] = useState<string | null>(null);
  const invoiceMonthSelectOptions = useMemo(() => {
    const list = stripeInvoicesData?.invoices ?? [];
    const unique = [...new Set(list.map((inv) => utcMonthKeyFromIso(inv.createdAt)))];
    unique.sort((a, b) => b.localeCompare(a));
    return unique.map((value) => ({ value, label: formatUtcMonthKeyLabel(value) }));
  }, [stripeInvoicesData?.invoices]);

  useEffect(() => {
    if (invoiceMonthSelectOptions.length === 0) {
      setInvoiceMonthKey(null);
      return;
    }
    setInvoiceMonthKey((prev) =>
      prev != null && invoiceMonthSelectOptions.some((o) => o.value === prev)
        ? prev
        : invoiceMonthSelectOptions[0]!.value,
    );
  }, [invoiceMonthSelectOptions, selectedCompanyId]);

  const effectiveInvoiceMonthKey = invoiceMonthKey ?? invoiceMonthSelectOptions[0]?.value ?? null;

  const filteredStripeInvoices = useMemo(() => {
    const list = stripeInvoicesData?.invoices ?? [];
    if (!effectiveInvoiceMonthKey) return list;
    const parts = effectiveInvoiceMonthKey.split("-");
    const y = Number.parseInt(parts[0] ?? "", 10);
    const m = Number.parseInt(parts[1] ?? "", 10);
    if (!Number.isFinite(y) || !Number.isFinite(m)) return list;
    return list.filter((inv) => {
      const d = new Date(inv.createdAt);
      return d.getUTCFullYear() === y && d.getUTCMonth() + 1 === m;
    });
  }, [stripeInvoicesData, effectiveInvoiceMonthKey]);

  const [moduleOrder, setModuleOrder] = useState<BillingModuleId[]>(DEFAULT_BILLING_MODULE_ORDER);
  const [moduleOrderHydrated, setModuleOrderHydrated] = useState(false);
  const [topUpSuccessDialogOpen, setTopUpSuccessDialogOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return Boolean(new URLSearchParams(window.location.search).get("stripe"));
  });
  const [billingDialogStatus, setBillingDialogStatus] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return new URLSearchParams(window.location.search).get("stripe");
  });
  const [topUpSuccessHandled, setTopUpSuccessHandled] = useState(false);
  const [checkoutSyncState, setCheckoutSyncState] = useState<
    "idle" | "syncing" | "credited" | "pending" | "failed"
  >("idle");
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: isMobile ? 180 : 250,
        tolerance: isMobile ? 8 : 5,
      },
    }),
  );

  useEffect(() => {
    setModuleOrderHydrated(false);
    if (!selectedCompanyId) {
      setModuleOrder(DEFAULT_BILLING_MODULE_ORDER);
      setModuleOrderHydrated(true);
      return;
    }
    const storageKey = `billing-module-order:${selectedCompanyId}`;
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) {
      setModuleOrder(DEFAULT_BILLING_MODULE_ORDER);
      setModuleOrderHydrated(true);
      return;
    }
    try {
      const parsed = JSON.parse(raw) as BillingModuleId[];
      const valid = parsed.filter((id): id is BillingModuleId =>
        DEFAULT_BILLING_MODULE_ORDER.includes(id),
      );
      const merged = [
        ...valid,
        ...DEFAULT_BILLING_MODULE_ORDER.filter((id) => !valid.includes(id)),
      ];
      setModuleOrder(merged);
      setModuleOrderHydrated(true);
    } catch {
      setModuleOrder(DEFAULT_BILLING_MODULE_ORDER);
      setModuleOrderHydrated(true);
    }
  }, [selectedCompanyId]);

  useEffect(() => {
    if (!selectedCompanyId || !moduleOrderHydrated) return;
    const storageKey = `billing-module-order:${selectedCompanyId}`;
    window.localStorage.setItem(storageKey, JSON.stringify(moduleOrder));
  }, [moduleOrder, selectedCompanyId, moduleOrderHydrated]);

  const moduleRank = (id: BillingModuleId): number => {
    const idx = moduleOrder.indexOf(id);
    return idx === -1 ? DEFAULT_BILLING_MODULE_ORDER.indexOf(id) : idx;
  };
  const handleModuleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setModuleOrder((prev) => {
      const oldIndex = prev.indexOf(active.id as BillingModuleId);
      const newIndex = prev.indexOf(over.id as BillingModuleId);
      if (oldIndex === -1 || newIndex === -1) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }, []);

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Billing" },
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

  const invalidateBillingQueries = useCallback(() => {
    if (!selectedCompanyId) return;
    void queryClient.invalidateQueries({
      queryKey: ["costs", "billing-summary", selectedCompanyId, monthRange.from, monthRange.to],
    });
    void queryClient.invalidateQueries({
      queryKey: ["costs", "billing-by-biller", selectedCompanyId, monthRange.from, monthRange.to],
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.costsDaily(selectedCompanyId, monthRange.from, monthRange.to),
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.billingStripeInvoices(selectedCompanyId) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.billingPrepaidBalance(selectedCompanyId) });
  }, [queryClient, selectedCompanyId, monthRange.from, monthRange.to]);

  useEffect(() => {
    const stripeFlag = searchParams.get("stripe")
      ?? (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("stripe")
        : null);
    if (!stripeFlag || !selectedCompanyId || topUpSuccessHandled) return;
    setTopUpSuccessHandled(true);
    setBillingDialogStatus(stripeFlag);
    setTopUpSuccessDialogOpen(true);

    const sessionId =
      searchParams.get("session_id")
      ?? (typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("session_id")
        : null);

    const isPaymentSuccess =
      stripeFlag === "payment-success" || stripeFlag === "topup-success";

    if (!isPaymentSuccess || !sessionId || !canManageBillingPayments) {
      setCheckoutSyncState(isPaymentSuccess ? "pending" : "idle");
      invalidateBillingQueries();
      return;
    }

    let cancelled = false;
    setCheckoutSyncState("syncing");
    void costsApi
      .syncStripeCheckoutSession(selectedCompanyId, sessionId)
      .then((result) => {
        if (cancelled) return;
        if (result.credited) {
          setCheckoutSyncState("credited");
        } else if (result.paymentStatus === "paid") {
          setCheckoutSyncState("pending");
        } else {
          setCheckoutSyncState("failed");
        }
      })
      .catch(() => {
        if (!cancelled) setCheckoutSyncState("failed");
      })
      .finally(() => {
        // Always refresh balance after sync — closing the dialog strips URL params and
        // re-runs this effect's cleanup (cancelled=true), but the server may already have credited.
        void queryClient.refetchQueries({
          queryKey: queryKeys.billingPrepaidBalance(selectedCompanyId),
        });
        invalidateBillingQueries();
      });

    return () => {
      cancelled = true;
    };
  }, [
    searchParams,
    selectedCompanyId,
    topUpSuccessHandled,
    canManageBillingPayments,
    invalidateBillingQueries,
  ]);

  const closeBillingDialog = useCallback(() => {
    setTopUpSuccessDialogOpen(false);
    setBillingDialogStatus(null);
    setCheckoutSyncState("idle");
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (url.searchParams.has("stripe")) {
      url.searchParams.delete("stripe");
    }
    if (url.searchParams.has("session_id")) {
      url.searchParams.delete("session_id");
    }
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  if (!selectedCompany) {
    return (
      <div className="text-sm text-muted-foreground">
        No company selected. Select a company from the switcher above.
      </div>
    );
  }

  if (!canReadBilling) {
    return (
      <div className="text-sm text-muted-foreground">
        You do not have permission to view billing for this company.
      </div>
    );
  }

  const usageLoading = summaryLoading || byBillerLoading || usageDailyLoading;

  const chartStrokeMoney = "var(--chart-3)";
  const usageChartAriaLabel = "Daily model spend and token usage by UTC day";
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 pb-12">
      <div>
        <h1 className="text-xl font-bold">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Subscriptions wallet balance, usage and invoices for this company.
        </p>
        {!canReadCosts ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Usage and spend from model pricing require the Costs permission.
          </p>
        ) : null}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleModuleDragEnd}>
      <SortableContext items={moduleOrder} strategy={verticalListSortingStrategy}>
      <SortableBillingModule id="accountCredit" order={moduleRank("accountCredit")}>
      <div>
        <Card className="rounded-lg border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Account Balance</CardTitle>
            <CardDescription className="text-xs">
              Funds added to your wallet and used automatically for token usage across this company.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {prepaidLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : prepaidError ? (
              <p className="text-sm text-destructive">Could not load account credit.</p>
            ) : prepaidBalance ? (
              <>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Added</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">
                      {formatCents(prepaidBalance.prepaidCents)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Spent</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">
                      {formatCents(prepaidBalance.usedModelCents)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Available</div>
                    <div className="mt-1 text-lg font-semibold tabular-nums">
                      {formatCents(
                        prepaidBalance.availableCents ??
                          (prepaidBalance.walletNetCents ?? prepaidBalance.remainingCents) -
                            (prepaidBalance.reservedCents ?? 0),
                      )}
                    </div>
                  </div>
                </div>
                {prepaidBalance.deficitCents > 0 ? (
                  <p className="text-xs text-destructive">
                    Wallet is {formatCents(prepaidBalance.deficitCents)} below zero after recorded spend.
                  </p>
                ) : null}
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>
      </SortableBillingModule>

      <SortableBillingModule id="tokenUsage" order={moduleRank("tokenUsage")}>
      <div>
        <Card className="rounded-lg border-border gap-3 py-4">
        <CardHeader className="pb-1">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-muted-foreground" aria-hidden />
            <CardTitle className="text-sm font-semibold">Balance Used</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Estimated model usage deducted from your wallet balance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1.5 pt-0">
          {!canReadCosts ? (
            <p className="text-sm text-muted-foreground">Costs permission required.</p>
          ) : (
            <>
              {usageLoading ? (
                <p className="text-sm text-muted-foreground">Loading usage…</p>
              ) : totalTokens === 0 ? (
                <p className="text-sm text-muted-foreground">No usage recorded this month yet.</p>
              ) : (
                <>
                  {budgetCents > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Monthly budget (model estimate):{" "}
                      <span className="font-semibold tabular-nums text-foreground">
                        {Math.min(100, Math.round((modelSpendMonth / budgetCents) * 100))}%
                      </span>{" "}
                      used ({formatCents(modelSpendMonth)} of {formatCents(budgetCents)}).
                    </p>
                  ) : null}
                </>
              )}
              {prepaidLoading ? (
                <p className="text-xs text-muted-foreground">Loading prepaid balance…</p>
              ) : prepaidBalance && prepaidBalance.prepaidCents > 0 ? (
                <div className="space-y-1.5 rounded-md border border-border bg-muted/20 px-2.5 py-2">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-xs">
                    <span className="font-medium text-foreground">Wallet balance used</span>
                    <span className="tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {formatUsedPercent(prepaidBalance.usedModelCents, prepaidBalance.prepaidCents)}
                      </span>
                      <span className="mx-1.5 text-border">·</span>
                      {formatCents(prepaidBalance.usedModelCents)} of {formatCents(prepaidBalance.prepaidCents)}
                    </span>
                  </div>
                  <UsageBar
                    value={prepaidBalance.usedModelCents}
                    max={prepaidBalance.prepaidCents}
                    className="h-2.5"
                  />
                  <p className="text-[10px] leading-snug text-muted-foreground">
                    Share of wallet balance consumed by estimated model spend (matches Account Balance).
                  </p>
                </div>
              ) : null}
            </>
          )}
        </CardContent>
        </Card>
      </div>
      </SortableBillingModule>

      <SortableBillingModule id="payment" order={moduleRank("payment")}>
      <div>
        <Card className="rounded-lg border-border bg-card">
        <CardContent className="flex flex-col gap-4 py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">Payment</p>
              <p className="mt-0.5 text-sm text-muted-foreground">Update your payment details</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                disabled={
                  stripeStatusLoading ||
                  !stripeReadyForCheckout ||
                  !canManageBillingPayments ||
                  stripePortalMutation.isPending
                }
                title={
                  !canManageBillingPayments
                    ? "You do not have permission to manage billing payments."
                    : !stripeReadyForCheckout
                      ? "Set STRIPE_SECRET_KEY on the server to enable Stripe."
                      : undefined
                }
                onClick={() => stripePortalMutation.mutate()}
              >
                {stripePortalMutation.isPending ? "Opening..." : "Manage in Stripe"}
              </Button>
              <Button
                type="button"
                variant="default"
                size="sm"
                className="shrink-0 gap-1.5"
                disabled={
                  stripeStatusLoading ||
                  !stripeReadyForCheckout ||
                  !canManageBillingPayments
                }
                title={
                  !canManageBillingPayments
                    ? "You do not have permission to manage billing payments."
                    : !stripeReadyForCheckout
                      ? "Set STRIPE_SECRET_KEY on the server to enable Stripe checkout."
                      : undefined
                }
                onClick={() => {
                  setWalletTopUpSubmitError(null);
                  setWalletTopUpDialogOpen(true);
                }}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add funds
              </Button>
            </div>
          </div>
          {!canManageBillingPayments && stripeReadyForCheckout ? (
            <p className="text-xs text-muted-foreground">
              You do not have permission to open the Stripe customer portal or run checkout from this account.
            </p>
          ) : null}
          {stripeStatusLoading ? (
            <p className="text-xs text-muted-foreground">Checking Stripe configuration…</p>
          ) : !stripeReadyForCheckout ? (
            <p className="text-xs text-muted-foreground">
              Stripe checkout is off until the server has a secret key. Set{" "}
              <span className="font-mono text-[11px]">STRIPE_SECRET_KEY</span> in the environment (see{" "}
              <span className="font-mono text-[11px]">.env.example</span>), then restart the API.
            </p>
          ) : !stripeWebhookConfigured ? (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Top-up checkout is available, but prepaid balance will only increase automatically after you set{" "}
              <span className="font-mono text-[11px]">STRIPE_WEBHOOK_SECRET</span> and point Stripe&apos;s
              webhook to this instance&apos;s <span className="font-mono text-[11px]">/api/stripe/webhook</span>{" "}
              endpoint. Until then, you can still pay in Stripe and adjust prepaid credit manually in instance settings
              if needed.
            </p>
          ) : null}
        </CardContent>
        </Card>
      </div>
      </SortableBillingModule>

      <SortableBillingModule id="yourUsage" order={moduleRank("yourUsage")}>
      <div>
        <Card className="rounded-lg border-border">
        <CardHeader className="space-y-1 pb-2">
          <CardTitle className="text-sm font-semibold">Your usage</CardTitle>
          <CardDescription className="text-xs">
            Estimated model spend (USD) per UTC day through today in this billing month, each point is that day only,
            not a running total. Same token × pricing as Costs.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {!canReadCosts ? (
            <p className="text-sm text-muted-foreground">Costs permission required.</p>
          ) : usageLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-2">
              <div className="h-[220px] w-full min-w-0" role="img" aria-label={usageChartAriaLabel}>
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={usageChartSeries} margin={{ top: 8, right: 6, left: 2, bottom: 8 }}>
                    <defs>
                      <linearGradient id={chartMoneyFillId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={chartStrokeMoney} stopOpacity={0.32} />
                        <stop offset="100%" stopColor={chartStrokeMoney} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid
                      stroke="hsl(var(--border))"
                      strokeOpacity={0.85}
                      horizontal
                      vertical={false}
                      yAxisId="money"
                    />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={{ stroke: "hsl(var(--border))", strokeWidth: 1 }}
                      axisLine={{ stroke: "hsl(var(--border))", strokeWidth: 1.5 }}
                      interval="preserveStartEnd"
                      minTickGap={16}
                    />
                    <YAxis
                      yAxisId="money"
                      orientation="left"
                      width={54}
                      domain={[0, "auto"]}
                      tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v: number) => formatCents(v)}
                    />
                    <ReferenceLine
                      yAxisId="money"
                      y={0}
                      stroke="hsl(var(--border))"
                      strokeWidth={1}
                    />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;
                        const row = payload[0]?.payload as (typeof usageChartSeries)[number] | undefined;
                        return (
                          <div
                            className="min-w-[10rem] rounded-md border border-border bg-card px-3 py-2 text-[11px] shadow-md"
                            style={{ outline: "1px solid hsl(var(--foreground) / 0.04)" }}
                          >
                            {row?.dayKey ? (
                              <p className="mb-1.5 font-medium text-muted-foreground">{row.dayKey}</p>
                            ) : null}
                            <ul className="space-y-1">
                              {payload.map((p) => {
                                const v = typeof p.value === "number" ? p.value : Number(p.value ?? 0);
                                const isMoney = p.dataKey === "dailyModelCents";
                                return (
                                  <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
                                    <span className="flex items-center gap-2 text-muted-foreground">
                                      <span
                                        className="h-2 w-2 shrink-0 rounded-[1px]"
                                        style={{ backgroundColor: p.color }}
                                      />
                                      {p.name}
                                    </span>
                                    <span className="font-semibold tabular-nums text-foreground">{formatCents(v)}</span>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        );
                      }}
                    />
                    <Area
                      yAxisId="money"
                      type="monotone"
                      dataKey="dailyModelCents"
                      name="Model estimate"
                      stroke={chartStrokeMoney}
                      strokeWidth={2}
                      fill={`url(#${chartMoneyFillId})`}
                      isAnimationActive={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2">
                <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <span
                    className="h-2 w-2 shrink-0 rounded-[1px]"
                    style={{ backgroundColor: chartStrokeMoney }}
                  />
                  Model estimate (daily)
                </span>
              </div>
            </div>
          )}
        </CardContent>
        </Card>
      </div>
      </SortableBillingModule>

      <SortableBillingModule id="invoices" order={moduleRank("invoices")}>
      <div>
        <Card className="rounded-lg border-border">
        <CardHeader className="space-y-3 pb-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Receipt className="h-4 w-4 text-muted-foreground" aria-hidden />
                <CardTitle className="text-sm font-semibold">Invoices</CardTitle>
              </div>
              <CardDescription className="text-xs">
                Stripe invoices for this company. Payments without an invoice appear under Payments in the Stripe
                Dashboard.
              </CardDescription>
            </div>
            {stripeReadyForCheckout &&
            canReadBillingInvoices &&
            !stripeInvoicesLoading &&
            !stripeInvoicesError &&
            (stripeInvoicesData?.invoices?.length ?? 0) > 0 ? (
              <Select
                value={effectiveInvoiceMonthKey ?? undefined}
                onValueChange={(v) => setInvoiceMonthKey(v)}
              >
                <SelectTrigger className="h-9 w-[min(100%,11rem)] shrink-0 text-xs" aria-label="Filter by month">
                  <SelectValue placeholder="Month" />
                </SelectTrigger>
                <SelectContent>
                  {invoiceMonthSelectOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          <div className="max-h-[26rem] overflow-x-auto overflow-y-auto rounded-md border border-border [scrollbar-width:thin] [scrollbar-color:hsl(var(--border)/0.85)_transparent] [&::-webkit-scrollbar]:h-1 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border/70 [&::-webkit-scrollbar-thumb:hover]:bg-border">
            {!canReadBillingInvoices ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                You do not have permission to view billing invoices for this company.
              </div>
            ) : !stripeReadyForCheckout ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                Configure Stripe on the server to load invoices.
              </div>
            ) : stripeInvoicesLoading ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">Loading invoices…</div>
            ) : stripeInvoicesError ? (
              <div className="px-3 py-8 text-center text-sm text-destructive">Could not load invoices.</div>
            ) : !stripeInvoicesData?.invoices?.length ? (
              <div className="space-y-2 px-3 py-8 text-center text-sm text-muted-foreground">
                <p>No invoices yet.</p>
                <p className="text-xs">
                  Older top-ups may not have created an invoice. New top-ups use Stripe invoice creation; refresh after
                  returning from checkout.
                </p>
              </div>
            ) : filteredStripeInvoices.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                No invoices for this month.
              </div>
            ) : (
              <table className="w-full min-w-[36rem] table-fixed border-collapse text-sm">
                <colgroup>
                  <col className="w-[14%]" />
                  <col className="w-[38%]" />
                  <col className="w-[14%]" />
                  <col className="w-[20%]" />
                  <col className="w-[14%]" />
                </colgroup>
                <thead>
                  <tr className="border-b border-border bg-muted/30">
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Date</th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">
                      Description
                    </th>
                    <th className="px-4 py-2.5 text-left text-xs font-medium text-muted-foreground">Status</th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground tabular-nums whitespace-nowrap">
                      Amount
                    </th>
                    <th className="px-4 py-2.5 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">
                      Invoice
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredStripeInvoices.map((inv) => {
                    const receiptUrl = inv.hostedInvoiceUrl ?? inv.invoicePdf;
                    return (
                      <tr key={inv.id} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-3 align-middle text-foreground">
                          {formatInvoiceRowDateUtc(inv.createdAt)}
                        </td>
                        <td className="max-w-0 px-4 py-3 align-middle">
                          <span
                            className={`block truncate ${inv.description?.trim() ? "text-muted-foreground" : "text-muted-foreground/40"}`}
                            title={inv.description?.trim() || undefined}
                          >
                            {inv.description?.trim() || "No description"}
                          </span>
                        </td>
                        <td className="px-4 py-3 align-middle capitalize text-muted-foreground">
                          {inv.status ?? "Unknown"}
                        </td>
                        <td className="px-4 py-3 text-right align-middle tabular-nums whitespace-nowrap font-medium text-foreground">
                          {formatInvoiceAmountMajor(inv.amountPaidCents, inv.currency)}
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          {receiptUrl ? (
                            <a
                              href={receiptUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center justify-end gap-1 text-xs font-medium text-primary underline underline-offset-2"
                            >
                              <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-80" aria-hidden />
                              View
                            </a>
                          ) : (
                            <span className="text-xs text-muted-foreground">N/A</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </CardContent>
        </Card>
      </div>
      </SortableBillingModule>
      </SortableContext>
      </DndContext>

      <WalletTopUpDialog
        open={walletTopUpDialogOpen}
        onOpenChange={(open) => {
          if (!stripeTopUpMutation.isPending) setWalletTopUpDialogOpen(open);
        }}
        onConfirm={(amountCents) => stripeTopUpMutation.mutate(amountCents)}
        isSubmitting={stripeTopUpMutation.isPending}
        submitError={walletTopUpSubmitError}
      />

      <Dialog
        open={topUpSuccessDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeBillingDialog();
          else setTopUpSuccessDialogOpen(true);
        }}
      >
        <DialogContent className="max-w-sm rounded-2xl border-border/60" showCloseButton={false}>
          <DialogHeader className="items-center text-center sm:items-center sm:text-center">
            {billingDialogStatus === "payment-success" || billingDialogStatus === "topup-success" ? (
              <>
                <div className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
                  <CheckCircle2 className="h-6 w-6" aria-hidden />
                </div>
                <DialogTitle>Payment successful</DialogTitle>
                <DialogDescription>
                  {checkoutSyncState === "syncing"
                    ? "Payment is complete. Applying funds to your wallet…"
                    : checkoutSyncState === "credited"
                      ? "Payment is complete and your wallet balance has been updated."
                      : checkoutSyncState === "pending"
                        ? "Payment succeeded in Stripe, but funds are not in your wallet yet. Keep the Stripe webhook running (see below) or refresh in a moment."
                        : checkoutSyncState === "failed"
                          ? "Payment succeeded in Stripe, but we could not add funds automatically. Check server logs and your Stripe webhook setup."
                          : "Payment is complete and your account balance is updating."}
                </DialogDescription>
              </>
            ) : billingDialogStatus === "payment-cancelled" || billingDialogStatus === "topup-cancelled" ? (
              <>
                <div className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
                  <AlertTriangle className="h-6 w-6" aria-hidden />
                </div>
                <DialogTitle>Funds not added</DialogTitle>
                <DialogDescription>
                  No payment was captured. You can try again anytime.
                </DialogDescription>
              </>
            ) : (
              <>
                <div className="mb-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-sky-500/15 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400">
                  <Clock3 className="h-6 w-6" aria-hidden />
                </div>
                <DialogTitle>Billing update</DialogTitle>
                <DialogDescription>
                  We are processing your latest billing action.
                </DialogDescription>
              </>
            )}
          </DialogHeader>
          <DialogFooter className="mt-1 sm:justify-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-10 min-w-36 rounded-full px-8"
              onClick={closeBillingDialog}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
