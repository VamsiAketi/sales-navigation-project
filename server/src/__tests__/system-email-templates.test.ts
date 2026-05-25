import { describe, expect, it } from "vitest";
import {
  buildHumanApprovalEmailBodies,
  buildHumanInviteEmailBodies,
  buildIssueNotificationEmailBodies,
  buildPasswordResetEmailBodies,
  buildSignInOtpEmailBodies,
} from "../services/system-email-templates.js";

describe("system email templates", () => {
  it("escapes HTML in password reset bodies", () => {
    const { htmlBody, textBody } = buildPasswordResetEmailBodies({
      resetUrl: "https://example.com/reset?token=<script>",
      recipientEmail: "user@example.com",
    });
    expect(textBody).toContain("user@example.com");
    expect(htmlBody).toContain("&lt;script&gt;");
    expect(htmlBody).not.toContain("<script>");
    expect(htmlBody).toContain("Choose a new password");
    expect(htmlBody).toContain("AI-Harness");
  });

  it("builds human invite with credentials and CTA", () => {
    const { htmlBody, textBody } = buildHumanInviteEmailBodies({
      toName: "Ada Lovelace",
      temporaryUsername: "ada@example.com",
      temporaryPassword: "temp-pass-123",
      signInUrl: "https://app.example.com/auth",
    });
    expect(textBody).toContain("ada@example.com");
    expect(textBody).toContain("temp-pass-123");
    expect(htmlBody).toContain("You're invited");
    expect(htmlBody).toContain("Sign in to AI-Harness");
  });

  it("builds OTP email with monospace code block", () => {
    const { htmlBody } = buildSignInOtpEmailBodies({ otp: "482910" });
    expect(htmlBody).toContain("482910");
    expect(htmlBody).toContain("Your sign-in code");
  });

  it("builds issue notification with quote and status", () => {
    const { htmlBody, textBody } = buildIssueNotificationEmailBodies({
      recipientName: "Bob",
      issueIdentifier: "ENG-42",
      issueTitle: "Fix login bug",
      eventType: "issue.status_changed",
      actorType: "agent",
      actorLabel: "Engineer Bot",
      oldStatus: "in_progress",
      newStatus: "review",
      issueUrl: "https://app.example.com/acme/issues/abc",
    });
    expect(textBody).toContain("ENG-42");
    expect(textBody).toContain("in_progress");
    expect(htmlBody).toContain("Status updated");
    expect(htmlBody).toContain("ENG-42");
    expect(htmlBody).toContain("Open ticket");
  });

  it("builds human approval email", () => {
    const { htmlBody } = buildHumanApprovalEmailBodies({
      recipientName: "Carol",
      issueIdentifier: "ENG-99",
      issueTitle: "Deploy v2",
      approvalStepName: "Manager Review",
      issueUrl: "https://app.example.com/acme/issues/xyz",
    });
    expect(htmlBody).toContain("Approval required");
    expect(htmlBody).toContain("Manager Review");
    expect(htmlBody).toContain("Review and approve");
  });
});
