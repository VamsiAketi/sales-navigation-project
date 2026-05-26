import { describe, expect, it } from "vitest";
import {
  buildDailyDigestEmailBodies,
  buildHumanApprovalEmailBodies,
  buildHumanInviteEmailBodies,
  buildIssueNotificationEmailBodies,
  buildPasswordResetEmailBodies,
  buildSignInOtpEmailBodies,
  buildSystemAlertEmailBodies,
  humanInviteEmailSubject,
  issueCommentUrl,
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
    expect(htmlBody).toContain("Human + AI Workforce Platform");
  });

  it("omits invite optional sections when values are blank", () => {
    const { htmlBody, textBody } = buildHumanInviteEmailBodies({
      toName: "Ada Lovelace",
      temporaryUsername: "ada@example.com",
      temporaryPassword: "temp-pass-123",
      signInUrl: "https://app.example.com/auth",
    });
    expect(textBody).not.toContain("Role:");
    expect(textBody).not.toContain("Invitation expires");
    expect(htmlBody).toContain("Accept Invitation");
    expect(htmlBody).not.toContain("Invited By");
    expect(htmlBody).not.toContain("Your Role");
  });

  it("includes invite optional sections when provided", () => {
    const { htmlBody } = buildHumanInviteEmailBodies({
      toName: "Ada Lovelace",
      temporaryUsername: "ada@example.com",
      temporaryPassword: "temp-pass-123",
      signInUrl: "https://app.example.com/auth",
      inviterName: "Marcus Rivera",
      companyName: "Acme Corp",
      workspaceSlug: "acme-corp",
      membershipRole: "Member",
      projectNames: ["MVP1"],
      expiryHours: 48,
    });
    expect(htmlBody).toContain("Marcus Rivera");
    expect(htmlBody).toContain("Your Role");
    expect(htmlBody).toContain("Project: MVP1");
    expect(htmlBody).toContain("expires in 48 hours");
    expect(humanInviteEmailSubject("Acme Corp")).toContain("Acme Corp Workspace");
  });

  it("builds OTP email with monospace code block", () => {
    const { htmlBody } = buildSignInOtpEmailBodies({ otp: "482910" });
    expect(htmlBody).toContain("482910");
    expect(htmlBody).toContain("Sign-In Code");
  });

  it("builds issue status update with change table", () => {
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
      projectName: "MVP1",
      occurredAt: new Date(Date.now() - 5 * 60_000),
    });
    expect(textBody).toContain("ENG-42");
    expect(htmlBody).toContain("What Changed");
    expect(htmlBody).toContain("View Ticket");
  });

  it("builds comment mention with comment deep link when provided", () => {
    const issueUrl = "https://app.example.com/acme/issues/abc";
    const commentUrl = issueCommentUrl(issueUrl, "comment-1");
    expect(commentUrl).toBe(`${issueUrl}#comment-comment-1`);

    const { htmlBody } = buildIssueNotificationEmailBodies({
      recipientName: "Sarah",
      issueIdentifier: "ENG-42",
      issueTitle: "Fix login bug",
      eventType: "issue.comment_mentioned",
      actorType: "user",
      actorLabel: "Jordan Lee",
      commentSnippet: "Please review",
      issueUrl,
      commentUrl,
      projectName: "MVP1",
      occurredAt: new Date(),
    });
    expect(htmlBody).toContain("Reply to Comment");
    expect(htmlBody).toContain(encodeURIComponent("comment-1"));
  });

  it("builds human approval with optional action urls omitted when blank", () => {
    const { htmlBody } = buildHumanApprovalEmailBodies({
      recipientName: "Carol",
      issueIdentifier: "ENG-99",
      issueTitle: "Deploy v2",
      approvalStepName: "Manager Review",
      issueUrl: "https://app.example.com/acme/issues/xyz",
      actorLabel: "Security Reviewer Agent",
      actorType: "agent",
      projectName: "MVP1",
    });
    expect(htmlBody).toContain("Approval Required");
    expect(htmlBody).not.toContain("Decision Deadline");
    expect(htmlBody).not.toContain(">Approve</a>");
    expect(htmlBody).toContain("Review in App");
  });

  it("builds daily digest scaffold with blank stats", () => {
    const { htmlBody } = buildDailyDigestEmailBodies({
      recipientName: "Sarah Chen",
    });
    expect(htmlBody).toContain("Daily Digest");
    expect(htmlBody).not.toContain("Your Assigned Tickets");
  });

  it("builds system alert scaffold with blank error details", () => {
    const { htmlBody } = buildSystemAlertEmailBodies({
      recipientName: "Admin",
      alertTitle: "Workflow failure detected.",
    });
    expect(htmlBody).toContain("System Alert");
    expect(htmlBody).not.toContain("Error Details");
  });
});
