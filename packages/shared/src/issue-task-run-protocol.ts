/** Mandatory lifecycle for every normal (non–one-shot) project-scoped issue heartbeat. */
export const ISSUE_TASK_RUN_PROTOCOL = [
  "## Task run protocol (mandatory)",
  "1. **Understand** — task context below; call `GET /api/issues/{issueId}/heartbeat-context` only if you still need full thread, goal tree, or workspace.",
  "2. **Role fit** — if this task is outside your AGENTS.md mandate: comment why, do not checkout or change status, exit.",
  "3. **Execute** — do the assigned work; follow the stage playbook below.",
  "4. **Close out** — comment what you did; upload task files as issue attachments on that comment (not disk paths only).",
  "5. **Data & dashboards (mandatory review)** — inspect project data tables and dashboards (manifest below). Decide whether **this task** changed operational truth operators should see in Project → Context. If yes: create/update tables and rows, create/update business-facing dashboard widgets. If no (purely narrative work): state `Data/dashboard: no change — {reason}` in your completion comment. Issue attachments alone do not replace project data when operators need ongoing visibility.",
  "6. **Handoff** — advance only to allowed next stage `value` keys after exit criteria are met.",
].join("\n");

/** Injected on every project-scoped run digest (not workflow-gated). */
export const ISSUE_PROJECT_DATA_VISIBILITY_MANDATORY_REVIEW = [
  "**Mandatory (protocol step 5):** After primary work, review tables and dashboards below.",
  "- **Changed operational records?** Persist to project data (create table/rows if needed) and refresh operator dashboards (KPI/chart/table widgets on business data — never run logs or agent telemetry).",
  "- **Narrative-only task?** Comment `Data/dashboard: no change — {reason}` before handoff.",
  "- Attachments on the issue complement project data; they do not replace tables/widgets operators rely on.",
].join("\n");

/** Short reminder for compact repeat-run digests. */
export const ISSUE_PROJECT_DATA_VISIBILITY_COMPACT_REMINDER =
  "**Protocol step 5 (mandatory):** Review project data & dashboards — update if this task changed operational records; otherwise comment `Data/dashboard: no change — {reason}`.";
