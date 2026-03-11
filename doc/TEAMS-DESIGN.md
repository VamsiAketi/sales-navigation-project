# Teams: Design for Collaboration Space Rebrand

**Context.** The app is currently built for one person running many “zero human” AI companies. The goal is to rebrand and sell it as a **collaboration space for humans and AI agents within a company**, with **teams** as a first-class concept.

This document describes the recommended approach: first-class teams, who belongs to them, and how to implement without a rewrite.

---

## 1. Product shift (summary)

| Current (V1) | Target (rebrand) |
|--------------|-------------------|
| One board operator, many companies | Multiple humans per company, collaboration |
| “Company” = AI-only org | Company = humans + AI; teams = collaboration units |
| No team concept | Teams own work and membership (humans + agents) |

**Invariant to keep:** Company remains the top-level tenant. Everything stays company-scoped; teams are a sub-scope inside a company.

---

## 2. Recommended model: first-class teams

Introduce a **Team** entity between Company and work (agents, projects, issues). Both humans and agents can belong to teams so that “this team” has a clear roster and scope.

### 2.1 New entity: `teams`

- **teams**
  - `id` uuid pk  
  - `company_id` uuid fk not null  
  - `name` text not null  
  - `description` text null  
  - `slug` text null (optional, for URLs; unique per company)  
  - `parent_team_id` uuid fk teams.id null (optional; nested teams later)  
  - `created_at`, `updated_at`

Invariant: every team belongs to exactly one company.

### 2.2 What belongs to a team

- **Agents**  
  - Add optional `team_id` fk.  
  - Keep `reports_to` for org tree (reporting can stay within or across teams).  
  - “Team” = primary collaboration unit; “reports_to” = reporting line.

- **Projects**  
  - Add optional `team_id` fk.  
  - Projects are then “this team’s project”; filtering by team is straightforward.

- **Issues**  
  - Option A (recommended for V1): no `team_id` on issues; team is derived from **project** (or from assignee’s team if no project).  
  - Option B: add optional `team_id` for unprojected work or when a task is team-scoped but not project-scoped.  
  - Start with Option A; add Option B only if you need “team tasks” without a project.

- **Goals**  
  - Keep existing goal hierarchy and `level` (company | team | agent | task).  
  - Optionally add `team_id` to goals where `level = 'team'` for clarity and filtering.  
  - Not strictly required for first release if you filter “team goals” by owner_agent’s team or by projects in that team.

### 2.3 Human membership in teams

You already have **company_memberships** (principal = user or agent). To support “humans in a team”:

- **Option A – Team membership table (recommended)**  
  - **team_members**  
    - `id`, `team_id` fk, `company_id` fk (denorm for company-scoped queries)  
    - `principal_type` ('user' | 'agent'), `principal_id`  
    - `role` text null (e.g. 'lead', 'member')  
    - `created_at`, `updated_at`  
  - Unique on `(team_id, principal_type, principal_id)`.  
  - Agents get a row when assigned to a team (via `team_id` on agents); optionally also add a row here for symmetry and future role/permission.  
  - Humans get a row when added to the team.  
  - One human can be in multiple teams in the same company.

- **Option B – team_id on company_memberships**  
  - Add optional `team_id` to company_memberships.  
  - Implies each membership is “user in company” with optional “and in this team”.  
  - Simpler schema but less flexible (e.g. one row per user per team; if you later add roles per team, you need more columns or another table).

**Recommendation:** Option A (team_members). Use it for humans; agents can be represented by `agents.team_id` and optionally by a row in team_members for a single “who’s in this team?” query.

### 2.4 Visibility and permissions (later)

- **V1:** All company members can see all teams and team-scoped work (same as today: company-scoped visibility).  
- **Later:** Team-scoped visibility (“only see my team’s work”) and team-level roles can build on `team_members` and existing permission primitives.

---

## 3. Implementation approach

### 3.1 Phase 1 – Teams and scoping (minimal slice)

1. **Schema**
   - Add `teams` table.
   - Add optional `team_id` to `agents` and `projects`.
   - Add `team_members` (if you want humans-in-teams in Phase 1) or defer to Phase 2.

2. **API**
   - CRUD for teams under a company:  
     `GET/POST /companies/:companyId/teams`,  
     `GET/PATCH /teams/:teamId`,  
     `DELETE /teams/:teamId` (or soft-delete).
   - List agents/projects by team:  
     e.g. `GET /companies/:companyId/agents?teamId=...`,  
     `GET /companies/:companyId/projects?teamId=...`.
   - When creating/updating agents and projects, accept optional `teamId` and enforce `team.company_id === company_id`.

3. **UI**
   - Team list and create/edit under a company (e.g. `/companies/:id/teams`).
   - When creating/editing an agent or project, optional “Team” selector.
   - Filters: “All teams” vs “Team: X” on agents and projects (and thus on issues via project).

4. **Data**
   - Migration: add tables and columns; leave `team_id` null. No backfill required.

### 3.2 Phase 2 – Human team membership

1. Add `team_members` (if not in Phase 1).
2. API: `GET /teams/:teamId/members`, `POST /teams/:teamId/members`, `DELETE /teams/:teamId/members/:principalType/:principalId`.
3. UI: “Team members” (humans + agents) and “Add to team” for users.

### 3.3 Phase 3 – Team-centric UX (optional)

- Default “current team” in nav (like “current company”).
- Dashboard/views scoped to “my team” or “selected team”.
- Team-level budgets or cost views (aggregate from agents/projects in that team).

---

## 4. What to touch (checklist)

- **packages/db**
  - New: `teams.ts`, `team_members.ts` (if Phase 1 or 2).
  - Alter: `agents.ts` (team_id), `projects.ts` (team_id); optionally `goals.ts` (team_id).
  - Export new tables from schema index.
  - Generate migration: `pnpm db:generate`.
- **packages/shared**
  - Types and validators for team, team member; API path constants for team routes.
- **server**
  - Routes: companies/:companyId/teams, teams/:teamId; optional teams/:teamId/members.
  - Services: team CRUD; enforce company and (when applicable) team scope on agent/project create/update.
  - List agents/projects: filter by `teamId` when provided.
- **ui**
  - Team list and create/edit; team selector on agent/project forms; team filter on lists.
- **doc**
  - Update SPEC-implementation.md (and PRODUCT.md if you rebrand) to describe teams and collaboration positioning.

---

## 5. Rebrand and docs

- **Positioning:** “Collaboration space for humans and AI agents within a company” — teams are the primary place where people and agents work together.
- **SPEC-implementation.md:** Add a “Teams” subsection under the canonical data model; add team endpoints to the API contract; note “team-scoped visibility” as a post-V1 option.
- **PRODUCT.md:** Reframe from “one operator, many companies” to “companies with multiple humans and AI, organized in teams.”

This gives you a clear path to teams and collaboration without redesigning the rest of the app: company stays the tenant, and teams become the main way to group humans, agents, and work for the rebrand.
