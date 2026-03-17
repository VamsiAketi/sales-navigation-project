import { afterEach, describe, expect, it } from "vitest";
import { sendHumanInviteEmail } from "../services/human-invite-email.js";

const SMTP_ENV_KEYS = [
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_FROM",
] as const;

function clearSmtpEnv() {
  for (const key of SMTP_ENV_KEYS) {
    delete process.env[key];
  }
}

describe("sendHumanInviteEmail", () => {
  afterEach(() => {
    clearSmtpEnv();
  });

  it("returns skipped when SMTP is not configured", async () => {
    clearSmtpEnv();

    const result = await sendHumanInviteEmail({
      toEmail: "new.user@example.com",
      toName: "New User",
      temporaryUsername: "new.user@example.com",
      temporaryPassword: "temporary-pass",
      signInUrl: "http://localhost:3100/auth",
    });

    expect(result.status).toBe("skipped");
    expect(result.message).toContain("SMTP is not configured");
  });

  it("returns failed with actionable config errors for partial SMTP config", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_PORT = "587";

    const result = await sendHumanInviteEmail({
      toEmail: "new.user@example.com",
      toName: "New User",
      temporaryUsername: "new.user@example.com",
      temporaryPassword: "temporary-pass",
      signInUrl: "http://localhost:3100/auth",
    });

    expect(result.status).toBe("failed");
    expect(result.message).toContain("SMTP_FROM is required");
  });
});
