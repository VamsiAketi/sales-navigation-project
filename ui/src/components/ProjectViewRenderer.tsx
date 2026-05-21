import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ProjectViewWidget } from "@paperclipai/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MetricCard } from "@/components/MetricCard";
import { DASHBOARD_CHART_INSET } from "@/lib/dashboard-tile-styles";
import { BarChart3, LayoutDashboard } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";

type WidgetDataMap = Record<string, { rows: Record<string, unknown>[]; error: string | null }>;

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

function renderTable(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No rows returned.</p>;
  const columns = Object.keys(rows[0] ?? {});
  return (
    <div className="overflow-auto rounded border border-border/70">
      <table className="w-full text-xs">
        <thead className="bg-muted/40">
          <tr>
            {columns.map((col) => (
              <th key={col} className="px-2 py-1 text-left font-medium">{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map((row, idx) => (
            <tr key={idx} className="border-t border-border/60">
              {columns.map((col) => (
                <td key={`${idx}-${col}`} className="px-2 py-1">{stringifyValue(row[col])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function renderChart(rows: Record<string, unknown>[]) {
  if (rows.length === 0) return <p className="text-xs text-muted-foreground">No rows returned.</p>;
  const firstRow = rows[0] ?? {};
  const keys = Object.keys(firstRow);
  const valueKey = keys.find((key) => numericValue(firstRow[key]) !== null) ?? null;
  const labelKey = keys.find((key) => key !== valueKey) ?? keys[0] ?? null;
  if (!valueKey || !labelKey) {
    return <p className="text-xs text-muted-foreground">Unable to infer chart keys from query rows.</p>;
  }
  const data = rows
    .slice(0, 12)
    .map((row) => ({ label: stringifyValue(row[labelKey]), value: numericValue(row[valueKey]) ?? 0 }));
  return (
    <div className={DASHBOARD_CHART_INSET}>
      <ResponsiveContainer width="100%" height={170}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
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
  if (widgets.length === 0) {
    return <EmptyState icon={LayoutDashboard} message="No widgets configured for this dashboard yet." />;
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {widgets.map((widget) => {
        const widgetData = widgetDataById[widget.id];
        const rows = widgetData?.rows ?? [];
        const error = widgetData?.error ?? null;
        const title = widget.title ?? `${widget.type} widget`;

        if (widget.type === "kpi") {
          const firstRow = rows[0] ?? {};
          const keys = Object.keys(firstRow);
          const valueKey = keys.find((key) => numericValue(firstRow[key]) !== null) ?? null;
          const value = valueKey ? numericValue(firstRow[valueKey]) ?? "n/a" : "n/a";
          return (
            <div key={widget.id} className="min-h-[120px]">
              <MetricCard
                icon={BarChart3}
                value={value}
                label={title}
                description={error ? `Error: ${error}` : valueKey ? `Source: ${valueKey}` : "No numeric value found"}
                iconTint="sky"
              />
            </div>
          );
        }

        if (widget.type === "markdown") {
          const markdown = typeof widget.config?.markdown === "string" ? widget.config.markdown : "_No markdown content._";
          return (
            <Card key={widget.id} className="border-border/70">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{title}</CardTitle>
              </CardHeader>
              <CardContent>
                <pre className="whitespace-pre-wrap text-xs text-muted-foreground">{markdown}</pre>
              </CardContent>
            </Card>
          );
        }

        return (
          <Card key={widget.id} className="border-border/70">
            <CardHeader className="pb-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-sm">{title}</CardTitle>
                <Badge variant="outline" className="text-[10px]">{widget.type}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              {widget.type === "table" ? renderTable(rows) : renderChart(rows)}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
