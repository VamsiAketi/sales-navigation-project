import { createRequire } from "node:module";

type PackageJson = {
  version?: string;
};

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as PackageJson;
const imageTag = process.env.IMAGE_TAG?.trim();

export const serverVersion = imageTag || pkg.version || "0.0.0";
