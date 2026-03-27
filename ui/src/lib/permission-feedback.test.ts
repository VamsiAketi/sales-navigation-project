// @vitest-environment node

import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { assigneeUpdateErrorMessage, isPermissionDeniedError } from "./permission-feedback";

describe("permission-denied UI helpers", () => {
  it("detects 403 responses for Teams member visibility", () => {
    expect(isPermissionDeniedError(new ApiError("Permission denied", 403, { error: "Permission denied" }))).toBe(true);
    expect(isPermissionDeniedError(new ApiError("Unauthorized", 401, { error: "Unauthorized" }))).toBe(false);
    expect(isPermissionDeniedError(new Error("boom"))).toBe(false);
  });

  it("returns actionable assignee feedback for tasks:assign denials", () => {
    expect(assigneeUpdateErrorMessage(new ApiError("Missing permission: tasks:assign", 403, {}))).toContain(
      "tasks:assign",
    );
    expect(assigneeUpdateErrorMessage(new ApiError("Request failed", 500, {}))).toBe("Request failed");
    expect(assigneeUpdateErrorMessage(new Error("Network down"))).toBe("Network down");
  });
});
