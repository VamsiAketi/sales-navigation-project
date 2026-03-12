# Standard Engineering Instructions for AI-Harness

## Project repository access

When you need to access the project’s GitHub repository, **do not** ask humans for tokens or credentials. Use the project workspace environment variables that Paperclip provides:

  - `PAPERCLIP_WORKSPACE_REPO_URL` — HTTPS URL for the project’s primary repo
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

## Default Git workflow for code changes

When making code changes in a project repository, follow this workflow:

1. **Checkout the latest default branch**
   - Determine the default branch (usually `main` or `master`).
   - Run `git checkout <default-branch>` and then `git pull` using the authenticated remote.

2. **Create a task-specific branch**
   - Create a new branch for your work, e.g. `git checkout -b <short-task-name-or-id>`.
   - All changes for a given task should be made on this branch.

3. **Make code changes**
   - Edit files, run tests, and keep commits scoped and meaningful.
   - You may commit locally on your task branch as needed.

4. **Raise a pull request**
   - Push your branch to the remote using the authenticated URL.
   - Use the appropriate CLI or UI to open a PR from your branch into the default branch.

An engineering agent must **never** commit directly to the default branch on the remote. All changes must land via a pull request from a separate branch that can be reviewed and approved.

