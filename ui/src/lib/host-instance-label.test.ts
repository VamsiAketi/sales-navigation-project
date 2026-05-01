import { describe, expect, it } from "vitest";
import { getInstanceSlugFromAppHostname } from "./host-instance-label";

describe("getInstanceSlugFromAppHostname", () => {
  it("extracts slug from app.ai-harness.com subdomains", () => {
    expect(getInstanceSlugFromAppHostname("dev-test.app.ai-harness.com")).toBe("dev-test");
    expect(getInstanceSlugFromAppHostname("DEV-TEST.APP.AI-HARNESS.COM")).toBe("dev-test");
  });

  it("returns null for apex, www, localhost, and unrelated hosts", () => {
    expect(getInstanceSlugFromAppHostname("app.ai-harness.com")).toBeNull();
    expect(getInstanceSlugFromAppHostname("www.app.ai-harness.com")).toBeNull();
    expect(getInstanceSlugFromAppHostname("localhost")).toBeNull();
    expect(getInstanceSlugFromAppHostname("example.com")).toBeNull();
  });
});
