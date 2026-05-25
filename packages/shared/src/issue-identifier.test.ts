import { describe, expect, it } from "vitest";
import { isIssueIdentifierLike } from "./issue-identifier.js";

describe("isIssueIdentifierLike", () => {
  it("accepts company-style identifiers", () => {
    expect(isIssueIdentifierLike("PAP-39")).toBe(true);
  });

  it("accepts project prefixes with numeric dedupe suffixes", () => {
    expect(isIssueIdentifierLike("PODIU3-2")).toBe(true);
  });

  it("rejects UUIDs and arbitrary strings", () => {
    expect(isIssueIdentifierLike("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
    expect(isIssueIdentifierLike("not-an-issue")).toBe(false);
    expect(isIssueIdentifierLike("")).toBe(false);
    expect(isIssueIdentifierLike(null)).toBe(false);
  });
});
