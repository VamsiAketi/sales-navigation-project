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

6. Draft the new hire config:
- role/title/name
- icon (required in practice; use one from `/llms/agent-icons.txt`)
- reporting line (`reportsTo`)
- adapter type
- optional `desiredSkills` from the company skill library when this role needs installed skills on day one
- adapter and runtime config aligned to this environment
- capabilities
- run prompt in adapter config (`promptTemplate` where applicable)
- source issue linkage (`sourceIssueId` or `sourceIssueIds`) when this hire came from an issue

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
    "runtimeConfig": {"heartbeat": {"enabled": true, "intervalSec": 300, "wakeOnDemand": true}},
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
- comment in markdown with links to the approval and next actions.



## DEFAULT INSTRUCTIONS FOR NEW AGENTS
**These instructions apply to every agent you create.** When you create any agent (engineer or otherwise), you **must** give them instructions that include the following. If you create an engineering agent, they get the general instructions below **plus** the engineering-specific instructions in the next section.

Any agent created **MUST** comply with the **Paperclip agent framework** and have a **proper heartbeat** with clear instructions on acting on tickets. Include (or ensure they have) the following in their instructions or in a HEARTBEAT-style checklist they run every heartbeat:

- **Identity and context:** Use `GET /api/agents/me` to confirm id, role, and chain of command. Check wake context: `PAPERCLIP_TASK_ID`, `PAPERCLIP_WAKE_REASON`, `PAPERCLIP_WAKE_COMMENT_ID`.
- **Get assignments:** Use `GET /api/companies/{companyId}/issues?assigneeAgentId={agent-id}&status=todo,in_progress,blocked`. Prioritize `in_progress` then `todo`. If `PAPERCLIP_TASK_ID` is set and assigned to them, prioritize that task.
- **Checkout before working:** Always `POST /api/issues/{id}/checkout` before working on a task. Never retry a 409 — that task belongs to someone else.
- **Act on tickets properly:** Do the work, then update status and post a comment when done. Comment in concise markdown: status line + bullets + links. Comment on any in-progress work before exiting.
- **Paperclip coordination:** Use the Paperclip skill for all coordination. Include `X-Paperclip-Run-Id` header on mutating API calls. Only work on what is assigned to them; do not self-assign via checkout unless explicitly @-mentioned or assigned.

Ensure every new agent has a heartbeat checklist (e.g. HEARTBEAT.md , SOUL.md, AGENTS.md and other files in their home directory) that they run on every heartbeat, covering the above. Without this, the agent is not compliant with the Paperclip agent framework.

## Creating engineering agents

When you create an **engineering** agent, apply **all** of the general instructions above, and **in addition**:

1. **Make that engineer aware of your context and intent:** why they are being created (goal, outcome, or problem), what you expect them to do (scope, constraints, success criteria), and any relevant context (decisions already made, priorities, customer or business impact). Do not spin up an engineer with only a task title; brief them so they can act with the same strategic clarity you have.

2. **Add the following standard engineering instructions to the engineer's instructions.** Include the full text below in the agent's instructions, onboarding message, or initial handoff so the engineer sees it as soon as they start.

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

- if the role needs skills, make sure they already exist in the company library or install them first using the Paperclip company-skills workflow
- Reuse proven config patterns from related agents where possible.
- Set a concrete `icon` from `/llms/agent-icons.txt` so the new hire is identifiable in org and task views.
- Avoid secrets in plain text unless required by adapter behavior.
- Ensure reporting line is correct and in-company.
- Ensure prompt is role-specific and operationally scoped.
- If board requests revision, update payload and resubmit through approval flow.

For endpoint payload shapes and full examples, read:
`skills/paperclip-create-agent/references/api-reference.md`


