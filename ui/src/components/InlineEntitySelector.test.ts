import { describe, expect, it } from "vitest";
import { buildInlineEntityOptions } from "./InlineEntitySelector";

describe("buildInlineEntityOptions", () => {
  const options = [
    { id: "project-1", label: "Project One" },
    { id: "project-2", label: "Project Two" },
  ];

  it("includes none option when enabled", () => {
    const result = buildInlineEntityOptions(options, "No project", true);
    expect(result[0]).toEqual({ id: "", label: "No project", searchText: "No project" });
    expect(result).toHaveLength(3);
  });

  it("omits none option when disabled", () => {
    const result = buildInlineEntityOptions(options, "No project", false);
    expect(result).toEqual(options);
  });
});
