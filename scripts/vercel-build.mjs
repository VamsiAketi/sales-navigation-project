import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

// Preserve Vercel project root before we cd to git toplevel (Root Directory may be server/ or repo root).
const vercelOutputDir =
  process.env.VERCEL_OUTPUT_DIR?.trim() ||
  join(process.cwd(), "dist");

const gitRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
process.chdir(gitRoot);
process.env.VITE_VERCEL_STATIC = "true";

execSync("pnpm --filter @paperclipai/ui build", {
  stdio: "inherit",
  env: process.env,
});

const uiPackageDir = execSync("pnpm --filter @paperclipai/ui exec pwd", {
  encoding: "utf8",
}).trim();
const uiDist = join(uiPackageDir, "dist");

if (!existsSync(uiDist)) {
  throw new Error(`UI build output not found at ${uiDist}`);
}

rmSync(vercelOutputDir, { recursive: true, force: true });
cpSync(uiDist, vercelOutputDir, { recursive: true });
console.log(`Deployed assets copied: ${uiDist} -> ${vercelOutputDir}`);
