import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendHumanInviteEmail } from "../services/human-invite-email.js";

const MS_GRAPH_ENV_KEYS = [
  "MS_TENANT_ID",
  "MS_CLIENT_ID",
  "MS_CLIENT_SECRET",
  "MS_SENDER_EMAIL",
  "MS_SENDER_OBJECT_ID",
  "MS_GRAPH_DEBUG",
] as const;

function clearGraphMailEnv() {
  for (const key of MS_GRAPH_ENV_KEYS) {
    delete process.env[key];
  }
}

describe("sendHumanInviteEmail", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    clearGraphMailEnv();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  });

  afterEach(() => {
    clearGraphMailEnv();
    vi.unstubAllGlobals();
  });

  it("returns skipped when Microsoft Graph mail is not configured", async () => {
    const result = await sendHumanInviteEmail({
      toEmail: "new.user@example.com",
      toName: "New User",
      temporaryUsername: "new.user@example.com",
      temporaryPassword: "temporary-pass",
      signInUrl: "http://localhost:3100/auth",
    });

    expect(result.status).toBe("skipped");
    expect(result.message).toContain("Microsoft Graph mail is not configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns failed when Graph env is only partially set", async () => {
    process.env.MS_TENANT_ID = "11111111-1111-1111-1111-111111111111";
    process.env.MS_CLIENT_ID = "22222222-2222-2222-2222-222222222222";

    const result = await sendHumanInviteEmail({
      toEmail: "new.user@example.com",
      toName: "New User",
      temporaryUsername: "new.user@example.com",
      temporaryPassword: "temporary-pass",
      signInUrl: "http://localhost:3100/auth",
    });

    expect(result.status).toBe("failed");
    expect(result.message).toContain("partially configured");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns sent after token + sendMail succeed", async () => {
    process.env.MS_TENANT_ID = "11111111-1111-1111-1111-111111111111";
    process.env.MS_CLIENT_ID = "22222222-2222-2222-2222-222222222222";
    process.env.MS_CLIENT_SECRET = "secret-value";
    process.env.MS_SENDER_EMAIL = "sender@example.com";

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "tok.test" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => "{}",
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        headers: new Headers(),
        text: async () => "",
      } as Response);

    const result = await sendHumanInviteEmail({
      toEmail: "new.user@example.com",
      toName: "New User",
      temporaryUsername: "new.user@example.com",
      temporaryPassword: "temporary-pass",
      signInUrl: "http://localhost:3100/auth",
    });

    expect(result.status).toBe("sent");
    expect(result.message).toContain("Invite email sent");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const tokenUrl = fetchMock.mock.calls[0]?.[0] as string;
    expect(tokenUrl).toContain("login.microsoftonline.com");
    expect(tokenUrl).toContain("/oauth2/v2.0/token");
    const lookupUrl = fetchMock.mock.calls[1]?.[0] as string;
    expect(lookupUrl).toContain("graph.microsoft.com");
    expect(lookupUrl).toContain("/users/");
    const sendUrl = fetchMock.mock.calls[2]?.[0] as string;
    expect(sendUrl).toContain("graph.microsoft.com");
    expect(sendUrl).toContain("/users/");
    expect(sendUrl).toContain("/sendMail");
  });

  it("skips sender lookup when MS_SENDER_OBJECT_ID is set", async () => {
    process.env.MS_TENANT_ID = "11111111-1111-1111-1111-111111111111";
    process.env.MS_CLIENT_ID = "22222222-2222-2222-2222-222222222222";
    process.env.MS_CLIENT_SECRET = "secret-value";
    process.env.MS_SENDER_EMAIL = "sender@example.com";
    process.env.MS_SENDER_OBJECT_ID = "33333333-3333-3333-3333-333333333333";

    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ access_token: "tok.test" }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        headers: new Headers(),
        text: async () => "",
      } as Response);

    const result = await sendHumanInviteEmail({
      toEmail: "new.user@example.com",
      toName: "New User",
      temporaryUsername: "new.user@example.com",
      temporaryPassword: "temporary-pass",
      signInUrl: "http://localhost:3100/auth",
    });

    expect(result.status).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sendUrl = fetchMock.mock.calls[1]?.[0] as string;
    expect(sendUrl).toContain("/users/33333333-3333-3333-3333-333333333333/sendMail");
  });
});
