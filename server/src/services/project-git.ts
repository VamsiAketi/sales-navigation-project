import type { Db } from "@paperclipai/db";
import { projectWorkspaces, projects } from "@paperclipai/db";
import { and, asc, eq } from "drizzle-orm";
import { secretService } from "./secrets.js";

export interface ProjectGitHubBinding {
  companyId: string;
  projectId: string;
  workspaceId: string;
  repoUrl: string;
  repoOwner: string;
  repoName: string;
  githubSecretId: string;
}

export interface ProjectGitHubCredentials extends ProjectGitHubBinding {
  token: string;
}

/**
 * Compare two GitHub repo URLs for the same repository (ignores trailing slash,
 * optional `.git` suffix, and host casing).
 */
export function githubRepoUrlsEquivalent(a: string, b: string): boolean {
  const norm = (raw: string) => {
    const trimmed = raw.trim();
    try {
      const u = new URL(trimmed);
      if (u.hostname.toLowerCase() !== "github.com") {
        return trimmed.toLowerCase();
      }
      let pathPart = u.pathname.replace(/\/+$/, "");
      if (pathPart.toLowerCase().endsWith(".git")) {
        pathPart = pathPart.slice(0, -4);
      }
      return `https://github.com${pathPart.toLowerCase()}`;
    } catch {
      return trimmed.toLowerCase();
    }
  };
  return norm(a) === norm(b);
}

function parseGitHubRepoUrl(repoUrl: string): { owner: string; name: string } {
  try {
    const url = new URL(repoUrl);
    if (url.hostname !== "github.com") {
      throw new Error("Only github.com is supported for project workspaces today");
    }
    const cleanedPath = url.pathname.replace(/\/+$/, "");
    const segments = cleanedPath.split("/").filter(Boolean);
    if (segments.length < 2) {
      throw new Error("Invalid GitHub repo URL");
    }
    const owner = segments[0]!;
    const last = segments[segments.length - 1]!;
    const name = last.replace(/\.git$/i, "");
    if (!owner || !name) {
      throw new Error("Invalid GitHub repo URL");
    }
    return { owner, name };
  } catch (err) {
    throw new Error(
      err instanceof Error ? err.message : "Invalid GitHub repo URL",
    );
  }
}

/**
 * Resolve the logical GitHub binding for a project: which workspace, repo and
 * company secret ID should be used. This does NOT resolve the secret value.
 *
 * The convention is:
 *
 * - The primary project workspace must have a non-null repoUrl.
 * - The workspace metadata may optionally include:
 *   - githubSecretId: string (company_secrets.id)
 *   - githubRepoOwner: string (to override owner parsed from repoUrl)
 *   - githubRepoName: string (to override repo name parsed from repoUrl)
 */
export async function resolveProjectGitHubBinding(
  db: Db,
  projectId: string,
): Promise<ProjectGitHubBinding | null> {
  const project = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId))
    .then((rows) => rows[0] ?? null);
  if (!project) return null;

  const workspace = await db
    .select()
    .from(projectWorkspaces)
    .where(
      and(
        eq(projectWorkspaces.projectId, projectId),
        eq(projectWorkspaces.companyId, project.companyId),
      ),
    )
    .orderBy(asc(projectWorkspaces.createdAt), asc(projectWorkspaces.id))
    .then((rows) => {
      if (rows.length === 0) return null;
      const explicitPrimary = rows.find((row) => row.isPrimary);
      return explicitPrimary ?? rows[0] ?? null;
    });
  if (!workspace || !workspace.repoUrl) {
    return null;
  }

  const metadata =
    (workspace.metadata as
      | {
          githubSecretId?: unknown;
          githubRepoOwner?: unknown;
          githubRepoName?: unknown;
          projectSecrets?: { githubPatSecretId?: unknown } | null;
        }
      | null
      | undefined) ?? null;

  let githubSecretId: string | null = null;
  if (typeof metadata?.githubSecretId === "string") {
    githubSecretId = metadata.githubSecretId;
  } else {
    const projectSecretsBinding = metadata?.projectSecrets;
    if (
      projectSecretsBinding &&
      typeof projectSecretsBinding === "object" &&
      typeof (projectSecretsBinding as { githubPatSecretId?: unknown }).githubPatSecretId === "string"
    ) {
      githubSecretId = (projectSecretsBinding as { githubPatSecretId: string }).githubPatSecretId;
    }
  }
  if (!githubSecretId) {
    return null;
  }

  const parsed = parseGitHubRepoUrl(workspace.repoUrl);
  const repoOwner =
    typeof metadata?.githubRepoOwner === "string"
      ? metadata.githubRepoOwner
      : parsed.owner;
  const repoName =
    typeof metadata?.githubRepoName === "string"
      ? metadata.githubRepoName
      : parsed.name;

  return {
    companyId: project.companyId,
    projectId: project.id,
    workspaceId: workspace.id,
    repoUrl: workspace.repoUrl,
    repoOwner,
    repoName,
    githubSecretId,
  };
}

/**
 * Resolve concrete GitHub credentials for a project from its workspace and
 * bound company secret. The returned token MUST NOT be exposed in any API
 * responses or logs; it is intended solely for server-side git / GitHub API
 * callers.
 */
export async function resolveProjectGitHubCredentials(
  db: Db,
  projectId: string,
): Promise<ProjectGitHubCredentials | null> {
  const binding = await resolveProjectGitHubBinding(db, projectId);
  if (!binding) return null;

  const svc = secretService(db) as ReturnType<typeof secretService> & {
    resolveSecretValue: (
      companyId: string,
      secretId: string,
      version: number | "latest",
    ) => Promise<string>;
  };
  const token = await svc.resolveSecretValue(
    binding.companyId,
    binding.githubSecretId,
    "latest",
  );

  return {
    ...binding,
    token,
  };
}

