# Deploy Sales Navigation to Vercel

This project is configured for a **static Vercel deployment** (no separate backend required).

- Excel upload is parsed in the browser
- Graph + status are stored in the browser (`localStorage`)
- Works on Vercel free tier

## 1. Push to GitHub

Repository: `git@github.com:VamsiAketi/sales-navigation-project.git`

## 2. Import in Vercel

1. Open [https://vercel.com/new](https://vercel.com/new)
2. Import `VamsiAketi/sales-navigation-project`
3. Use branch: `feature/sales-navigation` (or `main` after merge)

## 3. Project settings

**Root Directory:** can be empty (repo root) or `server` — the build copies UI output into `dist` under that directory.

Set **Output Directory** to `dist` (Vercel dashboard → Project Settings → Build & Deployment).

| Setting | Value |
|--------|--------|
| Install Command | `corepack enable && pnpm install --filter @paperclipai/ui... --frozen-lockfile` |
| Build Command | `node scripts/vercel-build.mjs` |
| Output Directory | `dist` |
| Framework Preset | Other |

## 4. Environment variables

None required for the static deployment mode.

Optional (only if you later add a hosted API):

- `VITE_API_BASE_URL` — not used in static mode

## 5. Deploy

Click **Deploy**. When the build finishes, open your Vercel URL.

## Local test (same as Vercel build)

```powershell
cd C:\Users\LENOVO\Documents\sales-navigation-project
$env:VITE_VERCEL_STATIC="true"
pnpm --filter @paperclipai/ui build
pnpm --filter @paperclipai/ui preview
```

## Notes

- Vercel install uses `pnpm install --filter @paperclipai/ui...` so only the UI and its dependencies are installed (avoids plugin/server bin warnings from the rest of the monorepo).
- Data is per browser (clearing site data removes imported Excel graphs).
- LinkedIn avatars use initials fallback on Vercel (no server proxy).
- For team-shared data, host the full Paperclip server with `DATABASE_URL` (Neon/Supabase) separately and set `VITE_VERCEL_STATIC=false`.
