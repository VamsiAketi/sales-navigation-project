---
name: paperclip-project-context
description: >
  Operate Paperclip project-context workflows during one-shot wakes and issue
  runs. Use when a wake reason is project_context_sync or
  project_maintenance_request, or when projectContext in heartbeat-context is
  insufficient and targeted project context/document/data APIs are needed.
---

# Paperclip Project Context Skill

## When to use

- `PAPERCLIP_WAKE_REASON=project_context_sync`
- `PAPERCLIP_WAKE_REASON=project_maintenance_request`
- Project-scoped issue runs where lean `projectContext` requires deeper fetches

## One-shot rules

- One-shot wakes are non-issue operational runs; do not run inbox/checkout flow.
- Prefer additive updates by default for automated sync.
- For maintenance requests, respect request type and update request status with a clear summary/failure reason.

## Data access pattern

1. Read project context bundle.
2. Fetch only required document/file/data details.
3. Apply focused API mutations.
4. Persist outcome back to maintenance request/status APIs.

## Project data API (tables / rows)

`dataSchemaName` on the project (e.g. `prj_357ebae6e583`) is the **PostgreSQL schema** created for the project. Agents must **not** build URLs from it — those return `API route not found`.

Use the **project UUID** and registered **table names**:

| Action | Route | Permission |
| ------ | ----- | ---------- |
| List tables/views + definitions | `GET /api/projects/{projectId}/data/objects` | `project:read` |
| Query table or view | `POST /api/projects/{projectId}/data/query` | `project:read` |
| Insert row(s) | `POST /api/projects/{projectId}/data/{tableName}/rows` | `project:edit tickets` |
| Update row by PK | `PATCH /api/projects/{projectId}/data/{tableName}/rows` | `project:edit tickets` |
| Delete row by PK | `DELETE /api/projects/{projectId}/data/{tableName}/rows` | `project:edit tickets` |
| Create table / view (DDL) | `POST /api/projects/{projectId}/data/tables` or `.../data/views` | `project:edit configuration` |

**Insert example** (replace `{tableName}` with a table you designed for this project):

```json
POST /api/projects/{projectId}/data/{tableName}/rows
{ "rows": [{ "column_a": "value", "column_b": "value" }] }
```

**Query example:**

```json
POST /api/projects/{projectId}/data/query
{ "ref": { "kind": "table", "name": "{tableName}" }, "limit": 50, "offset": 0 }
```

On issue heartbeats, prefer `projectContext.projectDataApi` from `GET /api/issues/{issueId}/heartbeat-context` — it lists registered tables and the exact route templates for that project.

**Mandatory on every issue run:** the adapter prompt includes `## Project data & dashboards (mandatory)` built from the same tables/dashboards — you do not need a separate heartbeat-context fetch for route templates if you follow that section. Still use heartbeat-context or `GET .../context` when you need the full playbook or maintenance state.

## Dashboard API (views / widgets)

Dashboards live under **Project → Context → Dashboards** in the UI. They are **operator-facing**: pipeline health, funnel KPIs, trends, and readable tables over **project data** — not agent runtime telemetry.

**Build for business users**

- **Do:** KPIs and charts on operational tables (counts by stage, leads this week, conversion, regional mix, aging backlog).
- **Do:** table widgets with business columns (account, status, owner, date) — titles in plain language.
- **Do:** use `kpi`, `chart`, `table`, or short `markdown` summaries when appropriate.

**Do not**

- Heartbeat runs, run IDs, run logs, agent IDs, issue UUIDs, API routes, or token/cost widgets unless the user explicitly asked for an engineering/debug view.
- Raw log excerpts or “last agent run” style metrics.
- Duplicating the Issues board as a dashboard — tasks stay on the board; dashboards summarize **business records** in project data tables.

Widgets visualize data via `queryRef` (a `POST .../data/query` payload on registered tables/views).

| Action | Route | Permission |
| ------ | ----- | ---------- |
| List dashboards | `GET /api/projects/{projectId}/views` | `project:read` |
| Create dashboard | `POST /api/projects/{projectId}/views` | `project:edit configuration` |
| List widgets | `GET /api/projects/{projectId}/views/{viewId}/widgets` | `project:read` |
| Read widget data | `GET /api/projects/{projectId}/views/{viewId}/widgets/data` | `project:read` |
| Add widget | `POST /api/projects/{projectId}/views/{viewId}/widgets` | `project:edit configuration` |
| Update widget | `PATCH /api/projects/{projectId}/views/{viewId}/widgets/{widgetId}` | `project:edit configuration` |

Widget `type`: `kpi`, `table`, `chart`, or `markdown`. Set `queryRef` to `{ ref: { kind: "table", name: "{tableName}" }, limit: 25, offset: 0 }` using a registered table name.

**Presentation (agents control readability via `layout` + `config`):**

| Field | Purpose |
| ----- | ------- |
| `layout.colSpan` | `1` (default), `2`, or `3` (full width) on the dashboard grid |
| `layout.maxHeight` | Scrollable body for **table** or **markdown** (e.g. `320`–`480` px) |
| `layout.chartHeight` | Bar chart height in px (e.g. `200`–`280`) |
| `layout.minHeight` | Minimum tile height in px |
| `config.pageSize` | Table rows per page (`5`–`50`, default `15`); set `queryRef.limit` up to `100` so pagination has data |
| `config.columns` | Optional column order/filter for tables |
| `config.compact` | Denser table typography |
| `config.markdown` | Markdown body for `type: markdown` |
| `position` | Sort order (`0`, `10`, `20`…) — KPIs first, then charts, then tables |

Example table widget:

```json
{
  "title": "Recent leads",
  "type": "table",
  "position": 20,
  "queryRef": { "ref": { "kind": "table", "name": "leads" }, "limit": 100, "offset": 0 },
  "config": { "pageSize": 15, "compact": true },
  "layout": { "colSpan": 2, "maxHeight": 400 }
}
```

`GET /api/projects/{projectId}/context` returns `projectDataApi` and `projectDashboardApi` summaries (tables with columns, existing dashboards/widgets). **Do not** use `/data-objects` — the correct path is `/data/objects`.

## Maintenance request types

| Type | What “done” means |
| ---- | ----------------- |
| `context_summary` | Business project summary + workflow playbook refreshed from files/project state |
| `workflow` | **Project issue-status pipeline** updated to match the request, plus workflow doc |
| `dashboards` | Business-facing views/widgets (KPIs, charts, tables on **project data** — not agent run logs) |

## Workflow maintenance (`type: workflow`)

When the user asks to set up or change a project workflow (e.g. “sales pipeline”, “lead → qualify → close”):

### 1. Review before editing

Always start with:

```
GET /api/projects/{projectId}/issue-statuses
GET /api/projects/{projectId}/context
```

Understand the **full** stage list: names, `value`, order, `allowedNextStatusValues`, `allowedActors`, default assignees, human-approval flags.

### 2. Custom stage `value` keys (do not reuse template keys)

For sales or other custom pipelines:

- **Do not** only rename default stages while keeping `todo`, `in_progress`, or `in_review` as the stored `value` when the business meaning changed.
- **Do** create stages with explicit values such as `lead_generation`, `qualified`, `email_draft`, `proposal`, `negotiation`, `contract_approval`.
- Keep mandatory values `backlog`, `todo`, `done`, `cancelled` (cannot delete); hide them from the board when custom stages replace them.
- Set **`agentInstructions`** on each active stage with exit criteria and which API keys agents may use.
- After maintenance, agents must not see “Qualified” on the board while the write key is still `in_progress`.

### 3. Do more than transition tweaks

**Not sufficient:** only patching `allowedNextStatusValues` on one or two existing stages.

**Usually required** for setup/redesign requests:

- Add missing stages (`POST /api/projects/{projectId}/issue-statuses`)
- Rename or reconfigure stages (`PATCH .../issue-statuses/{statusId}`)
- Reorder pipeline (`POST .../issue-statuses/reorder`)
- Set default assignees and `allowedActors` for handoffs
- Add human-approval stages where the business process needs sign-off
- Upsert `documents/workflow` as an **agent playbook** (see below), not a dump of API or transition config

### 4. Retire obsolete stages (standing instruction — Admin / workflow maintenance)

After you finish creating or editing the stages the user asked for, **disable or remove** stages that are no longer relevant. Do not leave the default template columns on the board next to a custom pipeline.

1. Re-read `GET /api/projects/{projectId}/issue-statuses` and compare to your final pipeline.
2. For each leftover template stage not used in the new process (e.g. generic `in_progress`, `in_review`, `blocked` when the project uses custom sales stages):
   - **`DELETE`** `DELETE /api/projects/{projectId}/issue-statuses/{statusId}` when the stage is **not** mandatory and no open issues use that `value`. Mandatory values: `backlog`, `todo`, `done`, `cancelled` (cannot be deleted).
   - **`PATCH` `isActive: false`** when delete is not allowed (mandatory `todo` hidden while intake uses custom stages) or issues still reference the stage but it must stay off the board.
3. Update `allowedNextStatusValues` on remaining stages so transitions do not reference retired stages.
4. Note in the maintenance `changeSummary` which stages were **deleted** vs **hidden**.

`backlog` is always list-only and board-hidden. Do not skip this cleanup step before completing a workflow maintenance request.

### 5. Example: sales pipeline

For a sales setup request, aim for a coherent pipeline such as:

`backlog` → `lead` / `prospect` → `qualified` → `proposal` → `negotiation` → human approval if needed → `won` / `lost` → `done`

Adjust to what already exists; merge with mandatory stages (`backlog`, `done`, etc.) rather than fighting the template.

### 6. Major overhaul vs incremental change

| Situation | Action |
| --------- | ------ |
| Add one stage, fix a handoff, adjust transitions | Apply changes directly, then complete the maintenance request |
| Full pipeline redesign, delete/rename many stages, or unclear scope | **Do not** apply destructive edits immediately. Complete the request with `changeSummary` starting with **`REVIEW REQUIRED:`** and bullet the proposed stage plan (names, order, transitions, assignees). Ask the user to confirm via a follow-up request. |
| Request status is `pending_approval` | Do not apply destructive edits until approved. Document the intended plan in `changeSummary`. |

### 7. Permissions

Maintainer one-shots (`project_maintenance_request`) may use `project:edit Workflow` for the target project. Use workflow APIs during workflow maintenance; do not treat stages as read-only in that mode.

### 8. Update workflow summary in the same run

If you changed **any** issue-status in this maintenance run (`POST`/`PATCH`/`reorder`/`DELETE`), you **must** upsert `documents/workflow` **before** completing the request. The server rejects `completed` when the workflow summary is missing or older than the maintenance request.

Use the business-playbook rules in **Workflow summary document** above — not a dump of API fields.

### 9. Close the loop

```
PATCH /api/projects/{projectId}/maintenance-requests/{requestId}
{ "status": "completed", "changeSummary": "..." }
```

`changeSummary` must list concrete changes (stages added/updated/reordered, workflow summary updated). If you only proposed a plan, say so clearly under `REVIEW REQUIRED:` (no pipeline edits required yet).

## Workflow summary document (`documents/workflow`)

This document is injected into heartbeat context as `projectContext.workflowSummary`. Agents read it to understand **how to behave in each stage** — not how the board is wired.

**Write for:** operators and agents executing work.

**Include (plain language, per stage):**

- What this stage is for in the business process
- Who owns work here (role or team, not user IDs)
- Entry criteria and definition of done
- When and how to hand off to the next stage
- Human approval or sign-off rules, escalations, and common exceptions

**Optional intro:** cross-cutting business rules (SLAs, compliance, data quality).

**Do not include:**

- API paths, HTTP verbs, or JSON
- Technical fields such as `allowedNextStatusValues`, `allowedActors`, `isActive`, reorder payloads
- Copy-paste of issue-status API responses

Configure transitions, actors, and assignees via **issue-status APIs** during workflow maintenance. Reflect the resulting process only in business terms in `documents/workflow`.

## Project summary document (`documents/summary`)

This document is injected into heartbeat context as `projectContext.summary`. Humans and agents read it for **why the project exists and how to operate in it** — not how Paperclip is configured.

**Write for:** project operators, agents joining work, and anyone needing shared business context.

**Include (plain language, structured markdown):**

- Project purpose, customer/problem, and what success looks like (metrics or outcomes)
- Current goals, priorities, and recent decisions (with brief rationale when known)
- Risks, blockers, dependencies, and timeline or milestone notes
- **SOPs and runbooks** when present in source files: human procedures, agent checklists, escalation paths, approval rules, data-quality or compliance expectations
- Key terminology, entities, stakeholders/roles, and systems or tools referenced by the business (not internal API names)
- Constraints agents and humans must respect (budget, scope, regions, “do not” rules)

**Do not include:**

- API paths, HTTP verbs, JSON, or issue-status / maintenance-request technical fields
- Copy-paste of full uploaded files or long raw extracts
- The per-stage workflow playbook (that belongs in `documents/workflow`)

Synthesize and curate from `GET .../context-files` extracted text, existing documents, and project state. Prefer concise, actionable sections over exhaustive dumps.

## Task heartbeats (agents working issues)

Every issue adapter prompt includes the **Task run protocol (mandatory)** — five steps: understand → role fit → playbook → comment/attachments → handoff. Steps 3 and 5 use injected stage rules; step 3 may use `projectContext.projectDataApi` / `projectDashboardApi` when present.

From `GET /api/issues/{issueId}/heartbeat-context` (for deeper context):

1. Read `issue.statusMeaning` — business stage vs API key.
2. Read `projectContext.workflowSummary` for the full playbook.
3. Read `projectContext.currentStagePlaybook` when set (stage `agentInstructions`).
4. Read `projectContext.projectDataApi` / `projectContext.projectDashboardApi` for structured data and visibility.
5. Use `projectWorkflow.allowedNextStages` before PATCH; never guess generic `in_progress`.

**Data discipline:** structured operational records belong in project data tables — not only in issue comments. Design table/column and dashboard names from project summary, workflow, and stage playbook. Dashboards must highlight **useful business KPIs and charts** for operators — never run logs, run IDs, or agent telemetry widgets. After writes, verify with `POST .../data/query`. Create or update widgets when operators need ongoing visibility.

## Context sync (`project_maintenance_request` / `project_context_sync`)

- Use extracted file text from `GET .../context-files` when `extractionStatus=complete`.
- Do not leave `summary` empty when source material exists; follow the **Project summary document** rules above.
- Refresh `documents/workflow` when `workflowStatuses` in context changed or the doc is empty/stale, using the playbook rules above.
- Issue-status API mutations also enqueue background context sync; still upsert `documents/workflow` in workflow maintenance runs before completing.

## Safety

- Keep changes company/project-scoped.
- Avoid destructive schema/workflow edits unless explicitly requested, approved, or covered by the review path above.
