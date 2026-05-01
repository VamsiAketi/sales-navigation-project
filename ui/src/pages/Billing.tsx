import { useEffect, useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowUpRight,
  BarChart3,
  Receipt,
  Zap,
} from "lucide-react";
import type { CostDailyTotal } from "@paperclipai/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBreadcrumbs } from "../context/BreadcrumbContext";
import { useCompany } from "../context/CompanyContext";
import { costsApi } from "../api/costs";
import { sidebarBadgesApi } from "../api/sidebarBadges";
import { queryKeys } from "../lib/queryKeys";
import { cn, formatCents, formatTokens } from "../lib/utils";

const WEEK_DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function currentUtcMonthRangeIso(): { from: string; to: string } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const from = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)).toISOString();
  const to = new Date(Date.UTC(y, m + 1, 0, 23, 59, 59, 999)).toISOString();
  return { from, to };
}

function currentUtcWeekRangeIso(): { from: string; to: string } {
  const now = new Date();
  const dow = now.getUTCDay();
  const diffToMon = dow === 0 ? -6 : 1 - dow;
  const mon = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + diffToMon, 0, 0, 0, 0),
  );
  const sun = new Date(
    Date.UTC(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate() + 6, 23, 59, 59, 999),
  );
  return { from: mon.toISOString(), to: sun.toISOString() };
}

function weekChartRows(
  daily: CostDailyTotal[] | undefined,
  weekStartIso: string,
): { label: string; tokens: number }[] {
  const start = new Date(weekStartIso);
  const byKey = new Map((daily ?? []).map((r) => [r.day, r]));
  return WEEK_DAY_LABELS.map((label, i) => {
    const d = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + i),
    );
    const dayKey = d.toISOString().slice(0, 10);
    const row = byKey.get(dayKey);
    const tokens = row
      ? row.inputTokens + row.cachedInputTokens + row.outputTokens
      : 0;
    return { label, tokens };
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

export function Billing() {
  const { selectedCompany, selectedCompanyId } = useCompany();
  const { setBreadcrumbs } = useBreadcrumbs();

  const monthRange = useMemo(() => currentUtcMonthRangeIso(), []);
  const weekRange = useMemo(() => currentUtcWeekRangeIso(), []);

  const { data: sidebarBadges } = useQuery({
    queryKey: selectedCompanyId ? queryKeys.sidebarBadges(selectedCompanyId) : ["sidebar-badges", "none"],
    queryFn: () => sidebarBadgesApi.get(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId),
    staleTime: 10_000,
  });
  const canReadBilling = sidebarBadges?.canReadCompanySettings ?? true;
  const canReadCosts = sidebarBadges?.canReadCosts ?? true;

  const costsEnabled = Boolean(selectedCompanyId && canReadCosts);

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

  const { data: dailyRows, isLoading: dailyLoading } = useQuery({
    queryKey: queryKeys.costsDaily(selectedCompanyId!, weekRange.from, weekRange.to),
    queryFn: () => costsApi.daily(selectedCompanyId!, weekRange.from, weekRange.to),
    enabled: costsEnabled,
  });

  const prepaidQuery = useQuery({
    queryKey: queryKeys.billingPrepaidBalance(selectedCompanyId!),
    queryFn: () => costsApi.prepaidBalance(selectedCompanyId!),
    enabled: costsEnabled,
  });
  const { data: prepaidBalance, isLoading: prepaidLoading, isError: prepaidError } = prepaidQuery;
  const { data: stripeStatus, isLoading: stripeStatusLoading } = useQuery({
    queryKey: ["billing", "stripe-status", selectedCompanyId],
    queryFn: () => costsApi.stripeStatus(selectedCompanyId!),
    enabled: Boolean(selectedCompanyId && canReadBilling),
  });
  const stripePortalMutation = useMutation({
    mutationFn: () => costsApi.createStripePortalSession(selectedCompanyId!),
    onSuccess: (result) => {
      window.location.assign(result.url);
    },
  });
  const stripeTopUpMutation = useMutation({
    mutationFn: () => costsApi.createStripeCheckoutSession(selectedCompanyId!, 10_000),
    onSuccess: (result) => {
      window.location.assign(result.url);
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

  const weekBars = useMemo(
    () => weekChartRows(dailyRows, weekRange.from),
    [dailyRows, weekRange.from],
  );
  const maxWeekTokens = useMemo(
    () => Math.max(...weekBars.map((b) => b.tokens), 1),
    [weekBars],
  );

  const utilizationPct = costSummary?.utilizationPercent ?? 0;
  const budgetCents = costSummary?.budgetCents ?? 0;
  const modelSpendMonth = costSummary?.modelSpendCents ?? 0;

  useEffect(() => {
    setBreadcrumbs([
      { label: selectedCompany?.name ?? "Company", href: "/dashboard" },
      { label: "Billing" },
    ]);
  }, [setBreadcrumbs, selectedCompany?.name]);

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

  const usageLoading = summaryLoading || byBillerLoading || dailyLoading;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 pb-12">
      <div>
        <h1 className="text-xl font-bold">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Subscription, token usage, and invoices for this company.
        </p>
        {!canReadCosts ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Usage and spend from model pricing require the Costs permission.
          </p>
        ) : null}
      </div>

      <Card className="rounded-lg border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold">Account credit</CardTitle>
          <CardDescription className="text-xs">
            Instance-wide prepaid balance. Usage is the sum of{" "}
            <span className="font-mono">model_cost_cents</span> across all companies (same estimates as the Costs
            page).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {!canReadCosts ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : prepaidLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : prepaidError ? (
            <p className="text-sm text-destructive">Could not load account credit.</p>
          ) : prepaidBalance ? (
            <>
              <div className="grid gap-3 sm:grid-cols-3">
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Prepaid</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">
                    {formatCents(prepaidBalance.prepaidCents)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Used</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">
                    {formatCents(prepaidBalance.usedModelCents)}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Remaining</div>
                  <div className="mt-1 text-lg font-semibold tabular-nums">
                    {formatCents(prepaidBalance.remainingCents)}
                  </div>
                </div>
              </div>
              {prepaidBalance.prepaidCents > 0 ? (
                <UsageBar value={prepaidBalance.usedModelCents} max={prepaidBalance.prepaidCents} />
              ) : null}
            </>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="rounded-lg border-border">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-sm font-semibold">Spend this month</CardTitle>
                <CardDescription className="text-xs">
                  Model-based total from <span className="font-mono">cost_events.model_cost_cents</span>{" "}
                  (token counts × server pricing table at event time).
                </CardDescription>
              </div>
              {budgetCents > 0 ? (
                <Badge variant="secondary" className="shrink-0 font-medium">
                  Budget on
                </Badge>
              ) : null}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {!canReadCosts ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : usageLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm text-muted-foreground">Model-based spend</span>
                  <span className="text-lg font-semibold tabular-nums">
                    {formatCents(modelSpendMonth)}
                  </span>
                </div>
                {budgetCents > 0 ? (
                  <>
                    <div className="flex items-baseline justify-between gap-2 text-xs text-muted-foreground">
                      <span>Monthly budget</span>
                      <span className="font-mono tabular-nums">{formatCents(budgetCents)}</span>
                    </div>
                    <UsageBar value={modelSpendMonth} max={budgetCents} />
                    <p className="text-xs text-muted-foreground">
                      {utilizationPct.toFixed(0)}% of budget used (UTC month to date).
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Set a company monthly budget on the Costs page to track utilization here.
                  </p>
                )}
              </>
            )}
            <Button type="button" variant="outline" size="sm" className="w-full" disabled>
              Manage plan
              <ArrowUpRight className="ml-1 h-3.5 w-3.5 opacity-60" />
            </Button>
          </CardContent>
        </Card>

        <Card className="rounded-lg border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-muted-foreground" aria-hidden />
              <CardTitle className="text-sm font-semibold">Token usage</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Totals for the current UTC month. Dollar estimate uses the same pricing table as the Costs
              page.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {!canReadCosts ? (
              <p className="text-sm text-muted-foreground">—</p>
            ) : usageLoading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : totalTokens === 0 ? (
              <p className="text-sm text-muted-foreground">No usage recorded this month yet.</p>
            ) : (
              <>
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <div className="text-2xl font-bold tabular-nums">{formatTokens(totalTokens)}</div>
                    <div className="text-xs text-muted-foreground">tokens (in + cached in + out)</div>
                  </div>
                </div>
                {budgetCents > 0 ? (
                  <UsageBar value={modelSpendMonth} max={budgetCents} />
                ) : null}
                <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Adapter-billed:</span>{" "}
                  {formatCents(tokenRollup.costCents)}
                  <span className="mx-2 text-border">·</span>
                  <span className="font-medium text-foreground">Model estimate:</span>{" "}
                  {formatCents(tokenRollup.modelCostCents)}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-lg border-border bg-card">
        <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">Payment</p>
            <p className="mt-0.5 text-sm text-muted-foreground">Update your payment details</p>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={stripeStatusLoading || !stripeStatus?.enabled || stripePortalMutation.isPending}
              title={!stripeStatus?.enabled ? "Set STRIPE_SECRET_KEY to enable Stripe billing actions" : undefined}
              onClick={() => stripePortalMutation.mutate()}
            >
              {stripePortalMutation.isPending ? "Opening..." : "Manage in Stripe"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={
                stripeStatusLoading ||
                !stripeStatus?.enabled ||
                !stripeStatus?.hasWebhookSecret ||
                stripeTopUpMutation.isPending
              }
              title={
                !stripeStatus?.enabled
                  ? "Set STRIPE_SECRET_KEY to enable Stripe billing actions"
                  : !stripeStatus?.hasWebhookSecret
                    ? "Set STRIPE_WEBHOOK_SECRET so top-ups are credited automatically"
                    : undefined
              }
              onClick={() => stripeTopUpMutation.mutate()}
            >
              {stripeTopUpMutation.isPending ? "Opening checkout..." : "Add $100 test credit"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-lg border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" aria-hidden />
            <CardTitle className="text-sm font-semibold">Usage this week</CardTitle>
          </div>
          <CardDescription className="text-xs">
            Daily tokens (UTC week). Same underlying events as Costs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!canReadCosts ? (
            <p className="text-sm text-muted-foreground">—</p>
          ) : usageLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="flex h-28 items-end gap-2">
              {weekBars.map((row) => {
                const h = Math.max(8, Math.round((row.tokens / maxWeekTokens) * 100));
                return (
                  <div key={row.label} className="flex flex-1 flex-col items-center gap-1">
                    <div
                      className="w-full max-w-[2.5rem] rounded-sm bg-primary/80 dark:bg-primary/70"
                      style={{ height: `${h}%` }}
                      title={`${row.label}: ${formatTokens(row.tokens)}`}
                    />
                    <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {row.label}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="rounded-lg border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-muted-foreground" aria-hidden />
            <CardTitle className="text-sm font-semibold">Invoices</CardTitle>
          </div>
          <CardDescription className="text-xs">Recent invoices and payment status.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border border-border">
            <div className="grid grid-cols-3 gap-2 border-b border-border px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>Date</span>
              <span>Amount</span>
              <span>Status</span>
            </div>
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">No invoices yet.</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
