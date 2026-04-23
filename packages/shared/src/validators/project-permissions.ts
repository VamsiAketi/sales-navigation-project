import { z } from "zod";
import { PRINCIPAL_TYPES, PROJECT_PERMISSION_KEYS } from "../constants.js";

const projectPermissionKeySchema = z.enum(PROJECT_PERMISSION_KEYS);

export const updateProjectPrincipalGrantsSchema = z
  .object({
    principalType: z.enum(PRINCIPAL_TYPES),
    principalId: z.string().min(1),
    permissionKeys: z.array(projectPermissionKeySchema).default([]),
  })
  .strict();

export type UpdateProjectPrincipalGrants = z.infer<typeof updateProjectPrincipalGrantsSchema>;
