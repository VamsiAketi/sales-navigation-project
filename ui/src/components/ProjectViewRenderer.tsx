import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProjectViewWidget } from "@paperclipai/shared";
import {
  parseProjectViewWidgetConfig,
  parseProjectViewWidgetLayout,
  resolveProjectViewWidgetChartHeight,
  resolveProjectViewWidgetMarkdownMaxHeight,
  resolveProjectViewWidgetPageSize,
} from "@paperclipai/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MetricCard } from "@/components/MetricCard";
import { DASHBOARD_CHART_INSET, DASHBOARD_TILE_SURFACE } from "@/lib/dashboard-tile-styles";
import { BarChart3, ChevronLeft, ChevronRight, LayoutDashboard } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";

type WidgetDataMap = Record<string, { rows: Record<string, unknown>[]; error: string | null }>;

const COL_SPAN_CLASS: Record<1 | 2 | 3, string> = {
  1: "sm:col-span-1",
  2: "sm:col-span-2",
  3: "sm:col-span-2 xl:col-span-3",
};

function stringifyValue(value: unknown): string {
  if (value == null) return "n/a";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function resolveTableColumns(
  rows: Record<string, unknown>[],
  configColumns: string[] | undefined,
): string[] {
  const fromRow = Object.keys(rows[0] ?? {});
  if (!configColumns?.length) return fromRow;
  const allowed = new Set(fromRow);
  return configColumns.filter((col) => allowed.has(col));
}

function WidgetTile({
  widget,
  layout,
  children,
  title,
  badge,
  bodyClassName,
  bodyStyle,
}: {
  widget: ProjectViewWidget;
  layout: ReturnType<typeof parseProjectViewWidgetLayout>;
  children: ReactNode;
  title: string;
  badge?: string;
  bodyClassName?: string;
  bodyStyle?: CSSProperties;
}) {
  const colSpan = layout.colSpan ?? 1;
  const colClass = COL_SPAN_CLASS[colSpan === 2 || colSpan === 3 ? colSpan : 1];

  return (
    <div
      className={cn(colClass, "min-w-0")}
      style={layout.minHeight ? { minHeight: layout.minHeight } : undefined}
    >
      <Card className={cn(DASHBOARD_TILE_SURFACE, "flex h-full flex-col border-border/60")}>
        <CardHeader className="shrink-0 pb-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-sm font-medium tracking-tight">{title}</CardTitle>
            {badge ? (
              <Badge variant="outline" className="text-[10px] font-normal">
                {badge}
              </Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent
          className={cn("min-h-0 flex-1 pt-0", bodyClassName)}
          style={bodyStyle}
        >
          {children}
        </CardContent>
      </Card>
    </div>
  );
}

function PaginatedTable({
  widgetId,
  rows,
  columns,
  pageSize,
  maxHeight,
  compact,
}: {
  widgetId: string;
  rows: Record<string, unknown>[];
  columns: string[];
  pageSize: number;
  maxHeight: number | undefined;
  compact: boolean;
}) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * pageSize;
  const pageRows = rows.slice(start, start + pageSize);
  const textClass = compact ? "text-[11px]" : "text-xs";
  const cellPad = compact ? "px-2 py-0.5" : "px-2 py-1";

  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">No rows returned.</p>;
  }

  if (columns.length === 0) {
    return <p className="text-xs text-muted-foreground">No columns to display.</p>;
  }

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <div
        className="overflow-auto rounded-lg border border-border/70 bg-muted/[0.12]"
        style={maxHeight ? { maxHeight } : { maxHeight: 360 }}
      >
        <table className={cn("w-full", textClass)}>
          <thead className="sticky top-0 z-[1] bg-muted/80 backdrop-blur-sm">
            <tr>
              {columns.map((col) => (
                <th key={col} className={cn(cellPad, "text-left font-medium")}>
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, idx) => (
              <tr key={`${widgetId}-${start + idx}`} className="border-t border-border/50">
                {columns.map((col) => (
                  <td key={`${start + idx}-${col}`} className={cn(cellPad, "align-top")}>
                    {stringifyValue(row[col])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > pageSize ? (
        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
          <span>
            {start + 1}–{Math.min(start + pageSize, rows.length)} of {rows.length}
          </span>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              disabled={safePage <= 0}
              aria-label="Previous page"
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              <ChevronLeft />
            </Button>
            <span className="min-w-[4.5rem] text-center tabular-nums">
              {safePage + 1} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="icon-xs"
              disabled={safePage >= totalPages - 1}
              aria-label="Next page"
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">{rows.length} row{rows.length === 1 ? "" : "s"}</p>
      )}
    </div>
  );
}

function renderChart(rows: Record<string, unknown>[], chartHeight: number) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No rows returned.</p>;
  const firstRow = rows[0] ?? {};
  const keys = Object.keys(firstRow);
  const valueKey = keys.find((key) => numericValue(firstRow[key]) !== null) ?? null;
  const labelKey = keys.find((key) => key !== valueKey) ?? keys[0] ?? null;
  if (!valueKey || !labelKey) {
    return <p className="text-xs text-muted-foreground">Unable to infer chart keys from query rows.</p>;
  }
  const data = rows
    .slice(0, 24)
    .map((row) => ({ label: stringifyValue(row[labelKey]), value: numericValue(row[valueKey]) ?? 0 }));
  return (
    <div className={DASHBOARD_CHART_INSET}>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" className="stroke-border/50" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} />
          <Tooltip />
          <Bar dataKey="value" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ProjectViewRenderer({
  widgets,
  widgetDataById,
}: {
  widgets: ProjectViewWidget[];
  widgetDataById: WidgetDataMap;
}) {
  const sortedWidgets = useMemo(
    () =>
      [...widgets].sort((a, b) => {
        const byPos = a.position - b.position;
        if (byPos !== 0) return byPos;
        const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : new Date(String(a.createdAt)).getTime();
        const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : new Date(String(b.createdAt)).getTime();
        return ta - tb;
      }),
    [widgets],
  );

  if (sortedWidgets.length === 0) {
    return <EmptyState icon={LayoutDashboard} message="No widgets configured for this dashboard yet." />;
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {sortedWidgets.map((widget) => {
        const widgetData = widgetDataById[widget.id];
        const rows = widgetData?.rows ?? [];
        const error = widgetData?.error ?? null;
        const title = widget.title ?? `${widget.type} widget`;
        const layout = parseProjectViewWidgetLayout(widget.layout);
        const config = parseProjectViewWidgetConfig(widget.config);

        if (widget.type === "kpi") {
          const firstRow = rows[0] ?? {};
          const keys = Object.keys(firstRow);
          const valueKey = keys.find((key) => numericValue(firstRow[key]) !== null) ?? null;
          const value = valueKey ? (numericValue(firstRow[valueKey]) ?? "n/a") : "n/a";
          const colSpan = layout.colSpan ?? 1;
          const colClass = COL_SPAN_CLASS[colSpan === 2 || colSpan === 3 ? colSpan : 1];
          return (
            <div
              key={widget.id}
              className={cn(colClass, "min-h-[120px] min-w-0")}
              style={layout.minHeight ? { minHeight: layout.minHeight } : undefined}
            >
              <MetricCard
                icon={BarChart3}
                value={value}
                label={title}
                description={
                  error
                    ? `Error: ${error}`
                    : valueKey
                      ? `Source: ${valueKey}`
                      : "No numeric value found"
                }
                iconTint="sky"
              />
            </div>
          );
        }

        if (widget.type === "markdown") {
          const markdown =
            typeof config.markdown === "string" ? config.markdown : "_No markdown content._";
          const maxHeight = resolveProjectViewWidgetMarkdownMaxHeight(layout);
          return (
            <WidgetTile key={widget.id} widget={widget} layout={layout} title={title} badge="markdown">
              <div
                className="overflow-y-auto rounded-md border border-border/50 bg-muted/[0.08] p-3"
                style={{ maxHeight }}
              >
                <pre className="whitespace-pre-wrap font-sans text-xs leading-relaxed text-muted-foreground">
                  {markdown}
                </pre>
              </div>
            </WidgetTile>
          );
        }

        const pageSize = resolveProjectViewWidgetPageSize(config);
        const tableMaxHeight = layout.maxHeight;
        const chartHeight = resolveProjectViewWidgetChartHeight(layout);
        const columns = resolveTableColumns(rows, config.columns);

        return (
          <WidgetTile
            key={widget.id}
            widget={widget}
            layout={layout}
            title={title}
            badge={widget.type}
          >
            {error ? <p className="mb-2 text-xs text-destructive">{error}</p> : null}
            {widget.type === "table" ? (
              <PaginatedTable
                widgetId={widget.id}
                rows={rows}
                columns={columns}
                pageSize={pageSize}
                maxHeight={tableMaxHeight}
                compact={config.compact === true}
              />
            ) : (
              renderChart(rows, chartHeight)
            )}
          </WidgetTile>
        );
      })}
    </div>
  );
}
