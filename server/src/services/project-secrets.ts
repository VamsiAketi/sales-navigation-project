import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { projectSecrets, projectSecretVersions, projects } from "@paperclipai/db";
import type { SecretProvider } from "@paperclipai/shared";
import { conflict, notFound, unprocessable } from "../errors.js";
import { getSecretProvider, listSecretProviders } from "../secrets/provider-registry.js";

export function projectSecretService(db: Db) {
  async function assertProjectScope(companyId: string, projectId: string) {
    const row = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, projectId), eq(projects.companyId, companyId)))
      .then((rows) => rows[0] ?? null);
    if (!row) throw notFound("Project not found");
  }

  async function getById(id: string) {
    return db
      .select()
      .from(projectSecrets)
      .where(eq(projectSecrets.id, id))
      .then((rows) => rows[0] ?? null);
  }

  async function getByName(companyId: string, projectId: string, name: string) {
    return db
      .select()
      .from(projectSecrets)
      .where(
        and(
          eq(projectSecrets.companyId, companyId),
          eq(projectSecrets.projectId, projectId),
          eq(projectSecrets.name, name),
        ),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function getSecretVersion(secretId: string, version: number) {
    return db
      .select()
      .from(projectSecretVersions)
      .where(
        and(eq(projectSecretVersions.secretId, secretId), eq(projectSecretVersions.version, version)),
      )
      .then((rows) => rows[0] ?? null);
  }

  async function assertSecretInProject(companyId: string, projectId: string, secretId: string) {
    const secret = await getById(secretId);
    if (!secret) throw notFound("Secret not found");
    if (secret.companyId !== companyId) throw unprocessable("Secret must belong to same company");
    if (secret.projectId !== projectId) throw unprocessable("Secret must belong to same project");
    return secret;
  }

  async function resolveSecretValue(
    companyId: string,
    projectId: string,
    secretId: string,
    version: number | "latest",
  ): Promise<string> {
    const secret = await assertSecretInProject(companyId, projectId, secretId);
    const resolvedVersion = version === "latest" ? secret.latestVersion : version;
    const versionRow = await getSecretVersion(secret.id, resolvedVersion);
    if (!versionRow) throw notFound("Secret version not found");
    const provider = getSecretProvider(secret.provider as SecretProvider);
    return provider.resolveVersion({
      material: versionRow.material as Record<string, unknown>,
      externalRef: secret.externalRef,
    });
  }

  return {
    listProviders: () => listSecretProviders(),

    list: async (companyId: string, projectId: string) => {
      await assertProjectScope(companyId, projectId);
      return db
        .select()
        .from(projectSecrets)
        .where(and(eq(projectSecrets.companyId, companyId), eq(projectSecrets.projectId, projectId)))
        .orderBy(desc(projectSecrets.createdAt));
    },

    getById,
    getByName,
    resolveSecretValue,

    create: async (
      companyId: string,
      projectId: string,
      input: {
        name: string;
        provider: SecretProvider;
        value: string;
        description?: string | null;
        externalRef?: string | null;
      },
      actor?: { userId?: string | null; agentId?: string | null },
    ) => {
      await assertProjectScope(companyId, projectId);
      const existing = await getByName(companyId, projectId, input.name);
      if (existing) throw conflict(`Project secret already exists: ${input.name}`);

      const provider = getSecretProvider(input.provider);
      const prepared = await provider.createVersion({
        value: input.value,
        externalRef: input.externalRef ?? null,
      });

      return db.transaction(async (tx) => {
        const secret = await tx
          .insert(projectSecrets)
          .values({
            companyId,
            projectId,
            name: input.name,
            provider: input.provider,
            externalRef: prepared.externalRef,
            latestVersion: 1,
            description: input.description ?? null,
            createdByAgentId: actor?.agentId ?? null,
            createdByUserId: actor?.userId ?? null,
          })
          .returning()
          .then((rows) => rows[0] ?? null);

        if (!secret) throw notFound("Secret not found");

        await tx.insert(projectSecretVersions).values({
          secretId: secret.id,
          version: 1,
          material: prepared.material,
          valueSha256: prepared.valueSha256,
          createdByAgentId: actor?.agentId ?? null,
          createdByUserId: actor?.userId ?? null,
        });

        return secret;
      });
    },

    rotate: async (
      secretId: string,
      input: { value: string; externalRef?: string | null },
      actor?: { userId?: string | null; agentId?: string | null },
    ) => {
      const secret = await getById(secretId);
      if (!secret) throw notFound("Secret not found");
      const provider = getSecretProvider(secret.provider as SecretProvider);
      const nextVersion = secret.latestVersion + 1;
      const prepared = await provider.createVersion({
        value: input.value,
        externalRef: input.externalRef ?? secret.externalRef ?? null,
      });

      return db.transaction(async (tx) => {
        await tx.insert(projectSecretVersions).values({
          secretId: secret.id,
          version: nextVersion,
          material: prepared.material,
          valueSha256: prepared.valueSha256,
          createdByAgentId: actor?.agentId ?? null,
          createdByUserId: actor?.userId ?? null,
        });

        const updated = await tx
          .update(projectSecrets)
          .set({
            latestVersion: nextVersion,
            externalRef: prepared.externalRef,
            updatedAt: new Date(),
          })
          .where(eq(projectSecrets.id, secret.id))
          .returning()
          .then((rows) => rows[0] ?? null);

        if (!updated) throw notFound("Secret not found");
        return updated;
      });
    },

    update: async (
      secretId: string,
      patch: { name?: string; description?: string | null; externalRef?: string | null },
    ) => {
      const secret = await getById(secretId);
      if (!secret) throw notFound("Secret not found");

      if (patch.name && patch.name !== secret.name) {
        const duplicate = await getByName(secret.companyId, secret.projectId, patch.name);
        if (duplicate && duplicate.id !== secret.id) {
          throw conflict(`Project secret already exists: ${patch.name}`);
        }
      }

      return db
        .update(projectSecrets)
        .set({
          name: patch.name ?? secret.name,
          description: patch.description === undefined ? secret.description : patch.description,
          externalRef: patch.externalRef === undefined ? secret.externalRef : patch.externalRef,
          updatedAt: new Date(),
        })
        .where(eq(projectSecrets.id, secret.id))
        .returning()
        .then((rows) => rows[0] ?? null);
    },

    remove: async (secretId: string) => {
      const secret = await getById(secretId);
      if (!secret) return null;
      await db.delete(projectSecrets).where(eq(projectSecrets.id, secretId));
      return secret;
    },
  };
}
