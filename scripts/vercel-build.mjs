import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

process.env.VITE_VERCEL_STATIC = "true";

execSync("pnpm --filter @paperclipai/ui build", {
  stdio: "inherit",
  env: process.env,
});

const uiPackageDir = execSync("pnpm --filter @paperclipai/ui exec pwd", {
  encoding: "utf8",
}).trim();
const uiDist = join(uiPackageDir, "dist");
const rootDist = join(process.cwd(), "dist");

if (!existsSync(uiDist)) {
  throw new Error(`UI build output not found at ${uiDist}`);
}

rmSync(rootDist, { recursive: true, force: true });
cpSync(uiDist, rootDist, { recursive: true });
console.log(`Deployed assets copied: ${uiDist} -> ${rootDist}`);
