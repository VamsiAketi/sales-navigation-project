import { execSync } from "node:child_process";

process.env.VITE_VERCEL_STATIC = "true";

execSync("pnpm --filter @paperclipai/ui build", {
  stdio: "inherit",
  env: process.env,
});
