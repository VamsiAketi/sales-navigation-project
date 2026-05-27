import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

// Vercel Root Directory may be repo root, ui/, or server/ — always find git root for pnpm.
const vercelCwd = process.cwd();
const gitRoot = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const deployDist = join(vercelCwd, "dist");

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

rmSync(deployDist, { recursive: true, force: true });
cpSync(uiDist, deployDist, { recursive: true });
console.log(`Deployed assets copied: ${uiDist} -> ${deployDist}`);
