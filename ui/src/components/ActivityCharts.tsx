import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import type { HeartbeatRun } from "@paperclipai/shared";
import { Link } from "@/lib/router";
import { ArrowRight } from "lucide-react";
import { cn } from "../lib/utils";
import { DASHBOARD_CHART_INSET, DASHBOARD_TILE_SURFACE } from "../lib/dashboard-tile-styles";

/* ── Utilities ────────────────────────────────────────────────────────────── */

export function getLast14Days(): string[] {
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (13 - i));
    return d.toISOString().slice(0, 10);
  });
}

function fmtDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Azure Portal / Fluent-inspired metric colors (readable on light + dark shells).
 * @see https://learn.microsoft.com/en-us/azure/azure-monitor/visualize/workbooks-chart-visual-settings
 */
const AZURE = {
  blue: "#0078d4",
  blueLight: "#2899f5",
  blueMuted: "#50a0d7",
  green: "#107c10",
  red: "#d13438",
  orange: "#ca5010",
  amber: "#ffb900",
  purple: "#8764b8",
  gray: "#8a8886",
  grayDark: "#605e5c",
  grid: "hsl(var(--border))",
  axis: "hsl(var(--muted-foreground))",
} as const;

const TICK_STYLE = { fontSize: 10, fill: "hsl(var(--muted-foreground))", fontFamily: "inherit" };

/* ── Shared chart primitives (Azure-style plot well + grid) ──────────────── */

function ChartPlotShell({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(DASHBOARD_CHART_INSET, className)}>{children}</div>;
}

function AzureCartesianGrid() {
  return (
    <CartesianGrid
      stroke={AZURE.grid}
      strokeOpacity={0.55}
      vertical
      horizontal
      strokeDasharray="0"
    />
  );
}

function CustomTooltipBox({
  active,
  payload,
  label,
  rows,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  rows?: { key: string; label: string; color: string }[];
}) {
  if (!active || !payload?.length) return null;
  const entries = rows
    ? rows.map((r) => ({
        label: r.label,
        value: payload.find((p) => p.name === r.key)?.value ?? 0,
        color: r.color,
      }))
    : payload.map((p) => ({ label: p.name, value: p.value, color: p.color }));
  const shown = entries.filter((e) => e.value > 0);
  if (!shown.length) return null;
  return (
    <div
      className={cn(
        "min-w-[100px] rounded-sm border border-border bg-card px-3 py-2 text-[11px] shadow-md",
        "ring-1 ring-foreground/[0.04]",
      )}
    >
      {label && <p className="mb-1.5 font-medium text-muted-foreground">{label}</p>}
      {shown.map((e) => (
        <div key={e.label} className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-2 text-muted-foreground">
            <span className="h-2 w-2 shrink-0 rounded-[1px]" style={{ backgroundColor: e.color }} />
            {e.label}
          </span>
          <span className="font-semibold tabular-nums text-foreground">{e.value}</span>
        </div>
      ))}
    </div>
  );
}

function Legend({ items }: { items: { color: string; label: string }[] }) {
  return (
    <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1 border-t border-border pt-2">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="h-2 w-2 shrink-0 rounded-[1px]" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

const LINE_MARGIN = { top: 8, right: 8, left: 2, bottom: 2 } as const;

export function ChartCard({
  title,
  subtitle,
  caption,
  to,
  drillLabel = "View details",
  children,
}: {
  title: string;
  subtitle?: string;
  /** Secondary line under subtitle (e.g. chart framing copy). */
  caption?: string;
  /** When set, the whole card links here (e.g. issues list, agents, activity). */
  to?: string;
  drillLabel?: string;
  children: React.ReactNode;
}) {
  const body = (
    <>
      <div className="mb-2">
        <p className="text-[13px] font-semibold leading-tight tracking-tight text-foreground">{title}</p>
        {subtitle && <p className="mt-0.5 text-[11px] text-muted-foreground">{subtitle}</p>}
        {caption && <p className="mt-1 text-[11px] text-muted-foreground/90">{caption}</p>}
      </div>
      {children}
      {to ? (
        <p className="mt-2 flex items-center gap-1 text-[10px] font-medium text-muted-foreground group-hover/chart:text-foreground">
          {drillLabel}
          <ArrowRight className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
        </p>
      ) : null}
    </>
  );

  if (to) {
    return (
      <Link
        to={to}
        className={cn(
          DASHBOARD_TILE_SURFACE,
          "group/chart block p-4 no-underline text-inherit outline-none",
          "transition-colors hover:border-border hover:bg-accent/25 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        )}
      >
        {body}
      </Link>
    );
  }

  return <div className={cn(DASHBOARD_TILE_SURFACE, "p-4")}>{body}</div>;
}

/* ── Run Activity ─────────────────────────────────────────────────────────── */

const RUN_COLORS = { succeeded: AZURE.green, failed: AZURE.red, other: AZURE.grayDark } as const;

export function RunActivityChart({ runs }: { runs: HeartbeatRun[] }) {
  const days = getLast14Days();
  const grouped = new Map(days.map((d) => [d, { succeeded: 0, failed: 0, other: 0 }]));
  for (const run of runs) {
    const day = new Date(run.createdAt).toISOString().slice(0, 10);
    const e = grouped.get(day);
    if (!e) continue;
    if (run.status === "succeeded") e.succeeded++;
    else if (run.status === "failed" || run.status === "timed_out") e.failed++;
    else e.other++;
  }

  const data = days.map((d) => ({ date: fmtDay(d), ...grouped.get(d)! }));

  return (
    <>
      <ChartPlotShell>
        <ResponsiveContainer width="100%" height={112}>
          <LineChart data={data} margin={LINE_MARGIN}>
            <AzureCartesianGrid />
            <XAxis
              dataKey="date"
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={{ stroke: AZURE.grid, strokeOpacity: 0.8 }}
              interval="preserveStartEnd"
            />
            <YAxis
              width={26}
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              tickMargin={4}
            />
            <Tooltip
              content={
                <CustomTooltipBox
                  rows={[
                    { key: "succeeded", label: "Succeeded", color: RUN_COLORS.succeeded },
                    { key: "failed", label: "Failed / timed out", color: RUN_COLORS.failed },
                    { key: "other", label: "Other", color: RUN_COLORS.other },
                  ]}
                />
              }
              cursor={{ stroke: AZURE.grid, strokeWidth: 1, strokeOpacity: 0.6 }}
            />
            <Line type="monotone" dataKey="succeeded" name="Succeeded" stroke={RUN_COLORS.succeeded} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="failed" name="Failed / timed out" stroke={RUN_COLORS.failed} strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="other" name="Other" stroke={RUN_COLORS.other} strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartPlotShell>
      <Legend
        items={[
          { color: RUN_COLORS.succeeded, label: "Succeeded" },
          { color: RUN_COLORS.failed, label: "Failed / timed out" },
          { color: RUN_COLORS.other, label: "Other" },
        ]}
      />
    </>
  );
}

/* ── Issues by Priority ───────────────────────────────────────────────────── */

const PRIORITY_COLORS = {
  critical: AZURE.red,
  high: AZURE.orange,
  medium: AZURE.amber,
  low: AZURE.gray,
} as const;
const PRIORITY_ORDER = ["critical", "high", "medium", "low"] as const;

export function PriorityChart({ issues }: { issues: { priority: string; createdAt: Date }[] }) {
  const days = getLast14Days();
  const grouped = new Map(
    days.map((d) => [d, { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>]),
  );
  for (const issue of issues) {
    const day = new Date(issue.createdAt).toISOString().slice(0, 10);
    const e = grouped.get(day);
    if (!e || !(issue.priority in e)) continue;
    e[issue.priority]++;
  }

  const data = days.map((d) => ({ date: fmtDay(d), ...grouped.get(d)! }));

  return (
    <>
      <ChartPlotShell>
        <ResponsiveContainer width="100%" height={112}>
          <LineChart data={data} margin={LINE_MARGIN}>
            <AzureCartesianGrid />
            <XAxis
              dataKey="date"
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={{ stroke: AZURE.grid, strokeOpacity: 0.8 }}
              interval="preserveStartEnd"
            />
            <YAxis width={26} tick={TICK_STYLE} tickLine={false} axisLine={false} allowDecimals={false} tickMargin={4} />
            <Tooltip
              content={
                <CustomTooltipBox
                  rows={PRIORITY_ORDER.map((p) => ({
                    key: p,
                    label: p.charAt(0).toUpperCase() + p.slice(1),
                    color: PRIORITY_COLORS[p],
                  }))}
                />
              }
              cursor={{ stroke: AZURE.grid, strokeWidth: 1, strokeOpacity: 0.6 }}
            />
            {PRIORITY_ORDER.map((p) => (
              <Line
                key={p}
                type="monotone"
                dataKey={p}
                stroke={PRIORITY_COLORS[p]}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartPlotShell>
      <Legend
        items={PRIORITY_ORDER.map((p) => ({
          color: PRIORITY_COLORS[p],
          label: p.charAt(0).toUpperCase() + p.slice(1),
        }))}
      />
    </>
  );
}

/* ── Issues by Status ─────────────────────────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  todo: AZURE.blue,
  in_progress: AZURE.blueLight,
  in_review: AZURE.purple,
  done: AZURE.green,
  blocked: AZURE.red,
  cancelled: AZURE.gray,
  backlog: AZURE.grayDark,
};
const STATUS_LABELS: Record<string, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  in_review: "In Review",
  done: "Done",
  blocked: "Blocked",
  cancelled: "Cancelled",
  backlog: "Backlog",
};
const STATUS_ORDER = ["todo", "in_progress", "in_review", "done", "blocked", "cancelled", "backlog"];

export function IssueStatusChart({ issues }: { issues: { status: string; createdAt: Date }[] }) {
  const days = getLast14Days();
  const allStatuses = new Set<string>();
  const grouped = new Map(days.map((d) => [d, {} as Record<string, number>]));
  for (const issue of issues) {
    const day = new Date(issue.createdAt).toISOString().slice(0, 10);
    const e = grouped.get(day);
    if (!e) continue;
    e[issue.status] = (e[issue.status] ?? 0) + 1;
    allStatuses.add(issue.status);
  }

  const active = STATUS_ORDER.filter((s) => allStatuses.has(s));
  if (!active.length) return <p className="py-8 text-center text-xs text-muted-foreground">No tasks yet</p>;

  const data = days.map((d) => {
    const raw = grouped.get(d)!;
    return { date: fmtDay(d), ...Object.fromEntries(active.map((s) => [s, raw[s] ?? 0])) };
  });

  return (
    <>
      <ChartPlotShell>
        <ResponsiveContainer width="100%" height={112}>
          <LineChart data={data} margin={LINE_MARGIN}>
            <AzureCartesianGrid />
            <XAxis
              dataKey="date"
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={{ stroke: AZURE.grid, strokeOpacity: 0.8 }}
              interval="preserveStartEnd"
            />
            <YAxis width={26} tick={TICK_STYLE} tickLine={false} axisLine={false} allowDecimals={false} tickMargin={4} />
            <Tooltip
              content={
                <CustomTooltipBox
                  rows={active.map((s) => ({
                    key: s,
                    label: STATUS_LABELS[s] ?? s,
                    color: STATUS_COLORS[s] ?? AZURE.gray,
                  }))}
                />
              }
              cursor={{ stroke: AZURE.grid, strokeWidth: 1, strokeOpacity: 0.6 }}
            />
            {active.map((s) => (
              <Line
                key={s}
                type="monotone"
                dataKey={s}
                stroke={STATUS_COLORS[s] ?? AZURE.gray}
                strokeWidth={2}
                dot={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </ChartPlotShell>
      <Legend
        items={active.map((s) => ({
          color: STATUS_COLORS[s] ?? AZURE.gray,
          label: STATUS_LABELS[s] ?? s,
        }))}
      />
    </>
  );
}

/* ── Success Rate ─────────────────────────────────────────────────────────── */

function SuccessRateTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { value: number }[];
  label?: string;
}) {
  if (!active || !payload?.length || payload[0]?.value == null) return null;
  const val = payload[0].value;
  return (
    <div
      className={cn(
        "rounded-sm border border-border bg-card px-3 py-2 text-[11px] shadow-md",
        "ring-1 ring-foreground/[0.04]",
      )}
    >
      {label && <p className="mb-1 font-medium text-muted-foreground">{label}</p>}
      <span className="font-semibold tabular-nums text-foreground">{val}% success</span>
    </div>
  );
}

export function SuccessRateChart({ runs }: { runs: HeartbeatRun[] }) {
  const days = getLast14Days();
  const grouped = new Map(days.map((d) => [d, { succeeded: 0, total: 0 }]));
  for (const run of runs) {
    const day = new Date(run.createdAt).toISOString().slice(0, 10);
    const e = grouped.get(day);
    if (!e) continue;
    e.total++;
    if (run.status === "succeeded") e.succeeded++;
  }

  const data = days.map((d) => {
    const e = grouped.get(d)!;
    return { date: fmtDay(d), rate: e.total > 0 ? Math.round((e.succeeded / e.total) * 100) : null };
  });

  let totalRuns = 0;
  let totalSucceeded = 0;
  for (const d of days) {
    const e = grouped.get(d)!;
    totalRuns += e.total;
    totalSucceeded += e.succeeded;
  }
  const avgPeriod =
    totalRuns > 0 ? Math.round((totalSucceeded / totalRuns) * 100) : 0;

  let latestDayRate: number | null = null;
  for (let i = days.length - 1; i >= 0; i--) {
    const e = grouped.get(days[i]!)!;
    if (e.total > 0) {
      latestDayRate = Math.round((e.succeeded / e.total) * 100);
      break;
    }
  }

  return (
    <>
      <ChartPlotShell>
        <ResponsiveContainer width="100%" height={112}>
          <LineChart data={data} margin={LINE_MARGIN}>
            <AzureCartesianGrid />
            <XAxis
              dataKey="date"
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={{ stroke: AZURE.grid, strokeOpacity: 0.8 }}
              interval="preserveStartEnd"
            />
            <YAxis
              domain={[0, 100]}
              ticks={[0, 25, 50, 75, 100]}
              width={30}
              tick={TICK_STYLE}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${v}%`}
              tickMargin={4}
            />
            <Tooltip content={<SuccessRateTooltip />} cursor={{ stroke: AZURE.blueMuted, strokeWidth: 1, strokeOpacity: 0.6 }} />
            <Line
              type="monotone"
              dataKey="rate"
              stroke={AZURE.blue}
              strokeWidth={2}
              dot={false}
              connectNulls
              activeDot={{ r: 4, fill: AZURE.blue, stroke: "hsl(var(--card))", strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartPlotShell>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 border-t border-border pt-2 text-[10px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 shrink-0 rounded-[1px]" style={{ backgroundColor: AZURE.blue }} />
          Avg success (period) ({avgPeriod}%)
        </span>
        <span>
          Latest day ({latestDayRate != null ? `${latestDayRate}%` : "—"})
        </span>
        <span>Total runs ({totalRuns})</span>
      </div>
    </>
  );
}
