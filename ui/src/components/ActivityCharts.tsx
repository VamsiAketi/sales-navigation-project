import {
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, CartesianGrid,
} from "recharts";
import type { HeartbeatRun } from "@paperclipai/shared";

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

/* ── Shared chart primitives ──────────────────────────────────────────────── */

const AXIS_STYLE = { fontSize: 9, fill: "hsl(var(--muted-foreground))", fontFamily: "inherit" };
const GRID_COLOR = "hsl(var(--border))";

function CustomTooltipBox({ active, payload, label, rows }: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
  rows?: { key: string; label: string; color: string }[];
}) {
  if (!active || !payload?.length) return null;
  const entries = rows
    ? rows.map(r => ({ label: r.label, value: payload.find(p => p.name === r.key)?.value ?? 0, color: r.color }))
    : payload.map(p => ({ label: p.name, value: p.value, color: p.color }));
  const shown = entries.filter(e => e.value > 0);
  if (!shown.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-xl text-xs min-w-[90px]">
      {label && <p className="text-muted-foreground mb-1.5 font-medium">{label}</p>}
      {shown.map(e => (
        <div key={e.label} className="flex items-center justify-between gap-3">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: e.color }} />
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
    <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-2">
      {items.map(item => (
        <span key={item.label} className="flex items-center gap-1 text-[9px] text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

export function ChartCard({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className="mb-3">
        <p className="text-sm font-semibold">{title}</p>
        {subtitle && <p className="text-[10px] text-muted-foreground/70 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/* ── Run Activity ─────────────────────────────────────────────────────────── */

const RUN_COLORS = { succeeded: "#10b981", failed: "#f43f5e", other: "#94a3b8" };

export function RunActivityChart({ runs }: { runs: HeartbeatRun[] }) {
  const days = getLast14Days();
  const grouped = new Map(days.map(d => [d, { succeeded: 0, failed: 0, other: 0 }]));
  for (const run of runs) {
    const day = new Date(run.createdAt).toISOString().slice(0, 10);
    const e = grouped.get(day);
    if (!e) continue;
    if (run.status === "succeeded") e.succeeded++;
    else if (run.status === "failed" || run.status === "timed_out") e.failed++;
    else e.other++;
  }

  const hasData = Array.from(grouped.values()).some(v => v.succeeded + v.failed + v.other > 0);
  if (!hasData) return <p className="text-xs text-muted-foreground py-8 text-center">No runs yet</p>;

  const data = days.map(d => ({ date: fmtDay(d), ...grouped.get(d)! }));

  return (
    <>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} barSize={10} barGap={1} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeOpacity={0.5} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <Tooltip
            content={<CustomTooltipBox rows={[
              { key: "succeeded", label: "Succeeded", color: RUN_COLORS.succeeded },
              { key: "failed",    label: "Failed",    color: RUN_COLORS.failed },
              { key: "other",     label: "Other",     color: RUN_COLORS.other },
            ]} />}
            cursor={{ fill: "hsl(var(--muted))", radius: 4 }}
          />
          <Bar dataKey="succeeded" stackId="a" fill={RUN_COLORS.succeeded} />
          <Bar dataKey="failed"    stackId="a" fill={RUN_COLORS.failed} />
          <Bar dataKey="other"     stackId="a" fill={RUN_COLORS.other} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <Legend items={[
        { color: RUN_COLORS.succeeded, label: "Succeeded" },
        { color: RUN_COLORS.failed,    label: "Failed" },
        { color: RUN_COLORS.other,     label: "Other" },
      ]} />
    </>
  );
}

/* ── Issues by Priority ───────────────────────────────────────────────────── */

const PRIORITY_COLORS = { critical: "#f43f5e", high: "#f97316", medium: "#fbbf24", low: "#94a3b8" };
const PRIORITY_ORDER = ["critical", "high", "medium", "low"] as const;

export function PriorityChart({ issues }: { issues: { priority: string; createdAt: Date }[] }) {
  const days = getLast14Days();
  const grouped = new Map(days.map(d => [d, { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>]));
  for (const issue of issues) {
    const day = new Date(issue.createdAt).toISOString().slice(0, 10);
    const e = grouped.get(day);
    if (!e || !(issue.priority in e)) continue;
    e[issue.priority]++;
  }

  const hasData = Array.from(grouped.values()).some(v => Object.values(v).some(n => n > 0));
  if (!hasData) return <p className="text-xs text-muted-foreground py-8 text-center">No issues yet</p>;

  const data = days.map(d => ({ date: fmtDay(d), ...grouped.get(d)! }));

  return (
    <>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} barSize={10} barGap={1} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeOpacity={0.5} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <Tooltip
            content={<CustomTooltipBox rows={PRIORITY_ORDER.map(p => ({ key: p, label: p.charAt(0).toUpperCase() + p.slice(1), color: PRIORITY_COLORS[p] }))} />}
            cursor={{ fill: "hsl(var(--muted))", radius: 4 }}
          />
          <Bar dataKey="critical" stackId="a" fill={PRIORITY_COLORS.critical} />
          <Bar dataKey="high"     stackId="a" fill={PRIORITY_COLORS.high} />
          <Bar dataKey="medium"   stackId="a" fill={PRIORITY_COLORS.medium} />
          <Bar dataKey="low"      stackId="a" fill={PRIORITY_COLORS.low} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <Legend items={PRIORITY_ORDER.map(p => ({ color: PRIORITY_COLORS[p], label: p.charAt(0).toUpperCase() + p.slice(1) }))} />
    </>
  );
}

/* ── Issues by Status ─────────────────────────────────────────────────────── */

const STATUS_COLORS: Record<string, string> = {
  todo: "#60a5fa", in_progress: "#a78bfa", in_review: "#c084fc",
  done: "#34d399", blocked: "#f87171", cancelled: "#94a3b8", backlog: "#64748b",
};
const STATUS_LABELS: Record<string, string> = {
  todo: "To Do", in_progress: "In Progress", in_review: "In Review",
  done: "Done", blocked: "Blocked", cancelled: "Cancelled", backlog: "Backlog",
};
const STATUS_ORDER = ["todo", "in_progress", "in_review", "done", "blocked", "cancelled", "backlog"];

export function IssueStatusChart({ issues }: { issues: { status: string; createdAt: Date }[] }) {
  const days = getLast14Days();
  const allStatuses = new Set<string>();
  const grouped = new Map(days.map(d => [d, {} as Record<string, number>]));
  for (const issue of issues) {
    const day = new Date(issue.createdAt).toISOString().slice(0, 10);
    const e = grouped.get(day);
    if (!e) continue;
    e[issue.status] = (e[issue.status] ?? 0) + 1;
    allStatuses.add(issue.status);
  }

  const active = STATUS_ORDER.filter(s => allStatuses.has(s));
  if (!active.length) return <p className="text-xs text-muted-foreground py-8 text-center">No issues yet</p>;

  const data = days.map(d => ({ date: fmtDay(d), ...grouped.get(d)! }));

  return (
    <>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} barSize={10} barGap={1} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeOpacity={0.5} strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <Tooltip
            content={<CustomTooltipBox rows={active.map(s => ({ key: s, label: STATUS_LABELS[s] ?? s, color: STATUS_COLORS[s] ?? "#94a3b8" }))} />}
            cursor={{ fill: "hsl(var(--muted))", radius: 4 }}
          />
          {active.map((s, i) => (
            <Bar key={s} dataKey={s} stackId="a" fill={STATUS_COLORS[s] ?? "#94a3b8"}
              radius={i === active.length - 1 ? [3, 3, 0, 0] : undefined} />
          ))}
        </BarChart>
      </ResponsiveContainer>
      <Legend items={active.map(s => ({ color: STATUS_COLORS[s] ?? "#94a3b8", label: STATUS_LABELS[s] ?? s }))} />
    </>
  );
}

/* ── Success Rate ─────────────────────────────────────────────────────────── */

function SuccessRateTooltip({ active, payload, label }: { active?: boolean; payload?: { value: number }[]; label?: string }) {
  if (!active || !payload?.length || payload[0]?.value == null) return null;
  const val = payload[0].value;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 shadow-xl text-xs">
      {label && <p className="text-muted-foreground mb-1 font-medium">{label}</p>}
      <span className="font-semibold text-foreground">{val}% success</span>
    </div>
  );
}

export function SuccessRateChart({ runs }: { runs: HeartbeatRun[] }) {
  const days = getLast14Days();
  const grouped = new Map(days.map(d => [d, { succeeded: 0, total: 0 }]));
  for (const run of runs) {
    const day = new Date(run.createdAt).toISOString().slice(0, 10);
    const e = grouped.get(day);
    if (!e) continue;
    e.total++;
    if (run.status === "succeeded") e.succeeded++;
  }

  const hasData = Array.from(grouped.values()).some(v => v.total > 0);
  if (!hasData) return <p className="text-xs text-muted-foreground py-8 text-center">No runs yet</p>;

  const data = days.map(d => {
    const e = grouped.get(d)!;
    return { date: fmtDay(d), rate: e.total > 0 ? Math.round((e.succeeded / e.total) * 100) : null };
  });

  return (
    <ResponsiveContainer width="100%" height={128}>
      <AreaChart data={data} margin={{ top: 4, right: 0, left: -28, bottom: 0 }}>
        <defs>
          <linearGradient id="rateGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#10b981" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={GRID_COLOR} strokeOpacity={0.5} strokeDasharray="3 3" />
        <XAxis dataKey="date" tick={AXIS_STYLE} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <Tooltip content={<SuccessRateTooltip />} cursor={{ stroke: "hsl(var(--border))", strokeWidth: 1 }} />
        <Area
          type="monotone"
          dataKey="rate"
          stroke="#10b981"
          strokeWidth={2}
          fill="url(#rateGrad)"
          dot={false}
          activeDot={{ r: 4, fill: "#10b981", strokeWidth: 0 }}
          connectNulls
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
