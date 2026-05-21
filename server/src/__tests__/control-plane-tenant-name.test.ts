import { afterEach, describe, expect, it } from "vitest";
import { resolveControlPlaneTenantName } from "../control-plane-tenant-name.js";

describe("resolveControlPlaneTenantName", () => {
  const originalInstanceId = process.env.PAPERCLIP_INSTANCE_ID;
  const originalPublicUrl = process.env.PAPERCLIP_PUBLIC_URL;

  afterEach(() => {
    if (originalInstanceId === undefined) delete process.env.PAPERCLIP_INSTANCE_ID;
    else process.env.PAPERCLIP_INSTANCE_ID = originalInstanceId;
    if (originalPublicUrl === undefined) delete process.env.PAPERCLIP_PUBLIC_URL;
    else process.env.PAPERCLIP_PUBLIC_URL = originalPublicUrl;
  });

  it("prefers PAPERCLIP_INSTANCE_ID when set", () => {
    process.env.PAPERCLIP_INSTANCE_ID = "acme";
    process.env.PAPERCLIP_PUBLIC_URL = "https://dev-test.app.ai-harness.com";
    expect(resolveControlPlaneTenantName()).toBe("acme");
  });

  it("falls back to public URL subdomain when instance id is missing", () => {
    delete process.env.PAPERCLIP_INSTANCE_ID;
    process.env.PAPERCLIP_PUBLIC_URL = "https://dev-test.app.ai-harness.com";
    expect(resolveControlPlaneTenantName()).toBe("dev-test");
  });

  it("extracts instance id from public URL with trailing slash", () => {
    delete process.env.PAPERCLIP_INSTANCE_ID;
    process.env.PAPERCLIP_PUBLIC_URL = "https://acme.app.ai-harness.com/";
    expect(resolveControlPlaneTenantName()).toBe("acme");
  });

  it("returns default when public URL does not match tenant host pattern", () => {
    delete process.env.PAPERCLIP_INSTANCE_ID;
    process.env.PAPERCLIP_PUBLIC_URL = "http://localhost:3100";
    expect(resolveControlPlaneTenantName()).toBe("default");
  });

  it("returns default when neither source is available", () => {
    delete process.env.PAPERCLIP_INSTANCE_ID;
    delete process.env.PAPERCLIP_PUBLIC_URL;
    expect(resolveControlPlaneTenantName()).toBe("default");
  });
});
