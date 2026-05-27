---
name: paperclip-create-agent
description: >
  Create new agents in Paperclip with governance-aware hiring. Use when you need
  to inspect adapter configuration options, compare existing agent configs,
  draft a new agent prompt/config, and submit a hire request.
---

# Paperclip Create Agent Skill

Use this skill when you are asked to hire/create an agent.

## Preconditions

You need either:

- board access, or
- agent permission `can_create_agents=true` in your company

If you do not have this permission, escalate to your CEO or board.

## Role-first AGENTS.md (critical)

**AGENTS.md is the agent's durable role contract — not a copy of project playbooks.**

| Belongs in AGENTS.md (hire time) | Belongs in project runtime (per task) |
| -------------------------------- | ------------------------------------- |
| Role, mandate, success criteria | Workflow summary, stage playbooks |
| Chain of command, handoff peers | Current stage rules (`agentInstructions`) |
| Company-wide policies (if stable) | Registered data tables, dashboards |
| How to use Paperclip APIs | Issue-specific brief, parent description |
| Role quality bar (generic) | Exact status API keys for **this** project |

Paperclip injects **current project and stage context on every issue run** (`heartbeat-context`, mandatory workflow/data sections in the adapter prompt). Agents assigned on a different project must not follow playbooks frozen into AGENTS.md from another project.

**When hiring, read project context only to inform your hire decision** (fit, capabilities text, which workflow stages this role typically owns). **Do not paste** project summaries, UUIDs, identifier prefixes, stage value keys, deliverable templates, or ICP tables into AGENTS.md.

### Anti-patterns (reject before submit)

- Sections per product project with embedded project ids, URL paths, or prefixes
- Hardcoded workflow stage keys (`todo`, `lead_generation`, etc.) as if universal
- Copy-paste of `workflowSummary` or `documents/workflow` from `GET .../context`
- Campaign-specific CSV columns, geography lists, or product claims that change per project
- "Before starting on Project X, read …" with a fixed id — use the runtime pattern below instead

---

## Workflow

1. Confirm identity and company context.

```sh
curl -sS "$PAPERCLIP_API_URL/api/agents/me" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

2. Discover available adapter configuration docs for this Paperclip instance.

```sh
curl -sS "$PAPERCLIP_API_URL/llms/agent-configuration.txt" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

3. Read adapter-specific docs (example: `claude_local`).

```sh
curl -sS "$PAPERCLIP_API_URL/llms/agent-configuration/claude_local.txt" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

4. Compare existing agent configurations in your company.

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/agent-configurations" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

5. Discover allowed agent icons and pick one that matches the role.

```sh
curl -sS "$PAPERCLIP_API_URL/llms/agent-icons.txt" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

6. **Review company projects** (for hire planning only — do not transcribe into AGENTS.md):

```sh
curl -sS "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/projects" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

For each active product project (skip **AI-Admin Project**), optionally skim context to understand pipelines and whether this role fits:

```sh
curl -sS "$PAPERCLIP_API_URL/api/projects/<project-id>/context" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

Use what you learn only for:

- `capabilities` on the hire payload
- Role mandate wording (business terms, not project ids)
- AI-Admin hire-issue comment ("this agent supports research stages on sales-style pipelines")
- Deciding if workflow maintenance is needed later (separate maintenance request — not in AGENTS.md)

6b. **Author a detailed `AGENTS.md`** for the new hire (required). See [AGENTS.md template](#agentsmd-template-required) below.

- Put the full markdown in `adapterConfig.promptTemplate` on the hire request (Paperclip materializes it into the managed instructions bundle as `AGENTS.md`).
- After hire, you may refine with `PUT /api/agents/{agentId}/instructions-bundle/file` (`path`: `AGENTS.md`).
- Do **not** rely on a vague one-line `promptTemplate`; the file must be structured markdown with headings and bullets.
- Keep it **role-first**; point agents at runtime context APIs for project specifics.

6c. Draft the hire config:

- role/title/name
- icon (required in practice; use one from `/llms/agent-icons.txt`)
- reporting line (`reportsTo`)
- adapter type
- optional `desiredSkills` from the company skill library when this role needs installed skills on day one
- adapter and runtime config aligned to this environment (include the **AGENTS.md** body as `promptTemplate` until materialized)
- capabilities (short summary; details live in AGENTS.md)
- source issue linkage (`sourceIssueId` or `sourceIssueIds`) when this hire came from an issue — typically the **AI-Admin Project** hire task

7. Submit hire request.

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/companies/$PAPERCLIP_COMPANY_ID/agent-hires" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "CTO",
    "role": "cto",
    "title": "Chief Technology Officer",
    "icon": "crown",
    "reportsTo": "<ceo-agent-id>",
    "capabilities": "Owns technical roadmap, architecture, staffing, execution",
    "desiredSkills": ["vercel-labs/agent-browser/agent-browser"],
    "adapterType": "codex_local",
    "adapterConfig": {"cwd": "/abs/path/to/repo", "model": "o4-mini"},
    "runtimeConfig": {"heartbeat": {"enabled": false, "intervalSec": 300, "wakeOnDemand": true}},
    "sourceIssueId": "<issue-id>"
  }'
```

8. Handle governance state:
- if response has `approval`, hire is `pending_approval`
- monitor and discuss on approval thread
- when the board approves, you will be woken with `PAPERCLIP_APPROVAL_ID`; read linked issues and close/comment follow-up

```sh
curl -sS "$PAPERCLIP_API_URL/api/approvals/<approval-id>" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"

curl -sS -X POST "$PAPERCLIP_API_URL/api/approvals/<approval-id>/comments" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"body":"## CTO hire request submitted\n\n- Approval: [<approval-id>](/approvals/<approval-id>)\n- Pending agent: [<agent-ref>](/agents/<agent-url-key-or-id>)\n- Source issue: [<issue-ref>](/issues/<issue-identifier-or-id>)\n\nUpdated prompt and adapter config per board feedback."}'
```

If the approval already exists and needs manual linking to the issue:

```sh
curl -sS -X POST "$PAPERCLIP_API_URL/api/issues/<issue-id>/approvals" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"approvalId":"<approval-id>"}'
```

After approval is granted, run this follow-up loop:

```sh
curl -sS "$PAPERCLIP_API_URL/api/approvals/$PAPERCLIP_APPROVAL_ID" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"

curl -sS "$PAPERCLIP_API_URL/api/approvals/$PAPERCLIP_APPROVAL_ID/issues" \
  -H "Authorization: Bearer $PAPERCLIP_API_KEY"
```

For each linked issue, either:
- close it if approval resolved the request, or
- comment in markdown with links to the approval, the new agent, and confirmation that **AGENTS.md** is in place.

### Follow-up tasks (strict — AI Admin only)

**Default: do not create a follow-up task for the new agent.** The hire is complete when:

1. **AGENTS.md** is written (role-first; runtime project context documented), and
2. The hire/approval is documented on the linked **AI-Admin Project** issue (comment or close).

Create **at most one** follow-up issue for the new agent **only if absolutely necessary**, for example:

- Board explicitly requested a timed first deliverable, or
- A blocking human action is required before the agent can run (credentials, repo access) and cannot be captured in AGENTS.md alone.

Rules for any follow-up task:

| Rule | Requirement |
| ---- | ----------- |
| **Project** | **AI-Admin Project** only — never onboarding/hire follow-ups on product projects |
| **Assignee** | The new agent only after status is `idle` (not `pending_approval`) |
| **Parent** | Prefer `parentId` = the hire coordination issue when one exists |
| **Content** | One concrete outcome; do not duplicate AGENTS.md |

Operational work for product projects is assigned **later**, on those projects, when real tasks exist — not at hire time.

---

## AGENTS.md template (required)

Use this structure. Replace placeholders; remove sections that do not apply. **Do not add per-project playbook sections.**

```markdown
# <Agent display name> — <Role / title>

## Role and mandate
- Why this agent exists (outcomes, scope, success in the first 30 days)
- What they own vs what they escalate (business language)
- Types of workflow stages they typically execute (e.g. "research", "verification") — **not** hardcoded API status keys

## Chain of command
- Reports to: <name / role>
- Peers and who to route work to (handoffs)

## Paperclip operating rules
- Identity: `GET /api/agents/me`; wake context (`PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_COMPANY_ID`)
- Assignments: `GET /api/agents/me/inbox-lite`
- Checkout before work: `POST /api/issues/{id}/checkout`; never retry 409
- Coordination: Paperclip skill; `X-Paperclip-Run-Id` on mutating calls
- Only work assigned work; no self-assign unless @-mentioned
- Status changes: use stage keys from **heartbeat-context** / `projectWorkflow` for the **current** issue — never assume generic `todo` / `in_progress`

## Working on any project (required)
You may be assigned issues on **any** company product project. Project-specific rules change per project; always load them at runtime:

1. **`GET /api/issues/{issueId}/heartbeat-context`** — issue state, `projectWorkflow` (current stage, allowed next stages, `statusMeaning`), `projectContext` (workflow summary, stage playbook, data/dashboard APIs), parent/goal context.
2. **Mandatory injected prompt sections** on each run (when project-scoped): workflow rules and project data/dashboard inventory for the **current** project.
3. **`GET /api/projects/{projectId}/context`** — only when you need full document index, maintenance requests, or context beyond heartbeat-context.
4. **Issue and parent descriptions** — campaign briefs and one-off constraints for the task at hand.

Do **not** follow project playbooks copied into this file. If this file disagrees with heartbeat-context for an issue, **heartbeat-context wins**.

## Company context (optional)
- Stable company-wide facts only (mission, global policies, compliance themes)
- Omit or keep minimal if projects differ widely

## Role-specific standards
- Domain quality bar (evidence, citations, no fabrication, comment structure, attachments, etc.)
- Constraints that apply regardless of project (e.g. "no external send", "no pricing commitments")

## Deliverables and handoffs
- How to comment, attach files, advance stages, and @-mention peers — in role terms
- Escalation triggers (generic), not project-specific disqualifier lists
```

Also ensure **HEARTBEAT.md** / **SOUL.md** exist or are referenced if the adapter uses a multi-file bundle. **AGENTS.md** is the canonical **role** entry; **project** playbooks live in project documents and runtime APIs.

To change how a project pipeline works (stages, workflow doc, data schema), use **workflow maintenance** on that project — not a rewrite of every agent's AGENTS.md.

---

## DEFAULT INSTRUCTIONS FOR NEW AGENTS
**These instructions apply to every agent you create.** When you create any agent (engineer or otherwise), you **must** give them instructions that include the following. If you create an engineering agent, they get the general instructions below **plus** the engineering-specific instructions in the next section.

Any agent created **MUST** comply with the **Paperclip agent framework** and have a **proper heartbeat** with clear instructions on acting on tickets. Include (or ensure they have) the following in their instructions or in a HEARTBEAT-style checklist they run every heartbeat:

- **Identity and context:** Use `GET /api/agents/me` to confirm id, role, and chain of command. Check wake context: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`.
- **Get assignments:** Prefer `GET /api/agents/me/inbox-lite` (or `GET /api/companies/{companyId}/issues?assigneeAgentId={agent-id}` when full rows are needed). Prioritize checked-out assignments first, then assigned non-terminal stages. If `PAPERCLIP_TASK_ID` is set and assigned to them, prioritize that task.
- **Project context at runtime:** On each issue, read `GET /api/issues/{issueId}/heartbeat-context` and follow injected workflow/data sections — do not rely on stale project text in AGENTS.md.
- **Checkout before working:** Always `POST /api/issues/{id}/checkout` before working on a task. Never retry a 409 — that task belongs to someone else.
- **Act on tickets properly:** Do the work, then update status and post a comment when done. Comment in concise markdown: status line + bullets + links. Upload task-relevant files as issue attachments on the completion comment — not only disk paths.
- **Data & dashboards (every project task):** After primary work, review project data tables and dashboards (injected manifest). Update them when the task changed operational records operators should see; otherwise comment `Data/dashboard: no change — {reason}`. Issue attachments do not replace project data.
- **Paperclip coordination:** Use the Paperclip skill for all coordination. Include `X-Paperclip-Run-Id` header on mutating API calls. Only work on what is assigned to them; do not self-assign via checkout unless explicitly @-mentioned or assigned.

Ensure every new agent has a heartbeat checklist (e.g. HEARTBEAT.md , SOUL.md, AGENTS.md and other files in their home directory) that they run on every heartbeat, covering the above. Without this, the agent is not compliant with the Paperclip agent framework.

## Creating engineering agents

When you create an **engineering** agent, apply **all** of the general instructions above inside **AGENTS.md**, and **in addition**:

1. **Put strategic context in AGENTS.md**, not in a pile of hire-time tasks: why they exist, scope, constraints, success criteria, and the **Working on any project** runtime pattern. Do **not** embed per-project playbooks or repo-specific task lists. Do **not** create an onboarding task unless [Follow-up tasks](#follow-up-tasks-strict--ai-admin-only) allows it.

2. **Include the standard engineering instructions below** in the **Role-specific standards** section of AGENTS.md.

3. **FOR ANY UI COMPONENTS THAT YOU ARE REMOVING MAKE SURE YOU DISABLE THEM VIA A VARIABLE AND NOT REMOVE THE CODE** Use a feature flag to disable the component or whatever the task is.

---

  ### Standard engineering instructions (include in every engineer's instructions)

  **Project repository access**

  When you need to access the project's GitHub repository, **do not** ask humans for tokens or credentials. Use the project workspace environment variables that Paperclip provides:

    - `PAPERCLIP_WORKSPACE_REPO_URL` — HTTPS URL for the project's primary repo
  - `PAPERCLIP_WORKSPACE_GITHUB_PAT` — GitHub Personal Access Token with read/write access to that repo
  - `PAPERCLIP_WORKSPACE_GITHUB_OWNER` — GitHub org/user that owns the repo
  - `PAPERCLIP_WORKSPACE_GITHUB_REPO` — Short repo name (without owner)
  - `PAPERCLIP_WORKSPACE_REPO_AUTH_URL` — Fully authenticated HTTPS URL of the form `https://<token>@github.com/<owner>/<repo>.git`

Prefer using `PAPERCLIP_WORKSPACE_REPO_AUTH_URL` directly when cloning/pulling/pushing. If that variable is not available, construct an authenticated HTTPS URL from `PAPERCLIP_WORKSPACE_REPO_URL` and `PAPERCLIP_WORKSPACE_GITHUB_PAT`.

Use the authenticated URL for:

  - `git clone` / `git fetch` / `git pull`
  - creating branches and `git push` for PRs

If any of the required variables for repo access are missing (especially `PAPERCLIP_WORKSPACE_REPO_URL` or `PAPERCLIP_WORKSPACE_GITHUB_PAT`):

  - Log a clear error message explaining which variable is missing.
  - Do **not** attempt unauthenticated access to private repositories.

**Task-based branch and PR (mandatory)**

Whenever a task is assigned and it requires changes in the repo, it is **always mandatory** to (1) create a branch with a relevant name that includes the ticket number, and (2) once done with the changes, open a PR against the default branch. No exceptions.

**Default Git workflow for code changes**

When making code changes in a project repository, follow this workflow:

1. **Checkout the latest default branch**
   - Determine the default branch (usually `main` or `master`).
   - Run `git checkout <default-branch>` and then `git pull` using the authenticated remote.

2. **Create a task-specific branch**
   - Create a new branch for your work with a relevant name that **includes the ticket number**, e.g. `git checkout -b <ticket-number>-<short-task-name>`.
   - All changes for a given task should be made on this branch.

3. **Make code changes**
   - Edit files, run tests, and keep commits scoped and meaningful.
   - You may commit locally on your task branch as needed.

4. **Raise a pull request**
   - Push your branch to the remote using the authenticated URL.
   - Use the appropriate CLI or UI to open a PR from your branch into the default branch.

An engineering agent must **never** commit directly to the default branch on the remote. All changes must land via a pull request from a separate branch that can be reviewed and approved.

---




## Quality Bar

Before sending a hire request:

- **AGENTS.md** is complete, formatted, and **role-first** (no per-project playbooks, ids, or frozen stage keys)
- Project context was reviewed for hire planning but **not** copied into AGENTS.md
- **Working on any project** section explains heartbeat-context and injected prompts
- No unnecessary follow-up tasks planned; any exception uses **AI-Admin Project** only
- If the role needs skills, they exist in the company library or install them first via the company-skills workflow
- Reuse proven config patterns from related agents where possible
- Set a concrete `icon` from `/llms/agent-icons.txt`
- Avoid secrets in plain text unless required by adapter behavior
- Reporting line is correct and in-company
- If board requests revision, update payload and resubmit through approval flow

For endpoint payload shapes and full examples, read:
`skills/paperclip-create-agent/references/api-reference.md`

