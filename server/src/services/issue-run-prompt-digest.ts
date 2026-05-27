import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { heartbeatRuns, issues, projectContextSnapshots } from "@paperclipai/db";
import { documentService } from "./documents.js";
import {
  buildHeartbeatProjectWorkflowContext,
  formatProjectWorkflowStatusMeaning,
  type HeartbeatProjectWorkflowContext,
} from "./heartbeat-project-workflow.js";
import {
  buildProjectDashboardApiGuide,
  buildProjectDataApiGuide,
  type ProjectDataObjectGuideInput,
} from "./project-data-api-guide.js";
import {
  ISSUE_PROJECT_DATA_VISIBILITY_COMPACT_REMINDER,
  ISSUE_PROJECT_DATA_VISIBILITY_MANDATORY_REVIEW,
} from "@paperclipai/shared";
import { projectDataService } from "./project-data.js";
import { projectIssueStatusService } from "./project-issue-statuses.js";
import { issueService } from "./issues.js";
import { extractWorkflowStageSection } from "./issue-heartbeat-workflow-prompt.js";
import { stableHash } from "../utils/stable-hash.js";

const MAX_DESCRIPTION_CHARS = 700;
const MAX_WAKE_COMMENT_CHARS = 500;
const MAX_STAGE_PLAYBOOK_CHARS = 1_200;
const MAX_STAGE_SECTION_CHARS = 1_500;
const MAX_TABLES_LISTED = 12;
const MAX_COLUMNS_PER_TABLE = 14;
const MAX_DASHBOARDS_LISTED = 6;

function truncate(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}\n\n...[truncated]`;
}

export function computeIssueRunPromptFingerprint(input: {
  projectId: string;
  issueStatus: string;
  workflowDocUpdatedAt: string | null;
  tableNames: string[];
  dashboardCount: number;
}): string {
  return stableHash({
    projectId: input.projectId,
    issueStatus: input.issueStatus,
    workflowDocUpdatedAt: input.workflowDocUpdatedAt,
    tableNames: [...input.tableNames].sort(),
    dashboardCount: input.dashboardCount,
  });
}

async function loadPreviousIssueRunPromptFingerprint(
  db: Db,
  agentId: string,
  issueId: string,
): Promise<string | null> {
  const rows = await db
    .select({ contextSnapshot: heartbeatRuns.contextSnapshot })
    .from(heartbeatRuns)
    .where(
      and(
        eq(heartbeatRuns.agentId, agentId),
        inArray(heartbeatRuns.status, ["succeeded", "failed", "cancelled", "timed_out"]),
      ),
    )
    .orderBy(desc(heartbeatRuns.startedAt))
    .limit(25);

  for (const row of rows) {
    const snap = row.contextSnapshot;
    if (!snap || typeof snap !== "object" || Array.isArray(snap)) continue;
    const ctx = snap as Record<string, unknown>;
    if (ctx.issueId !== issueId) continue;
    const fp = typeof ctx.issueRunPromptFingerprint === "string" ? ctx.issueRunPromptFingerprint.trim() : "";
    if (fp) return fp;
  }
  return null;
}

function buildCompactWorkflowSection(input: {
  issueIdentifier: string | null;
  issueTitle: string | null;
  projectWorkflow: HeartbeatProjectWorkflowContext;
  workflowSummary: string | null;
  currentStagePlaybook: string | null;
}): string {
  const stage = input.projectWorkflow.currentStage;
  if (!stage) return "";

  const statusMeaning =
    input.projectWorkflow.statusMeaning ??
    formatProjectWorkflowStatusMeaning(stage.name, stage.value);

  const allowedNext =
    input.projectWorkflow.allowedNextStages.length > 0
      ? input.projectWorkflow.allowedNextStages.map((s) => `${s.name} (\`${s.value}\`)`).join(", ")
      : stage.allowedNextStatusValues.map((v) => `\`${v}\``).join(", ");

  const stageSection = input.workflowSummary
    ? extractWorkflowStageSection(input.workflowSummary, stage.name)
    : null;

  const lines: string[] = [
    `**Stage:** ${stage.name} — ${statusMeaning}`,
    `**Next (API keys):** ${allowedNext || "(none)"}`,
    "- Do not PATCH generic `todo` / `in_progress` unless that value matches this stage.",
    "- Meet exit criteria before advancing; use `blocked` with a comment if stuck.",
  ];

  if (input.currentStagePlaybook) {
    lines.push("", "**Exit criteria:**", input.currentStagePlaybook);
  }

  if (stageSection) {
    lines.push("", `**Playbook — ${stage.name}:**`, truncate(stageSection, MAX_STAGE_SECTION_CHARS) ?? "");
  } else if (input.workflowSummary) {
    lines.push(
      "",
      `**Playbook:** No \`## ${stage.name}\` section in documents/workflow — use \`GET /api/issues/{issueId}/heartbeat-context\` for the full playbook if needed.`,
    );
  }

  return lines.join("\n").trim();
}

export function buildCompactDataSection(
  projectId: string,
  projectDataApi: ReturnType<typeof buildProjectDataApiGuide>,
  projectDashboardApi: ReturnType<typeof buildProjectDashboardApiGuide>,
): string {
  const lines: string[] = [
    ISSUE_PROJECT_DATA_VISIBILITY_MANDATORY_REVIEW,
    "",
    "**Project manifest** (use project UUID in URLs, not `dataSchemaName`):",
  ];

  if (projectDataApi.tables.length > 0) {
    lines.push(`- Schema: \`${projectDataApi.routes.listObjects}\``);
    lines.push(`- Rows: \`${projectDataApi.routes.insertRows}\` · Query: \`${projectDataApi.routes.query}\``);
    lines.push("- Tables:");
    for (const table of projectDataApi.tables.slice(0, MAX_TABLES_LISTED)) {
      const columns = table.columns
        .slice(0, MAX_COLUMNS_PER_TABLE)
        .map((column) => `${column.name}:${column.type}`)
        .join(", ");
      const colSuffix =
        table.columns.length > MAX_COLUMNS_PER_TABLE ? ", …" : columns ? "" : " (see GET .../data/objects)";
      lines.push(
        `  - **${table.name}** PK [${table.primaryKey.join(", ") || "none"}]${columns ? ` — ${columns}${colSuffix}` : colSuffix}`,
      );
    }
    if (projectDataApi.tables.length > MAX_TABLES_LISTED) {
      lines.push(`  - …and ${projectDataApi.tables.length - MAX_TABLES_LISTED} more tables (GET .../data/objects)`);
    }
  } else {
    lines.push("- No tables yet — create via `POST .../data/tables` when step 5 requires structured records.");
  }

  if (projectDashboardApi.dashboards.length > 0) {
    lines.push("- Dashboards (business-facing — KPIs/charts on operational data, not run logs):");
    for (const dashboard of projectDashboardApi.dashboards.slice(0, MAX_DASHBOARDS_LISTED)) {
      const widgetSummary =
        dashboard.widgets.length > 0
          ? dashboard.widgets.map((w) => `${w.title ?? w.type}`).join(", ")
          : "no widgets";
      lines.push(`  - **${dashboard.name}** — ${widgetSummary}`);
    }
    lines.push(`- Widget data: \`${projectDashboardApi.routes.widgetData}\``);
  } else {
    lines.push("- No dashboards yet — create views/widgets via `POST .../views` when step 5 requires operator visibility.");
  }

  lines.push(
    "",
    "**Dashboards:** for operators — pipeline KPIs, funnel charts, readable tables. Never widget run IDs, heartbeat logs, or agent telemetry.",
  );

  return lines.join("\n").trim();
}

export type IssueRunPromptDigestResult = {
  markdown: string;
  fingerprint: string;
  compact: boolean;
};

export async function loadIssueRunPromptDigest(
  db: Db,
  input: {
    companyId: string;
    agentId: string;
    issueId: string;
    projectId: string;
    issueStatus: string;
    issueIdentifier?: string | null;
    issueTitle?: string | null;
    issueDescription?: string | null;
    parentId?: string | null;
    wakeCommentId?: string | null;
    previousFingerprint?: string | null;
  },
): Promise<IssueRunPromptDigestResult | null> {
  const issuesSvc = issueService(db);
  const dataSvc = projectDataService(db);

  const [statuses, docs, dataObjects, views, wakeComment, parentRow] = await Promise.all([
    projectIssueStatusService(db).list(input.projectId),
    documentService(db).listProjectDocuments(input.projectId),
    dataSvc.listDataObjects(input.projectId).catch(() => []),
    dataSvc.listViews(input.projectId).catch(() => []),
    input.wakeCommentId ? issuesSvc.getComment(input.wakeCommentId).catch(() => null) : Promise.resolve(null),
    input.parentId
      ? db
          .select({ identifier: issues.identifier, title: issues.title })
          .from(issues)
          .where(and(eq(issues.id, input.parentId), eq(issues.companyId, input.companyId)))
          .then((rows) => rows[0] ?? null)
      : Promise.resolve(null),
  ]);

  const projectWorkflow = buildHeartbeatProjectWorkflowContext(statuses, input.issueStatus);
  if (!projectWorkflow?.currentStage) return null;

  const workflowDoc = docs.find((doc) => doc.key === "workflow") ?? null;
  let workflowSummary = workflowDoc?.body ?? null;
  let workflowDocUpdatedAt: string | null = workflowDoc?.updatedAt?.toISOString() ?? null;
  if (!workflowSummary) {
    const snapshot = await db
      .select({ body: projectContextSnapshots.body, createdAt: projectContextSnapshots.createdAt })
      .from(projectContextSnapshots)
      .where(
        and(
          eq(projectContextSnapshots.projectId, input.projectId),
          eq(projectContextSnapshots.kind, "workflow_summary"),
        ),
      )
      .orderBy(desc(projectContextSnapshots.createdAt))
      .limit(1)
      .then((rows) => rows[0] ?? null);
    workflowSummary = snapshot?.body ?? null;
    workflowDocUpdatedAt = snapshot?.createdAt?.toISOString() ?? null;
  }

  const stage = projectWorkflow.currentStage;
  const currentStagePlaybook = truncate(stage.agentInstructions, MAX_STAGE_PLAYBOOK_CHARS);

  const mappedDataObjects = dataObjects.map(
    (row): ProjectDataObjectGuideInput => ({
      kind: row.kind,
      name: row.name,
      definition: (row.definition as Record<string, unknown>) ?? {},
    }),
  );
  const tableNames = mappedDataObjects.filter((row) => row.kind === "table").map((row) => row.name);

  const widgetsByView = await Promise.all(
    views.slice(0, MAX_DASHBOARDS_LISTED).map(async (view) => ({
      view,
      widgets: await dataSvc.listWidgets(input.projectId, view.id).catch(() => []),
    })),
  );

  const fingerprint = computeIssueRunPromptFingerprint({
    projectId: input.projectId,
    issueStatus: input.issueStatus,
    workflowDocUpdatedAt,
    tableNames,
    dashboardCount: views.length,
  });

  const previousFingerprint =
    input.previousFingerprint?.trim() ||
    (await loadPreviousIssueRunPromptFingerprint(db, input.agentId, input.issueId));

  if (previousFingerprint && previousFingerprint === fingerprint) {
    const tableCount = tableNames.length;
    const dashboardCount = views.length;
    return {
      markdown: [
        `**Task:** ${[input.issueIdentifier, input.issueTitle].filter(Boolean).join(" — ") || input.issueId}`,
        `**Stage:** ${stage.name} (\`${stage.value}\`) — unchanged since your last run on this issue.`,
        "Workflow, tables, and dashboards are the same — continue from your prior comment or call heartbeat-context only if you need new thread activity.",
        "",
        ISSUE_PROJECT_DATA_VISIBILITY_COMPACT_REMINDER,
        `- Manifest: ${tableCount} table${tableCount === 1 ? "" : "s"}, ${dashboardCount} dashboard${dashboardCount === 1 ? "" : "s"}.`,
      ].join("\n"),
      fingerprint,
      compact: true,
    };
  }

  const headerParts = [
    `**Task:** ${[input.issueIdentifier, input.issueTitle].filter(Boolean).join(" — ") || input.issueId}`,
  ];
  const description = truncate(input.issueDescription, MAX_DESCRIPTION_CHARS);
  if (description) {
    headerParts.push("", "**Description:**", description);
  }
  if (parentRow) {
    headerParts.push(
      "",
      `**Parent:** ${[parentRow.identifier, parentRow.title].filter(Boolean).join(" — ")}`,
    );
  }
  const wakeBody =
    wakeComment && wakeComment.issueId === input.issueId
      ? truncate(wakeComment.body, MAX_WAKE_COMMENT_CHARS)
      : null;
  if (wakeBody) {
    headerParts.push("", "**Wake comment:**", wakeBody);
  }

  const workflowBlock = buildCompactWorkflowSection({
    issueIdentifier: input.issueIdentifier ?? null,
    issueTitle: input.issueTitle ?? null,
    projectWorkflow,
    workflowSummary,
    currentStagePlaybook,
  });

  const sections = [...headerParts, "", workflowBlock];

  const projectDataApi = buildProjectDataApiGuide(input.projectId, null, mappedDataObjects);
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
        queryRef: widget.queryRef,
      })),
    })),
    { exampleTableName: projectDataApi.tables[0]?.name ?? null },
  );
  sections.push("", buildCompactDataSection(input.projectId, projectDataApi, projectDashboardApi));

  return {
    markdown: sections.join("\n").trim(),
    fingerprint,
    compact: false,
  };
}
