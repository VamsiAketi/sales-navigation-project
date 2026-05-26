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
  queryRef: Record<string, unknown> | null;
};

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
      "Dashboards visualize project data — widgets must use queryRef pointing at registered tables or SQL views.",
      "Design dashboard and widget names from what operators need to see — infer from project context; do not copy placeholder names from API docs.",
      "When you add rows to operational tables, existing KPI/table/chart widgets update on the next fetch; create widgets when new visibility is needed.",
      "Prefer table/chart/kpi widgets over long comment threads for metrics the team tracks over time.",
    ],
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
      queryRef: { ref: { kind: "table", name: exampleTable }, limit: 25, offset: 0 },
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
        queryRef: widget.queryRef,
      })),
    })),
  };
}
