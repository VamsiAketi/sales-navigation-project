import type { Db } from "@paperclipai/db";
import { projectIssueStatusService } from "./project-issue-statuses.js";
import { projectDataService } from "./project-data.js";
import {
  buildProjectDashboardApiGuide,
  buildProjectDataApiGuide,
  formatProjectDashboardAgentGuidance,
  type ProjectDataObjectGuideInput,
} from "./project-data-api-guide.js";

export type IssueProjectDataInvocationPromptInput = {
  projectId: string;
  projectDataApi: ReturnType<typeof buildProjectDataApiGuide>;
  projectDashboardApi: ReturnType<typeof buildProjectDashboardApiGuide>;
  currentStagePlaybook: string | null;
};

export function buildIssueProjectDataInvocationPrompt(input: IssueProjectDataInvocationPromptInput): string {
  const { projectDataApi, projectDashboardApi } = input;
  const lines: string[] = [
    "Project **Data** and **Dashboards** are how humans track operational truth as tasks grow. Issue comments are narrative only — durable records belong in project data tables.",
    "",
    "### Data tables (write path)",
    ...projectDataApi.rules.map((rule) => `- ${rule}`),
    `- List schema: \`${projectDataApi.routes.listObjects}\``,
    `- Insert rows: \`${projectDataApi.routes.insertRows}\` with body \`${JSON.stringify(projectDataApi.insertRowsBody)}\``,
    `- Query rows: \`${projectDataApi.routes.query}\``,
  ];

  if (projectDataApi.tables.length > 0) {
    lines.push("", "Registered tables:");
    for (const table of projectDataApi.tables) {
      const columns =
        table.columns.length > 0
          ? table.columns.map((column) => `${column.name}:${column.type}`).join(", ")
          : "(columns: fetch GET .../data/objects for full definition)";
      lines.push(`- **${table.name}** — PK [${table.primaryKey.join(", ") || "none"}]; columns: ${columns}`);
    }
  } else {
    lines.push(
      "",
      "No data tables registered yet. Step 5 (mandatory review): if this task produces operational records, create tables via POST .../data/tables and insert rows before handoff — attachments alone are not enough.",
    );
  }

  lines.push(
    "",
    "### Dashboards (read + maintain)",
    formatProjectDashboardAgentGuidance(),
    `- List: \`${projectDashboardApi.routes.listViews}\` · Widget data: \`${projectDashboardApi.routes.widgetData}\``,
    `- Add widget: \`${projectDashboardApi.routes.createWidget}\` (types: kpi, table, chart, markdown)`,
  );

  if (projectDashboardApi.dashboards.length > 0) {
    lines.push("", "Existing dashboards:");
    for (const dashboard of projectDashboardApi.dashboards) {
      const widgetSummary =
        dashboard.widgets.length > 0
          ? dashboard.widgets.map((widget) => `${widget.title ?? widget.type} (${widget.type})`).join("; ")
          : "no widgets yet";
      lines.push(`- **${dashboard.name}** (\`${dashboard.id}\`) — ${widgetSummary}`);
    }
  } else {
    lines.push("", "No dashboards yet. Step 5: if operators need visibility for what this task changed, create views/widgets (maintenance type `dashboards` or view/widget APIs).");
  }

  if (input.currentStagePlaybook?.trim()) {
    lines.push("", "### Stage note (may require data writes)", input.currentStagePlaybook.trim());
  }

  return lines.join("\n").trim();
}

const MAX_STAGE_PLAYBOOK_CHARS = 2_000;

function truncatePromptText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}\n\n...[truncated]`;
}

export async function loadIssueProjectDataPromptForRun(
  db: Db,
  input: { projectId: string; issueStatus?: string | null; currentStagePlaybook?: string | null },
): Promise<string | null> {
  const dataSvc = projectDataService(db);
  let currentStagePlaybook = input.currentStagePlaybook ?? null;
  if (!currentStagePlaybook && input.issueStatus) {
    const statuses = await projectIssueStatusService(db).list(input.projectId);
    const stage = statuses.find((row) => row.value === input.issueStatus);
    currentStagePlaybook = truncatePromptText(stage?.agentInstructions ?? null, MAX_STAGE_PLAYBOOK_CHARS);
  }

  const [dataObjects, views] = await Promise.all([
    dataSvc.listDataObjects(input.projectId).catch(() => []),
    dataSvc.listViews(input.projectId).catch(() => []),
  ]);

  const widgetsByView = await Promise.all(
    views.slice(0, 8).map(async (view) => ({
      view,
      widgets: await dataSvc.listWidgets(input.projectId, view.id).catch(() => []),
    })),
  );

  const projectDataApi = buildProjectDataApiGuide(
    input.projectId,
    null,
    dataObjects.map(
      (row): ProjectDataObjectGuideInput => ({
        kind: row.kind,
        name: row.name,
        definition: (row.definition as Record<string, unknown>) ?? {},
      }),
    ),
  );

  const projectDashboardApi = buildProjectDashboardApiGuide(
    input.projectId,
    widgetsByView.map(({ view, widgets }) => ({
      id: view.id,
      name: view.name,
      description: view.description,
      widgets: widgets.map((widget) => ({
        id: widget.id,
        title: widget.title,
        type: widget.type,
        position: widget.position,
        queryRef: widget.queryRef,
        config: widget.config,
        layout: widget.layout,
      })),
    })),
    { exampleTableName: projectDataApi.tables[0]?.name ?? null },
  );

  const prompt = buildIssueProjectDataInvocationPrompt({
    projectId: input.projectId,
    projectDataApi,
    projectDashboardApi,
    currentStagePlaybook,
  });

  return prompt.length > 0 ? prompt : null;
}
