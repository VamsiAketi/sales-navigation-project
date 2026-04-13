/**
 * Shared outer chrome for dashboard tiles (metrics, charts, goals, costs, plugins).
 * Keep in sync wherever a “card tile” appears on the company dashboard.
 */
export const DASHBOARD_TILE_SURFACE =
  "rounded-xl border border-border bg-card shadow-sm";

/** Inner chart plot panel (nested inside a dashboard tile). */
export const DASHBOARD_CHART_INSET =
  "rounded-lg border border-border bg-muted/[0.18] p-1.5 shadow-[inset_0_1px_0_0_hsl(var(--background)/0.4)] dark:bg-muted/15 dark:shadow-[inset_0_1px_0_0_hsl(0_0%_100%/0.04)]";
