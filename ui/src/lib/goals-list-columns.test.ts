import { describe, expect, it } from "vitest";
import { normalizeGoalListColumns } from "./goals-list-columns";

describe("goals-list-columns", () => {
  it("normalizes unknown columns and preserves canonical order", () => {
    expect(normalizeGoalListColumns(["created", "wat", "name", "status", "parent"])).toEqual([
      "name",
      "status",
      "parent",
      "created",
    ]);
  });
});
