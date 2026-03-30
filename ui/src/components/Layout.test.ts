import { describe, expect, it } from "vitest";
import { buildVisibleVersionLabel } from "./Layout";

describe("buildVisibleVersionLabel", () => {
  it("returns a readable label when version is present", () => {
    expect(buildVisibleVersionLabel("2026.03.30")).toBe("Version 2026.03.30");
  });

  it("trims incoming version text", () => {
    expect(buildVisibleVersionLabel(" 1.2.3 ")).toBe("Version 1.2.3");
  });

  it("returns null when version is missing", () => {
    expect(buildVisibleVersionLabel(undefined)).toBeNull();
    expect(buildVisibleVersionLabel(null)).toBeNull();
  });

  it("returns null when version is blank", () => {
    expect(buildVisibleVersionLabel("   ")).toBeNull();
  });
});
