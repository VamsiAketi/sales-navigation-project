import { PROJECT_VIEW_WIDGET_PRESENTATION_GUIDE } from "@paperclipai/shared";

export type ProjectDataObjectGuideInput = {
  kind: string;
  name: string;
  definition: Record<string, unknown>;
};

export type ProjectViewGuideInput = {
  id: string;
  name: string;
  description?: string | null;
};

export type ProjectViewWidgetGuideInput = {
  id: string;
  title: string | null;
  type: string;
  position?: number;
  queryRef: Record<string, unknown> | null;
  config?: Record<string, unknown> | null;
  layout?: Record<string, unknown> | null;
};

/** Standing rules: project dashboards are operator-facing, not agent telemetry. */
export const PROJECT_DASHBOARD_BUSINESS_RULES = [
  "Dashboards are for **business users** (operators, sales, leadership) on Project → Context → Dashboards — not engineering debug boards.",
  "Each widget must answer a business question: pipeline volume, conversion by stage, backlog aging, regional mix, weekly trend, recent accounts, etc.",
  "Use **kpi** for one aggregate (e.g. open leads, verified this week); **chart** for breakdowns by stage/segment/region; **table** for recent rows with human-readable columns.",
  "Titles and descriptions are plain language for humans — not API paths, not internal codes.",
  "queryRef must point at **project data tables or SQL views** (operational records), not Paperclip system tables.",
];

export const PROJECT_DASHBOARD_ANTI_PATTERNS = [
  "Do **not** build dashboards/widgets for heartbeat runs, run IDs, run logs, agent IDs, adapter config, issue UUIDs, or token/cost telemetry unless the user explicitly requested an engineering ops view.",
  "Do **not** surface raw log lines, stack traces, or “last run status” as KPIs.",
  "Do **not** duplicate information that belongs in the Issues board (task lists) as a dashboard — dashboards summarize **business data**, not agent work queues.",
];

export function formatProjectDashboardAgentGuidance(): string {
  return [
    ...PROJECT_DASHBOARD_BUSINESS_RULES.map((rule) => `- ${rule}`),
    "",
    "**Presentation (layout + config):**",
    ...PROJECT_VIEW_WIDGET_PRESENTATION_GUIDE.map((rule) => `- ${rule}`),
    "",
    "**Avoid:**",
    ...PROJECT_DASHBOARD_ANTI_PATTERNS.map((rule) => `- ${rule}`),
  ].join("\n");
}

export function extractTableColumns(definition: Record<string, unknown>): Array<{ name: string; type: string }> {
  const columns = definition.columns;
  if (!Array.isArray(columns)) return [];
  return columns
    .map((column) => {
      if (!column || typeof column !== "object") return null;
      const name = (column as { name?: unknown }).name;
      const type = (column as { type?: unknown }).type;
      if (typeof name !== "string" || typeof type !== "string") return null;
      return { name, type };
    })
    .filter((column): column is { name: string; type: string } => column !== null);
}

export function buildProjectDataApiGuide(
  projectId: string,
  dataSchemaName: string | null,
  dataObjects: ProjectDataObjectGuideInput[],
) {
  const tableRows = dataObjects
    .filter((row) => row.kind === "table")
    .map((row) => {
      const primaryKey = row.definition.primaryKey;
      return {
        name: row.name,
        primaryKey: Array.isArray(primaryKey)
          ? primaryKey.filter((value): value is string => typeof value === "string")
          : [],
        columns: extractTableColumns(row.definition),
      };
    });
  const exampleTable = tableRows[0]?.name ?? "{tableName}";
  return {
    note:
      "dataSchemaName is the internal PostgreSQL schema — never put it in API URLs. Use the project UUID and registered table names from this guide.",
    dataSchemaName,
    projectId,
    uiTab: "Project → Context → Data workspace (tables and SQL views)",
    permissionForRowWrites: "project:edit tickets",
    permissionForSchemaWrites: "project:edit configuration",
    rules: [
      "Structured operational records belong in project data tables — not only in issue comments.",
      "Design table and column names from the project summary, workflow, and stage playbook — do not copy placeholder names from API docs.",
      "After inserts or updates, verify with POST .../data/query before marking stage work complete.",
      "If no table exists for the entity you need, request dashboard/data maintenance or create via POST .../data/tables (configuration permission).",
    ],
    routes: {
      listObjects: `GET /api/projects/${projectId}/data/objects`,
      query: `POST /api/projects/${projectId}/data/query`,
      insertRows: `POST /api/projects/${projectId}/data/{tableName}/rows`,
      updateRow: `PATCH /api/projects/${projectId}/data/{tableName}/rows`,
      deleteRow: `DELETE /api/projects/${projectId}/data/{tableName}/rows`,
      createTable: `POST /api/projects/${projectId}/data/tables`,
      createView: `POST /api/projects/${projectId}/data/views`,
    },
    insertRowsBody: { rows: [{ column_name: "value" }] },
    updateRowBody: { primaryKey: { id: "row-id" }, patch: { column_name: "new value" } },
    queryBody: { ref: { kind: "table", name: exampleTable }, limit: 50, offset: 0 },
    tables: tableRows,
    views: dataObjects.filter((row) => row.kind === "view").map((row) => ({ name: row.name })),
  };
}

export function buildProjectDashboardApiGuide(
  projectId: string,
  views: Array<ProjectViewGuideInput & { widgets?: ProjectViewWidgetGuideInput[] }>,
  options: { exampleTableName?: string | null } = {},
) {
  const exampleViewId = views[0]?.id ?? "{viewId}";
  const exampleTable = options.exampleTableName?.trim() || "{tableName}";
  return {
    projectId,
    uiTab: "Project → Context → Dashboards (KPI / table / chart widgets backed by data/query)",
    permissionForEdits: "project:edit configuration",
    rules: [
      ...PROJECT_DASHBOARD_BUSINESS_RULES,
      "Widgets must use queryRef pointing at registered **project data** tables or SQL views.",
      "When operational rows change, existing widgets refresh on next fetch; add widgets when operators need new visibility.",
      ...PROJECT_VIEW_WIDGET_PRESENTATION_GUIDE,
      ...PROJECT_DASHBOARD_ANTI_PATTERNS,
    ],
    widgetPresentation: [...PROJECT_VIEW_WIDGET_PRESENTATION_GUIDE],
    routes: {
      listViews: `GET /api/projects/${projectId}/views`,
      createView: `POST /api/projects/${projectId}/views`,
      listWidgets: `GET /api/projects/${projectId}/views/{viewId}/widgets`,
      widgetData: `GET /api/projects/${projectId}/views/{viewId}/widgets/data`,
      createWidget: `POST /api/projects/${projectId}/views/{viewId}/widgets`,
      updateWidget: `PATCH /api/projects/${projectId}/views/{viewId}/widgets/{widgetId}`,
    },
    createViewBody: { name: "{name}", description: "{optional description}" },
    createWidgetBody: {
      title: "{widget title}",
      type: "kpi",
      queryRef: { ref: { kind: "table", name: exampleTable }, limit: 1, offset: 0 },
    },
    createTableWidgetBody: {
      title: "{widget title}",
      type: "table",
      position: 20,
      queryRef: { ref: { kind: "table", name: exampleTable }, limit: 100, offset: 0 },
      config: { pageSize: 15, compact: true, columns: ["{column_a}", "{column_b}"] },
      layout: { colSpan: 2, maxHeight: 400 },
    },
    createMarkdownWidgetBody: {
      title: "{section title}",
      type: "markdown",
      position: 0,
      config: { markdown: "## Weekly summary\nShort operator-facing notes." },
      layout: { colSpan: 2, maxHeight: 320 },
    },
    createChartWidgetBody: {
      title: "{widget title}",
      type: "chart",
      position: 10,
      queryRef: { ref: { kind: "view", name: "{viewName}" }, limit: 24, offset: 0 },
      layout: { colSpan: 2, chartHeight: 220 },
    },
    readWidgetData: `GET /api/projects/${projectId}/views/${exampleViewId}/widgets/data`,
    dashboards: views.map((view) => ({
      id: view.id,
      name: view.name,
      description: view.description ?? null,
      widgets: (view.widgets ?? []).map((widget) => ({
        id: widget.id,
        title: widget.title,
        type: widget.type,
        position: widget.position,
        queryRef: widget.queryRef,
        config: widget.config ?? null,
        layout: widget.layout ?? null,
      })),
    })),
  };
}
