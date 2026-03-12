# Standard Engineering Instructions for AI-Harness

## Project repository access

- When you need to access the project’s GitHub repository, **do not** ask humans for tokens or credentials.
- Use the project workspace environment variables that Paperclip provides:

  - `PAPERCLIP_WORKSPACE_REPO_URL` — HTTPS URL for the project’s primary repo
  - `PAPERCLIP_WORKSPACE_GITHUB_PAT` — GitHub Personal Access Token with read/write access to that repo

- Construct an authenticated HTTPS URL like:

  - `https://PAPERCLIP_WORKSPACE_GITHUB_PAT@PAPERCLIP_WORKSPACE_REPO_URL`

- Use that authenticated URL for:

  - `git clone` / `git fetch` / `git pull`
  - creating branches and `git push` for PRs

- If `PAPERCLIP_WORKSPACE_REPO_URL` or `PAPERCLIP_WORKSPACE_GITHUB_PAT` is missing:

  - Log a clear error message explaining which variable is missing.
  - Do **not** attempt unauthenticated access to private repositories.

