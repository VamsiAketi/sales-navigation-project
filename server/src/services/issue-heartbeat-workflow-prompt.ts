import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { projectContextSnapshots } from "@paperclipai/db";
import { documentService } from "./documents.js";
import {
  buildHeartbeatProjectWorkflowContext,
  formatProjectWorkflowStatusMeaning,
} from "./heartbeat-project-workflow.js";
import { projectIssueStatusService } from "./project-issue-statuses.js";

const MAX_WORKFLOW_DOC_CHARS = 6_000;
const MAX_STAGE_PLAYBOOK_CHARS = 2_000;

function truncatePromptText(value: string | null | undefined, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max)}\n\n...[truncated]`;
}

/** Pull the `## Stage name` section from the project workflow markdown doc. */
export function extractWorkflowStageSection(workflowBody: string, stageName: string): string | null {
  const trimmed = workflowBody.trim();
  if (!trimmed || !stageName.trim()) return null;
  const lines = trimmed.split("\n");
  const escaped = stageName.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headingRe = new RegExp(`^##\\s+${escaped}\\s*$`, "i");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headingRe.test(lines[i]!.trim())) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return null;
  const sectionLines: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^##\s+/.test(line.trim())) break;
    sectionLines.push(line);
  }
  const section = sectionLines.join("\n").trim();
  return section.length > 0 ? section : null;
}

export type IssueWorkflowInvocationPromptInput = {
  issueIdentifier: string | null;
  issueTitle: string | null;
  issueStatus: string;
  projectWorkflow: ReturnType<typeof buildHeartbeatProjectWorkflowContext>;
  workflowSummary: string | null;
  currentStagePlaybook: string | null;
};

export function buildIssueWorkflowInvocationPrompt(input: IssueWorkflowInvocationPromptInput): string {
  const workflow = input.projectWorkflow;
  const stage = workflow?.currentStage;
  if (!workflow || !stage) return "";

  const statusMeaning =
    workflow.statusMeaning ??
    formatProjectWorkflowStatusMeaning(stage.name, stage.value);

  const allowedNext =
    workflow.allowedNextStages.length > 0
      ? workflow.allowedNextStages.map((s) => `${s.name} (\`${s.value}\`)`).join(", ")
      : stage.allowedNextStatusValues.map((v) => `\`${v}\``).join(", ");

  const stageSection = input.workflowSummary
    ? extractWorkflowStageSection(input.workflowSummary, stage.name)
    : null;

  const lines: string[] = [
    "You MUST follow these workflow rules for this task. `issue.status` / stage `value` keys are API write keys only — business meaning comes from the stage **name** and rules below.",
    "",
    input.issueIdentifier || input.issueTitle
      ? `Task: ${[input.issueIdentifier, input.issueTitle].filter(Boolean).join(" — ")}`
      : null,
    `Current stage: **${stage.name}** — ${statusMeaning}`,
    `Legal next stages (PATCH/checkout may only use the \`value\` key): ${allowedNext || "(none configured)"}`,
    "",
    "Rules:",
    "- Do not advance to the next stage until this stage's exit/done criteria are satisfied.",
    "- Do not PATCH generic keys like `in_progress` or `todo` unless that **value** matches the intended business stage name above.",
    "- If criteria are not met, stay on the current stage or move to `blocked` with a clear comment.",
  ].filter((line): line is string => line !== null);

  if (input.currentStagePlaybook) {
    lines.push("", "### Stage exit criteria (from workflow config)", input.currentStagePlaybook);
  }

  if (stageSection) {
    lines.push("", `### Playbook — ${stage.name} (from documents/workflow)`, stageSection);
  } else if (input.workflowSummary) {
    lines.push(
      "",
      "### Project workflow playbook (excerpt)",
      "No dedicated section matched this stage name; use the excerpt below and obey the current stage name.",
      truncatePromptText(input.workflowSummary, MAX_WORKFLOW_DOC_CHARS) ?? "",
    );
  }

  return lines.join("\n").trim();
}

export async function loadIssueWorkflowPromptForRun(
  db: Db,
  input: { companyId: string; projectId: string; issueStatus: string; issueIdentifier?: string | null; issueTitle?: string | null },
): Promise<string | null> {
  const statuses = await projectIssueStatusService(db).list(input.projectId);
  const projectWorkflow = buildHeartbeatProjectWorkflowContext(statuses, input.issueStatus);
  if (!projectWorkflow?.currentStage) return null;

  const docs = await documentService(db).listProjectDocuments(input.projectId);
  const workflowDoc = docs.find((doc) => doc.key === "workflow") ?? null;
  let workflowSummary = workflowDoc?.body ?? null;
  if (!workflowSummary) {
    const snapshot = await db
      .select({ body: projectContextSnapshots.body })
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
  }

  const currentStagePlaybook = truncatePromptText(
    projectWorkflow.currentStage.agentInstructions,
    MAX_STAGE_PLAYBOOK_CHARS,
  );

  const prompt = buildIssueWorkflowInvocationPrompt({
    issueIdentifier: input.issueIdentifier ?? null,
    issueTitle: input.issueTitle ?? null,
    issueStatus: input.issueStatus,
    projectWorkflow,
    workflowSummary: truncatePromptText(workflowSummary, MAX_WORKFLOW_DOC_CHARS),
    currentStagePlaybook,
  });

  return prompt.length > 0 ? prompt : null;
}
