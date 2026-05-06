import { z } from "zod";
import { SECRET_PROVIDERS } from "../constants.js";

export const envBindingPlainSchema = z.object({
  type: z.literal("plain"),
  value: z.string(),
});

export const envBindingSecretRefSchema = z.object({
  type: z.literal("secret_ref"),
  secretId: z.string().uuid(),
  version: z.union([z.literal("latest"), z.number().int().positive()]).optional(),
});

export const envBindingProjectSecretRefSchema = z.object({
  type: z.literal("project_secret_ref"),
  secretId: z.string().uuid(),
  version: z.union([z.literal("latest"), z.number().int().positive()]).optional(),
});

// Backward-compatible union that accepts legacy inline values.
export const envBindingSchema = z.union([
  z.string(),
  envBindingPlainSchema,
  envBindingSecretRefSchema,
  envBindingProjectSecretRefSchema,
]);

export const envConfigSchema = z.record(envBindingSchema);

export const createSecretSchema = z.object({
  name: z.string().min(1),
  provider: z.enum(SECRET_PROVIDERS).optional(),
  value: z.string().min(1),
  description: z.string().optional().nullable(),
  externalRef: z.string().optional().nullable(),
});

export type CreateSecret = z.infer<typeof createSecretSchema>;

export const rotateSecretSchema = z.object({
  value: z.string().min(1),
  externalRef: z.string().optional().nullable(),
});

export type RotateSecret = z.infer<typeof rotateSecretSchema>;

export const updateSecretSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  externalRef: z.string().optional().nullable(),
});

export type UpdateSecret = z.infer<typeof updateSecretSchema>;

/** Same shape as company secrets — used for `/projects/:id/project-secrets` routes. */
export const createProjectSecretSchema = createSecretSchema;
export const rotateProjectSecretSchema = rotateSecretSchema;
export const updateProjectSecretSchema = updateSecretSchema;
export type CreateProjectSecret = z.infer<typeof createProjectSecretSchema>;
export type RotateProjectSecret = z.infer<typeof rotateProjectSecretSchema>;
export type UpdateProjectSecret = z.infer<typeof updateProjectSecretSchema>;
