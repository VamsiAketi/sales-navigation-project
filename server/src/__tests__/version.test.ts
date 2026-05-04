import { afterEach, describe, expect, it, vi } from "vitest";

describe("serverVersion", () => {
  const originalImageTag = process.env.IMAGE_TAG;

  afterEach(() => {
    if (typeof originalImageTag === "undefined") {
      delete process.env.IMAGE_TAG;
    } else {
      process.env.IMAGE_TAG = originalImageTag;
    }
    vi.resetModules();
  });

  it("prefers IMAGE_TAG when provided", async () => {
    process.env.IMAGE_TAG = "2026.03.30.7";
    const { serverVersion } = await import("../version.js");
    expect(serverVersion).toBe("2026.03.30.7");
  });

  it("ignores blank IMAGE_TAG and falls back to package version", async () => {
    process.env.IMAGE_TAG = "   ";
    const { serverVersion } = await import("../version.js");
    expect(serverVersion).toBeTruthy();
    expect(serverVersion).not.toBe("   ");
  });
});
