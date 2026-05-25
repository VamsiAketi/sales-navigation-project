import type { ProjectNotificationEventType } from "@paperclipai/shared";

const BRAND_NAME = "AI-Harness";
const BRAND_TAGLINE = "control plane for AI companies";
const FONT_STACK = "Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const COLOR = {
  pageBg: "#f4f4f5",
  cardBg: "#ffffff",
  cardBorder: "#e4e4e7",
  heading: "#18181b",
  body: "#52525b",
  muted: "#71717a",
  faint: "#a1a1aa",
  primary: "#4f46e5",
  primaryLink: "#6366f1",
  quoteBg: "#fafafa",
  quoteBorder: "#e4e4e7",
  infoLabel: "#3f3f46",
  otpBg: "#f4f4f5",
} as const;

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeHtmlAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, "&#39;");
}

type EmailLayoutInput = {
  title: string;
  bodyHtml: string;
  footerHtml?: string;
};

function wrapEmailLayout(input: EmailLayoutInput): string {
  const safeTitle = escapeHtml(input.title);
  const footer =
    input.footerHtml ??
    "If you did not expect this message, you can safely ignore it.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light dark" />
<title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.pageBg};-webkit-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:${COLOR.pageBg};margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:560px;background-color:${COLOR.cardBg};border-radius:16px;overflow:hidden;border:1px solid ${COLOR.cardBorder};box-shadow:0 1px 3px rgba(0,0,0,0.06);">
        <tr>
          <td style="padding:24px 28px 12px 28px;font-family:${FONT_STACK};">
            <p style="margin:0 0 20px 0;font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${COLOR.primary};">${escapeHtml(BRAND_NAME)}</p>
            ${input.bodyHtml}
          </td>
        </tr>
        <tr>
          <td style="padding:16px 28px 24px 28px;border-top:1px solid ${COLOR.pageBg};font-family:${FONT_STACK};font-size:12px;line-height:1.5;color:${COLOR.faint};">
            ${footer}
          </td>
        </tr>
      </table>
      <p style="margin:20px 0 0 0;font-family:${FONT_STACK};font-size:11px;color:${COLOR.faint};text-align:center;">${escapeHtml(BRAND_NAME)} &mdash; ${escapeHtml(BRAND_TAGLINE)}</p>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function emailHeading(title: string): string {
  return `<p style="margin:0 0 8px 0;font-size:20px;font-weight:600;letter-spacing:-0.02em;color:${COLOR.heading};">${escapeHtml(title)}</p>`;
}

function emailLead(text: string): string {
  return `<p style="margin:0 0 20px 0;color:${COLOR.body};font-size:14px;line-height:1.55;">${escapeHtml(text)}</p>`;
}

function emailGreeting(name: string): string {
  return `<p style="margin:0 0 16px 0;color:${COLOR.body};font-size:14px;line-height:1.55;">Hello ${escapeHtml(name)},</p>`;
}

function emailButton(href: string, label: string): string {
  const safeHref = escapeHtmlAttr(href);
  const safeLabel = escapeHtml(label);
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
  <tr>
    <td align="center" bgcolor="${COLOR.primary}" style="border-radius:9999px;background-color:${COLOR.primary};">
      <a href="${safeHref}" style="display:inline-block;padding:12px 28px;font-family:${FONT_STACK};font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:9999px;">${safeLabel}</a>
    </td>
  </tr>
</table>`;
}

function emailLinkFallback(url: string): string {
  const safeUrl = escapeHtmlAttr(url);
  return `<p style="margin:0 0 12px 0;font-size:12px;color:${COLOR.faint};line-height:1.5;">If the button does not work, copy and paste this link into your browser:</p>
<p style="margin:0;font-size:12px;word-break:break-all;color:${COLOR.primaryLink};"><a href="${safeUrl}" style="color:${COLOR.primaryLink};text-decoration:underline;">${safeUrl}</a></p>`;
}

function emailInfoRows(rows: Array<{ label: string; value: string }>): string {
  const cells = rows
    .map(
      (row) =>
        `<p style="margin:0 0 12px 0;font-size:13px;color:${COLOR.muted};"><strong style="color:${COLOR.infoLabel};">${escapeHtml(row.label)}</strong><br />${escapeHtml(row.value)}</p>`,
    )
    .join("");
  return `<div style="margin:0 0 20px 0;padding:16px;background-color:${COLOR.quoteBg};border:1px solid ${COLOR.quoteBorder};border-radius:12px;">${cells}</div>`;
}

function emailQuote(text: string): string {
  return `<blockquote style="margin:0 0 20px 0;padding:14px 16px;background-color:${COLOR.quoteBg};border-left:3px solid ${COLOR.primary};border-radius:0 8px 8px 0;font-family:${FONT_STACK};font-size:13px;line-height:1.55;color:${COLOR.body};">&ldquo;${escapeHtml(text)}&rdquo;</blockquote>`;
}

function emailIssueBadge(identifier: string, title: string): string {
  return `<p style="margin:0 0 16px 0;font-size:13px;color:${COLOR.muted};"><span style="display:inline-block;padding:2px 8px;margin-right:8px;background-color:${COLOR.otpBg};border:1px solid ${COLOR.cardBorder};border-radius:6px;font-weight:600;color:${COLOR.infoLabel};">${escapeHtml(identifier)}</span>${escapeHtml(title)}</p>`;
}

function emailStatusPill(label: string, value: string): string {
  return `<p style="margin:0 0 20px 0;font-size:13px;color:${COLOR.muted};"><strong style="color:${COLOR.infoLabel};">${escapeHtml(label)}</strong> ${escapeHtml(value)}</p>`;
}

function emailOtpCode(code: string): string {
  return `<p style="margin:0 0 20px 0;padding:16px 20px;background-color:${COLOR.otpBg};border:1px solid ${COLOR.cardBorder};border-radius:12px;font-family:Consolas,Monaco,monospace;font-size:28px;font-weight:700;letter-spacing:0.12em;text-align:center;color:${COLOR.heading};">${escapeHtml(code)}</p>`;
}

export type EmailBodies = { textBody: string; htmlBody: string };

export function buildPasswordResetEmailBodies(input: {
  resetUrl: string;
  recipientEmail: string;
}): EmailBodies {
  const textBody = [
    "Reset your AI-Harness password",
    "",
    "We received a request to reset the password for:",
    input.recipientEmail,
    "",
    "Open this link to choose a new password (it expires after a short time):",
    input.resetUrl,
    "",
    "If you did not ask for this, you can ignore this email. Your password will stay the same.",
  ].join("\r\n");

  const bodyHtml = [
    emailHeading("Reset your password"),
    emailLead("We received a request to reset your AI-Harness password. Use the button below to choose a new one."),
    emailInfoRows([{ label: "Account", value: input.recipientEmail }]),
    emailButton(input.resetUrl, "Choose a new password"),
    emailLinkFallback(input.resetUrl),
  ].join("");

  const htmlBody = wrapEmailLayout({
    title: "Reset your password",
    bodyHtml,
    footerHtml:
      "If you did not request a password reset, you can ignore this message. Your password will not be changed.",
  });

  return { textBody, htmlBody };
}

export function buildHumanInviteEmailBodies(input: {
  toName: string;
  temporaryUsername: string;
  temporaryPassword: string;
  signInUrl: string;
}): EmailBodies {
  const textBody = [
    `Hello ${input.toName},`,
    "",
    "You have been granted access to AI-Harness.",
    "",
    `Sign in: ${input.signInUrl}`,
    `Email: ${input.temporaryUsername}`,
    `Temporary password: ${input.temporaryPassword}`,
    "",
    "Please sign in and change your password.",
  ].join("\n");

  const bodyHtml = [
    emailHeading("You're invited"),
    emailGreeting(input.toName),
    emailLead("You have been granted access to AI-Harness. Sign in with the credentials below, then choose a new password."),
    emailInfoRows([
      { label: "Email", value: input.temporaryUsername },
      { label: "Temporary password", value: input.temporaryPassword },
    ]),
    emailButton(input.signInUrl, "Sign in to AI-Harness"),
    emailLinkFallback(input.signInUrl),
  ].join("");

  const htmlBody = wrapEmailLayout({
    title: "You're invited to AI-Harness",
    bodyHtml,
    footerHtml: "Please sign in and change your password on first use.",
  });

  return { textBody, htmlBody };
}

export function buildSignInOtpEmailBodies(input: { otp: string }): EmailBodies {
  const textBody = [
    "Your AI-Harness sign-in code:",
    "",
    input.otp,
    "",
    "This code expires in 10 minutes.",
    "If you did not request this code, you can ignore this email.",
  ].join("\n");

  const bodyHtml = [
    emailHeading("Your sign-in code"),
    emailLead("Use this one-time code to sign in to AI-Harness. It expires in 10 minutes."),
    emailOtpCode(input.otp),
  ].join("");

  const htmlBody = wrapEmailLayout({
    title: "Your AI-Harness sign-in code",
    bodyHtml,
    footerHtml: "If you did not request this code, you can ignore this email.",
  });

  return { textBody, htmlBody };
}

function issueNotificationSummary(input: {
  eventType: ProjectNotificationEventType;
  actorLabel?: string | null;
  actorType: "agent" | "user" | "system";
  oldStatus?: string | null;
  newStatus?: string | null;
  commentSnippet?: string | null;
  assignedUserName?: string | null;
}): { headline: string; detail: string; textDetail: string } {
  const actor = input.actorLabel?.trim() || input.actorType;

  if (input.eventType === "issue.status_changed" && input.newStatus) {
    const detail = `${actor} changed status from "${input.oldStatus ?? "unknown"}" to "${input.newStatus}".`;
    return { headline: "Status updated", detail, textDetail: detail };
  }
  if (input.eventType === "issue.comment_added") {
    const detail = `${actor} added a comment.`;
    return { headline: "New comment", detail, textDetail: detail };
  }
  if (input.eventType === "issue.comment_mentioned") {
    const detail = `${actor} mentioned you in a comment.`;
    return { headline: "You were mentioned", detail, textDetail: detail };
  }
  const assignee = input.assignedUserName?.trim() || "a user";
  const detail = `${actor} assigned this issue to ${assignee}.`;
  return { headline: "Issue assigned", detail, textDetail: detail };
}

export function buildIssueNotificationEmailBodies(input: {
  recipientName: string;
  issueIdentifier: string | null;
  issueTitle: string;
  eventType: ProjectNotificationEventType;
  actorType: "agent" | "user" | "system";
  actorLabel?: string | null;
  oldStatus?: string | null;
  newStatus?: string | null;
  commentSnippet?: string | null;
  assignedUserName?: string | null;
  issueUrl?: string | null;
}): EmailBodies {
  const issueRef = input.issueIdentifier ?? input.issueTitle;
  const summary = issueNotificationSummary(input);

  const textLines = [
    `Hello ${input.recipientName},`,
    "",
    `Update on issue ${issueRef} (${input.issueTitle}):`,
    "",
    summary.textDetail,
  ];
  if (input.commentSnippet) {
    textLines.push(`Comment: "${input.commentSnippet}"`);
  }
  if (input.issueUrl) {
    textLines.push("", `Open ticket: ${input.issueUrl}`);
  }
  textLines.push("", "This email was sent by your project notification settings.");
  const textBody = textLines.join("\n");

  const bodyParts = [
    emailHeading(summary.headline),
    emailGreeting(input.recipientName),
    emailIssueBadge(issueRef, input.issueTitle),
    emailLead(summary.detail),
  ];

  if (input.eventType === "issue.status_changed" && input.newStatus) {
    bodyParts.push(
      emailStatusPill("Status", `${input.oldStatus ?? "unknown"} → ${input.newStatus}`),
    );
  }
  if (input.commentSnippet) {
    bodyParts.push(emailQuote(input.commentSnippet));
  }
  if (input.issueUrl) {
    bodyParts.push(emailButton(input.issueUrl, "Open ticket"));
    bodyParts.push(emailLinkFallback(input.issueUrl));
  }

  const htmlBody = wrapEmailLayout({
    title: summary.headline,
    bodyHtml: bodyParts.join(""),
    footerHtml: "This email was sent by your project notification settings.",
  });

  return { textBody, htmlBody };
}

export function buildHumanApprovalEmailBodies(input: {
  recipientName: string;
  issueIdentifier: string | null;
  issueTitle: string;
  approvalStepName: string;
  issueUrl?: string | null;
}): EmailBodies {
  const issueRef = input.issueIdentifier ?? input.issueTitle;

  const textBody = [
    `Hello ${input.recipientName},`,
    "",
    `Human approval is required for issue ${issueRef} (${input.issueTitle}).`,
    "",
    `The issue has entered the "${input.approvalStepName}" step and is awaiting your review.`,
    "",
    "Please log in to review and take action.",
    input.issueUrl ? `\nOpen ticket: ${input.issueUrl}` : "",
    "",
    "This email was sent by your project notification settings.",
  ]
    .filter((line, index, arr) => !(line === "" && arr[index - 1] === ""))
    .join("\n");

  const bodyParts = [
    emailHeading("Approval required"),
    emailGreeting(input.recipientName),
    emailIssueBadge(issueRef, input.issueTitle),
    emailLead(
      `This issue has entered the "${input.approvalStepName}" step and is awaiting your review.`,
    ),
    emailStatusPill("Step", input.approvalStepName),
  ];
  if (input.issueUrl) {
    bodyParts.push(emailButton(input.issueUrl, "Review and approve"));
    bodyParts.push(emailLinkFallback(input.issueUrl));
  }

  const htmlBody = wrapEmailLayout({
    title: "Human approval required",
    bodyHtml: bodyParts.join(""),
    footerHtml: "This email was sent by your project notification settings.",
  });

  return { textBody, htmlBody };
}
