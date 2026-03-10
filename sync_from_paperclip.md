# Keeping This Private Repo Synced With Upstream

This repo is a private fork-style clone of:

- **Private repo (`origin`)**: `https://github.com/ai-harness/ai-harness-app.git`
- **Source repo (`upstream`)**: `https://github.com/paperclipai/paperclip.git`
- **Default branch**: `master`

This guide shows how to pull changes from the source repo into this private repo.

---

## One-time setup

If you have not already added the source repo as `upstream`, run:

```bash
git remote add upstream https://github.com/paperclipai/paperclip.git
```

Verify remotes:

```bash
git remote -v
```

Expected result:

```bash
origin    https://github.com/ai-harness/ai-harness-app.git (fetch)
origin    https://github.com/ai-harness/ai-harness-app.git (push)
upstream  https://github.com/paperclipai/paperclip.git (fetch)
upstream  https://github.com/paperclipai/paperclip.git (push)
```

---

## Regular sync workflow

### 1. Switch to the main working branch

```bash
git checkout master
```

### 2. Fetch latest changes from the source repo

```bash
git fetch upstream
```

### 3. Merge upstream changes into local `master`

```bash
git merge upstream/master
```

### 4. Push the updated branch to the private repo

```bash
git push origin master
```

---

## Fast version

Use this when everything is clean and you just want the usual update flow:

```bash
git checkout master
git fetch upstream
git merge upstream/master
git push origin master
```

---

## If you prefer rebase instead of merge

Some people prefer a cleaner linear history:

```bash
git checkout master
git fetch upstream
git rebase upstream/master
git push origin master
```

If you already pushed commits before rebasing, you may need:

```bash
git push --force-with-lease origin master
```

Use `--force-with-lease` carefully.

---

## Check current remote setup

```bash
git remote -v
```

## Check which branches exist remotely

```bash
git branch -r
```

## See what will be merged before merging

```bash
git log master..upstream/master --oneline
```

---

## If merge conflicts happen

1. Run the merge:
   ```bash
   git merge upstream/master
   ```
2. Fix the conflicted files.
3. Mark them resolved:
   ```bash
   git add .
   ```
4. Complete the merge:
   ```bash
   git commit
   ```
5. Push the result:
   ```bash
   git push origin master
   ```

---

## Recommended safe routine before syncing

```bash
git status
```

If you have local uncommitted changes, either commit them first or stash them:

```bash
git stash
```

After the sync:

```bash
git stash pop
```

---

## One-time clone example

If setting this up from scratch again:

```bash
git clone https://github.com/ai-harness/ai-harness-app.git
cd ai-harness-app
git remote add upstream https://github.com/paperclipai/paperclip.git
git checkout master
```

---

## Recommended command to copy/paste most often

```bash
git checkout master && git fetch upstream && git merge upstream/master && git push origin master
```

---

## Notes

- `origin` = this private repository
- `upstream` = the original source repository
- Both repos use `master` as the branch to sync
- Run the sync from `master` unless you intentionally maintain a different workflow

