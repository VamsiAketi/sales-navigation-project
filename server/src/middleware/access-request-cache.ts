import { AsyncLocalStorage } from "node:async_hooks";
import type { PermissionKey } from "@paperclipai/shared";

export type AccessRequestCache = {
  instanceAdminByUserId: Map<string, boolean>;
  membershipByKey: Map<string, unknown>;
  companyRestrictedAccess: Map<string, boolean>;
  companyPermissionsByKey: Map<string, (permission: PermissionKey) => boolean>;
  visibleProjectIdsByKey: Map<string, string[] | null>;
};

const storage = new AsyncLocalStorage<AccessRequestCache>();

function createAccessRequestCache(): AccessRequestCache {
  return {
    instanceAdminByUserId: new Map(),
    membershipByKey: new Map(),
    companyRestrictedAccess: new Map(),
    companyPermissionsByKey: new Map(),
    visibleProjectIdsByKey: new Map(),
  };
}

/** Run the rest of the request pipeline with a per-request access memoization cache. */
export function accessRequestCacheMiddleware(_req: unknown, _res: unknown, next: () => void) {
  storage.run(createAccessRequestCache(), next);
}

export function getAccessRequestCache(): AccessRequestCache | null {
  return storage.getStore() ?? null;
}
