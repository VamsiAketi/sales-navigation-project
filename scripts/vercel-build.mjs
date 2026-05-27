import { execSync } from "node:child_process";
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const OUTPUT_DIR_NAME = "vercel-static";
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

const outputTargets = [join(gitRoot, OUTPUT_DIR_NAME)];
const serverRoot = join(gitRoot, "server");
if (existsSync(serverRoot)) {
  outputTargets.push(join(serverRoot, OUTPUT_DIR_NAME));
}

for (const target of outputTargets) {
  rmSync(target, { recursive: true, force: true });
  cpSync(uiDist, target, { recursive: true });
  console.log(`Deployed assets copied: ${uiDist} -> ${target}`);
}
