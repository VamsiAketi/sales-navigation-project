// @vitest-environment node

import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import {
  assigneeUpdateErrorMessage,
  humanReadablePermissionRequirement,
  isPermissionDeniedError,
  parsePermissionRequirementMessage,
  permissionDeniedToastFromServerMessage,
} from "./permission-feedback";

describe("permission-denied UI helpers", () => {
  it("detects 403 responses for Teams member visibility", () => {
    expect(isPermissionDeniedError(new ApiError("Permission denied", 403, { error: "Permission denied" }))).toBe(true);
    expect(isPermissionDeniedError(new ApiError("Unauthorized", 401, { error: "Unauthorized" }))).toBe(false);
    expect(isPermissionDeniedError(new Error("boom"))).toBe(false);
  });

  it("returns actionable assignee feedback for tasks:assign denials", () => {
    expect(assigneeUpdateErrorMessage(new ApiError("Missing permission: tasks:assign", 403, {}))).toContain(
      "Assign work",
    );
    expect(assigneeUpdateErrorMessage(new ApiError("Missing project permission: issue:write", 403, {}))).toContain(
      "Edit tasks",
    );
    expect(assigneeUpdateErrorMessage(new ApiError("Request failed", 500, {}))).toBe("Request failed");
    expect(assigneeUpdateErrorMessage(new Error("Network down"))).toBe("Network down");
  });

  it("parses structured missing-permission messages from the API", () => {
    expect(parsePermissionRequirementMessage("Missing permission: costs.read")).toEqual({
      scope: "company",
      key: "costs.read",
    });
    expect(parsePermissionRequirementMessage("Missing project permission: project:edit configuration")).toEqual({
      scope: "project",
      key: "project:edit configuration",
    });
    expect(parsePermissionRequirementMessage("  MISSING PERMISSION:  foo.bar  ")).toEqual({
      scope: "company",
      key: "foo.bar",
    });
    expect(parsePermissionRequirementMessage("")).toBeNull();
    expect(parsePermissionRequirementMessage(undefined)).toBeNull();
  });

  it("builds toast copy that names the missing capability in plain language", () => {
    expect(permissionDeniedToastFromServerMessage("Missing permission: billing.read")).toEqual({
      title: "Action blocked",
      body: "You need this company permission: View Billing.",
    });
    expect(permissionDeniedToastFromServerMessage("Missing project permission: issue:read")).toEqual({
      title: "Action blocked",
      body: "You need this project permission: View tasks.",
    });
    expect(
      permissionDeniedToastFromServerMessage(
        "Missing permission: company_settings.invites or users:invite",
      ).body,
    ).toBe(
      "You need one of these company permissions: Edit Company Settings: Invites or Invite human.",
    );
    expect(
      permissionDeniedToastFromServerMessage(
        "Missing permission: users:manage_permissions or project:edit Budget",
      ).body,
    ).toBe(
      "You need one of the following: Manage roles & access (company-wide) or Edit budget (on this project).",
    );
    expect(permissionDeniedToastFromServerMessage("forbidden")).toMatchObject({
      title: "Permission denied",
    });
    expect(permissionDeniedToastFromServerMessage("Custom server reason").body).toBe("Custom server reason");
  });

  it("humanizes composite and unknown segments", () => {
    expect(
      humanReadablePermissionRequirement({ scope: "company", key: "teams.title_assign or users:manage_permissions" }),
    ).toBe("You need one of these company permissions: Assign titles or Manage roles & access.");
    expect(humanReadablePermissionRequirement({ scope: "company", key: "foo.bar" })).toBe(
      "You need this company permission: Foo Bar.",
    );
  });
});
