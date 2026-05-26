import { z } from "zod";

/** Default rows per page for table widgets when `config.pageSize` is omitted. */
export const PROJECT_VIEW_WIDGET_DEFAULT_PAGE_SIZE = 15;

/** Hard cap for client-side table pagination (rows must be returned via queryRef.limit). */
export const PROJECT_VIEW_WIDGET_MAX_PAGE_SIZE = 50;

export const PROJECT_VIEW_WIDGET_DEFAULT_MARKDOWN_MAX_HEIGHT = 280;

export const PROJECT_VIEW_WIDGET_DEFAULT_CHART_HEIGHT = 200;

/**
 * Grid placement and scroll/chart sizing. Set on widget `layout` when creating or updating widgets.
 * The board UI reads these fields; unknown keys are ignored.
 */
export const projectViewWidgetLayoutSchema = z
  .object({
    /** 1–3 columns on the dashboard grid (3 = full width). */
    colSpan: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
    /** Minimum tile height in pixels. */
    minHeight: z.number().int().min(80).max(800).optional(),
    /** Scrollable body max height (tables, markdown). */
    maxHeight: z.number().int().min(120).max(900).optional(),
    /** Bar chart plot height in pixels. */
    chartHeight: z.number().int().min(100).max(500).optional(),
  })
  .strict();

export type ProjectViewWidgetLayout = z.infer<typeof projectViewWidgetLayoutSchema>;

/**
 * Widget content and table behavior. Stored on widget `config`.
 * `markdown` is required for type `markdown`; other keys apply to tables/charts as noted.
 */
export const projectViewWidgetConfigSchema = z
  .object({
    markdown: z.string().max(50_000).optional(),
    /** Table rows per page (5–50). */
    pageSize: z.number().int().min(5).max(PROJECT_VIEW_WIDGET_MAX_PAGE_SIZE).optional(),
    /** Denser table typography and padding. */
    compact: z.boolean().optional(),
    /** Column keys to show, in order (must exist on query rows). */
    columns: z.array(z.string().trim().min(1).max(120)).max(40).optional(),
  })
  .passthrough();

export type ProjectViewWidgetConfig = z.infer<typeof projectViewWidgetConfigSchema>;

export function parseProjectViewWidgetLayout(
  raw: Record<string, unknown> | null | undefined,
): ProjectViewWidgetLayout {
  const parsed = projectViewWidgetLayoutSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export function parseProjectViewWidgetConfig(
  raw: Record<string, unknown> | null | undefined,
): ProjectViewWidgetConfig {
  const parsed = projectViewWidgetConfigSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

export function resolveProjectViewWidgetPageSize(
  config: ProjectViewWidgetConfig,
): number {
  return config.pageSize ?? PROJECT_VIEW_WIDGET_DEFAULT_PAGE_SIZE;
}

export function resolveProjectViewWidgetMarkdownMaxHeight(
  layout: ProjectViewWidgetLayout,
): number {
  return layout.maxHeight ?? PROJECT_VIEW_WIDGET_DEFAULT_MARKDOWN_MAX_HEIGHT;
}

export function resolveProjectViewWidgetChartHeight(
  layout: ProjectViewWidgetLayout,
): number {
  return layout.chartHeight ?? PROJECT_VIEW_WIDGET_DEFAULT_CHART_HEIGHT;
}

/** Agent-facing summary for API guides and skills. */
export const PROJECT_VIEW_WIDGET_PRESENTATION_GUIDE = [
  "Set `layout` and `config` on each widget so the board stays readable — the UI applies them automatically.",
  "Tables: use `config.pageSize` (5–50, default 15) and `queryRef.limit` up to 100 so enough rows are available for pagination.",
  "Wide tables: `layout.colSpan` 2 or 3; use `layout.maxHeight` (e.g. 320–480) for a scrollable table body.",
  "Markdown: keep copy concise; `layout.maxHeight` 240–400 enables a scroll area instead of stretching the page.",
  "Charts: `layout.chartHeight` 180–280; KPI tiles: `layout.colSpan` 1 unless the metric is primary (`colSpan` 2).",
  "Order widgets with `position` (0, 10, 20…) — KPIs first, then charts, then tables.",
] as const;
