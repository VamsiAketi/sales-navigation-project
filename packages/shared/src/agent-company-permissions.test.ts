import { describe, expect, it } from "vitest";
import {
  AGENT_BASE_COMPANY_PERMISSIONS,
  AGENT_CEO_EXTRA_COMPANY_PERMISSIONS,
  defaultCompanyPermissionsForAgentRole,
  mergeAgentCompanyPermissionGrants,
} from "./agent-company-permissions.js";

describe("defaultCompanyPermissionsForAgentRole", () => {
  it("returns baseline permissions for general agents", () => {
    expect(defaultCompanyPermissionsForAgentRole("general")).toEqual([...AGENT_BASE_COMPANY_PERMISSIONS]);
    expect(defaultCompanyPermissionsForAgentRole("engineer")).toEqual([...AGENT_BASE_COMPANY_PERMISSIONS]);
  });

  it("includes CEO extras for ceo role", () => {
    const keys = defaultCompanyPermissionsForAgentRole("ceo");
    for (const key of AGENT_BASE_COMPANY_PERMISSIONS) {
      expect(keys).toContain(key);
    }
    for (const key of AGENT_CEO_EXTRA_COMPANY_PERMISSIONS) {
      expect(keys).toContain(key);
    }
  });
});

describe("mergeAgentCompanyPermissionGrants", () => {
  it("includes role defaults when invite payload is empty", () => {
    expect(mergeAgentCompanyPermissionGrants([], "general").map((grant) => grant.permissionKey)).toEqual([
      ...AGENT_BASE_COMPANY_PERMISSIONS,
    ]);
  });

  it("preserves invite extras and scoped overrides", () => {
    const merged = mergeAgentCompanyPermissionGrants(
      [{ permissionKey: "tasks:assign", scope: { projectId: "project-1" } }],
      "general",
    );
    expect(merged.find((grant) => grant.permissionKey === "tasks:assign")).toEqual({
      permissionKey: "tasks:assign",
      scope: { projectId: "project-1" },
    });
    expect(merged.find((grant) => grant.permissionKey === "tasks.create")).toEqual({
      permissionKey: "tasks.create",
      scope: null,
    });
  });
});
