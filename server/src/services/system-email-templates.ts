import type { ProjectNotificationEventType } from "@paperclipai/shared";
import { readEmailFooterLinks, type EmailFooterLinks } from "./email-footer-config.js";

const BRAND_NAME = "AI-Harness";
const BRAND_TAGLINE = "Human + AI Workforce Platform";
const FONT_SANS = "Sora, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const FONT_MONO = "'IBM Plex Mono', Consolas, Monaco, monospace";
const PURPLE = "#7c3aed";
const PURPLE_LIGHT = "#c4b5fd";
const HEADER_BG = "#0d0b1a";
const HERO_BG = "linear-gradient(135deg, #0f0b22 0%, #1a0f3a 50%, #110d26 100%)";
const HERO_APPROVAL_BG = "linear-gradient(135deg, #141007 0%, #221600 50%, #1a1103 100%)";
const HERO_ALERT_BG = "linear-gradient(135deg, #1a0a0a 0%, #220e0e 100%)";
const FOOTER_COPY = "© 2026 AI-Harness, Inc.";

const LOGO_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" fill="none" stroke="#ffffff" stroke-width="2"/></svg>';

export type EmailTicketChange = {
  field: string;
  before: string;
  after: string;
};

export type EmailBodies = { textBody: string; htmlBody: string };

export function escapeHtml(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeHtmlAttr(text: string | null | undefined): string {
  return escapeHtml(text).replace(/'/g, "&#39;");
}

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function formatEmailDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatRelativeTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const deltaMs = Date.now() - date.getTime();
  if (deltaMs < 0) return null;
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function truncateText(text: string | null | undefined, maxLength: number): string {
  if (!text) return "";
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trim()}…`;
}

type HeroVariant = "default" | "approval" | "alert";

type LayoutInput = {
  pageTitle: string;
  heroEyebrow: string;
  heroTitle: string;
  heroSubHtml: string;
  bodyHtml: string;
  footerNote: string;
  heroVariant?: HeroVariant;
  footerLinks?: EmailFooterLinks;
};

function footerLink(label: string, url: string | null): string {
  if (!url) return "";
  return `<a href="${escapeHtmlAttr(url)}" style="font-size:11px;color:#4a4a6a;text-decoration:none;margin-right:16px;">${escapeHtml(label)}</a>`;
}

function emailFooter(footerNote: string, links: EmailFooterLinks): string {
  const linkRow = [
    footerLink("Unsubscribe", links.unsubscribeUrl),
    footerLink("Privacy Policy", links.privacyUrl),
    footerLink("Help Center", links.helpCenterUrl),
    footerLink("Notification Settings", links.notificationSettingsUrl),
    footerLink("Audit Log", links.auditLogUrl),
    footerLink("Governance Settings", links.governanceSettingsUrl),
    footerLink("Runbook", links.runbookUrl),
    footerLink("Alert Settings", links.alertSettingsUrl),
    footerLink("Digest Settings", links.digestSettingsUrl),
  ]
    .filter(Boolean)
    .join("");

  const addressLine = links.physicalAddress
    ? `<br />${escapeHtml(links.physicalAddress)}`
    : "";

  return `<tr>
  <td style="background-color:${HEADER_BG};padding:24px 40px;border-top:1px solid rgba(255,255,255,0.05);font-family:${FONT_SANS};">
    ${linkRow ? `<div style="margin-bottom:12px;">${linkRow}</div>` : ""}
    <div style="font-size:11px;color:#3a3a5a;line-height:1.6;">${escapeHtml(FOOTER_COPY)}${addressLine}<br />${escapeHtml(footerNote)}</div>
  </td>
</tr>`;
}

function emailHeader(): string {
  return `<tr>
  <td style="background-color:${HEADER_BG};padding:28px 40px;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
      <tr>
        <td width="36" valign="middle" style="width:36px;">
          <div style="width:36px;height:36px;background-color:${PURPLE};border-radius:8px;text-align:center;line-height:36px;">${LOGO_SVG}</div>
        </td>
        <td valign="middle" style="padding-left:12px;font-family:${FONT_SANS};">
          <div style="font-size:15px;font-weight:600;color:#f0eeff;letter-spacing:-0.02em;">${escapeHtml(BRAND_NAME)}</div>
          <div style="font-size:9px;font-family:${FONT_MONO};color:#6d6d8a;letter-spacing:0.08em;text-transform:uppercase;margin-top:1px;">${escapeHtml(BRAND_TAGLINE)}</div>
        </td>
      </tr>
    </table>
  </td>
</tr>`;
}

function emailHero(input: Pick<LayoutInput, "heroEyebrow" | "heroTitle" | "heroSubHtml" | "heroVariant">): string {
  const variant = input.heroVariant ?? "default";
  const isApproval = variant === "approval";
  const isAlert = variant === "alert";
  const eyebrowColor = isAlert ? "#fca5a5" : isApproval ? "#fbbf24" : "#a78bfa";
  const eyebrowBg = isAlert
    ? "rgba(239,68,68,0.1)"
    : isApproval
      ? "rgba(245,158,11,0.1)"
      : "rgba(124,58,237,0.12)";
  const eyebrowBorder = isAlert
    ? "rgba(239,68,68,0.25)"
    : isApproval
      ? "rgba(245,158,11,0.25)"
      : "rgba(124,58,237,0.25)";
  const dotColor = isAlert ? "#ef4444" : isApproval ? "#f59e0b" : PURPLE;
  const heroBg = isAlert ? HERO_ALERT_BG : isApproval ? HERO_APPROVAL_BG : HERO_BG;
  const heroBorder = isAlert
    ? "rgba(239,68,68,0.2)"
    : isApproval
      ? "rgba(245,158,11,0.2)"
      : "rgba(124,58,237,0.2)";

  return `<tr>
  <td style="background:${heroBg};padding:40px 40px 36px;border-bottom:1px solid ${heroBorder};font-family:${FONT_SANS};">
    <div style="display:inline-block;font-size:10px;font-family:${FONT_MONO};color:${eyebrowColor};letter-spacing:0.1em;text-transform:uppercase;background:${eyebrowBg};border:1px solid ${eyebrowBorder};padding:4px 10px;border-radius:20px;margin-bottom:16px;">
      <span style="display:inline-block;width:6px;height:6px;background:${dotColor};border-radius:50%;margin-right:6px;vertical-align:middle;"></span>${escapeHtml(input.heroEyebrow)}
    </div>
    <div style="font-size:22px;font-weight:600;color:${isAlert ? "#fef2f2" : "#f0eeff"};letter-spacing:-0.03em;line-height:1.3;margin-bottom:10px;">${escapeHtml(input.heroTitle)}</div>
    <div style="font-size:14px;color:${isAlert ? "#6b4545" : "#7a7a94"};line-height:1.6;max-width:420px;">${input.heroSubHtml}</div>
  </td>
</tr>`;
}

function wrapAiHarnessEmail(input: LayoutInput): string {
  const footerLinks = input.footerLinks ?? readEmailFooterLinks();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light dark" />
<title>${escapeHtml(input.pageTitle)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8f7ff;-webkit-text-size-adjust:100%;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8f7ff;margin:0;padding:0;">
  <tr>
    <td align="center" style="padding:24px 16px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);">
        ${emailHeader()}
        ${emailHero(input)}
        <tr>
          <td style="background-color:#ffffff;padding:32px 40px;font-family:${FONT_SANS};">
            ${input.bodyHtml}
          </td>
        </tr>
        ${emailFooter(input.footerNote, footerLinks)}
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

function heroAccent(text: string): string {
  return `<strong style="color:${PURPLE_LIGHT};">${escapeHtml(text)}</strong>`;
}

function bodyText(text: string): string {
  return `<p style="margin:0 0 16px 0;font-size:14px;color:#4a4a6a;line-height:1.75;">${escapeHtml(text)}</p>`;
}

function bodyLabel(label: string): string {
  return `<div style="font-size:10px;font-family:${FONT_MONO};color:#9999b3;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">${escapeHtml(label)}</div>`;
}

function optionalValueBlock(label: string, value: string | null | undefined): string {
  const safe = nonEmpty(value);
  if (!safe) return "";
  return `${bodyLabel(label)}<div style="font-size:15px;color:#1a1a2e;font-weight:500;margin-bottom:16px;">${escapeHtml(safe)}</div>`;
}

function primaryButton(href: string | null | undefined, label: string, color: string = PURPLE): string {
  const safeHref = nonEmpty(href);
  if (!safeHref) return "";
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 8px 0;">
  <tr>
    <td align="left" bgcolor="${color}" style="border-radius:8px;background-color:${color};">
      <a href="${escapeHtmlAttr(safeHref)}" style="display:inline-block;padding:13px 28px;font-family:${FONT_SANS};font-size:14px;font-weight:600;color:#ffffff !important;text-decoration:none;letter-spacing:-0.01em;">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

function ghostButton(href: string | null | undefined, label: string, color: string = PURPLE): string {
  const safeHref = nonEmpty(href);
  if (!safeHref) return "";
  return `<a href="${escapeHtmlAttr(safeHref)}" style="display:inline-block;background:transparent;color:${color} !important;font-size:14px;font-weight:500;font-family:${FONT_SANS};padding:11px 24px;border-radius:8px;text-decoration:none;border:1.5px solid ${color};margin-left:10px;">${escapeHtml(label)}</a>`;
}

function linkFallback(url: string | null | undefined): string {
  const safe = nonEmpty(url);
  if (!safe) return "";
  return `<p style="margin:12px 0 0 0;font-size:12px;color:#9090ae;line-height:1.5;">If the button does not work, copy and paste this link into your browser:</p>
<p style="margin:4px 0 0 0;font-size:12px;word-break:break-all;"><a href="${escapeHtmlAttr(safe)}" style="color:${PURPLE};text-decoration:underline;">${escapeHtml(safe)}</a></p>`;
}

function credBox(rows: Array<{ label: string; value: string | null | undefined }>): string {
  const populated = rows
    .map((row) => ({ label: row.label, value: nonEmpty(row.value) }))
    .filter((row): row is { label: string; value: string } => Boolean(row.value));
  if (populated.length === 0) return "";

  const rowHtml = populated
    .map(
      (row) => `<tr>
        <td style="padding:0 0 12px 0;font-size:12px;color:#7878a0;font-family:${FONT_MONO};">${escapeHtml(row.label)}</td>
        <td align="right" style="padding:0 0 12px 0;font-size:13px;font-family:${FONT_MONO};color:#3d1fa8;font-weight:500;background:rgba(124,58,237,0.08);padding:3px 8px;border-radius:4px;">${escapeHtml(row.value)}</td>
      </tr>`,
    )
    .join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f7f5ff;border:1px solid #e5e0fd;border-radius:8px;padding:20px 24px;margin:20px 0;">
  <tr><td colspan="2" style="font-size:11px;font-family:${FONT_MONO};color:${PURPLE};letter-spacing:0.08em;text-transform:uppercase;padding-bottom:14px;">Login Credentials</td></tr>
  ${rowHtml}
</table>`;
}

function projectChipList(projectNames: string[] | null | undefined): string {
  const names = (projectNames ?? []).map((name) => nonEmpty(name)).filter(Boolean) as string[];
  if (names.length === 0) return "";
  return names
    .map(
      (name) =>
        `<span style="display:inline-block;font-size:11px;font-family:${FONT_MONO};padding:3px 8px;border-radius:4px;background:rgba(124,58,237,0.1);color:#6d28d9;margin-right:8px;margin-top:8px;">Project: ${escapeHtml(name)}</span>`,
    )
    .join("");
}

function ticketCard(input: {
  issueIdentifier: string;
  issueTitle: string;
  projectName?: string | null;
  departmentPath?: string | null;
  chips?: string[];
}): string {
  const pathParts = [nonEmpty(input.projectName), nonEmpty(input.departmentPath)].filter(Boolean) as string[];
  const pathSuffix = pathParts.length > 0 ? ` · ${pathParts.join(" / ")}` : "";
  const meta = `${escapeHtml(input.issueIdentifier)}${pathSuffix}`;
  const chips =
    input.chips
      ?.map(
        (chip) =>
          `<span style="display:inline-block;font-size:11px;font-family:${FONT_MONO};padding:3px 8px;border-radius:4px;background:rgba(124,58,237,0.1);color:#6d28d9;margin-right:8px;margin-top:8px;">${escapeHtml(chip)}</span>`,
      )
      .join("") ?? "";

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#faf9ff;border:1px solid #ece8fd;border-left:3px solid ${PURPLE};border-radius:8px;padding:16px 20px;margin:16px 0;">
  <tr><td style="font-size:11px;font-family:${FONT_MONO};color:${PURPLE};letter-spacing:0.06em;padding-bottom:6px;">${meta}</td></tr>
  <tr><td style="font-size:15px;font-weight:600;color:#1a1a2e;padding-bottom:10px;letter-spacing:-0.01em;">${escapeHtml(input.issueTitle)}</td></tr>
  ${chips ? `<tr><td>${chips}</td></tr>` : ""}
</table>`;
}

function changeTable(rows: EmailTicketChange[]): string {
  const populated = rows.filter((row) => nonEmpty(row.field) && (nonEmpty(row.before) || nonEmpty(row.after)));
  if (populated.length === 0) return "";

  const body = populated
    .map(
      (row) => `<tr>
        <td style="padding:10px 12px;border-bottom:1px solid #f5f3ff;color:${PURPLE};font-weight:500;font-size:12px;font-family:${FONT_MONO};">${escapeHtml(row.field)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f5f3ff;color:#3a3a58;vertical-align:top;">${escapeHtml(row.before)}</td>
        <td style="padding:10px 12px;border-bottom:1px solid #f5f3ff;color:#6d28d9;font-weight:500;vertical-align:top;">${escapeHtml(row.after)}</td>
      </tr>`,
    )
    .join("");

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;font-size:13px;margin:8px 0;">
  <tr>
    <th align="left" style="font-size:10px;font-family:${FONT_MONO};color:#9090ae;letter-spacing:0.08em;text-transform:uppercase;padding:6px 12px;background-color:#faf9ff;border-bottom:1px solid #ece8fd;">Field</th>
    <th align="left" style="font-size:10px;font-family:${FONT_MONO};color:#9090ae;letter-spacing:0.08em;text-transform:uppercase;padding:6px 12px;background-color:#faf9ff;border-bottom:1px solid #ece8fd;">Before</th>
    <th align="left" style="font-size:10px;font-family:${FONT_MONO};color:#9090ae;letter-spacing:0.08em;text-transform:uppercase;padding:6px 12px;background-color:#faf9ff;border-bottom:1px solid #ece8fd;">After</th>
  </tr>
  ${body}
</table>`;
}

function commentBlock(actorName: string, comment: string, relativeTime?: string | null): string {
  const initials = initialsFromName(actorName);
  const timeSuffix = nonEmpty(relativeTime)
    ? `<span style="font-size:11px;color:#9090ae;margin-left:6px;">· ${escapeHtml(relativeTime)}</span>`
    : "";

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:20px 0;">
  <tr>
    <td width="32" valign="top" style="padding-right:10px;">
      <div style="width:32px;height:32px;border-radius:50%;background-color:#3b82f6;color:#ffffff;font-size:11px;font-weight:600;text-align:center;line-height:32px;">${escapeHtml(initials)}</div>
    </td>
    <td valign="top">
      <div style="font-size:13px;color:#1a1a2e;font-weight:600;margin-bottom:6px;">${escapeHtml(actorName)}${timeSuffix}</div>
      <div style="background-color:#f7f5ff;border:1px solid #ece8fd;border-radius:0 8px 8px 8px;padding:14px 16px;font-size:14px;color:#2d2d4a;line-height:1.65;">&ldquo;${escapeHtml(comment)}&rdquo;</div>
    </td>
  </tr>
</table>`;
}

function personRow(name: string, subtitle: string | null | undefined, color: string = PURPLE): string {
  const safeName = nonEmpty(name);
  if (!safeName) return "";
  const initials = initialsFromName(safeName);
  const subtitleHtml = nonEmpty(subtitle)
    ? `<div style="font-size:12px;color:#9090ae;">${escapeHtml(subtitle)}</div>`
    : "";

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:16px;">
  <tr>
    <td width="32" valign="middle" style="padding-right:10px;">
      <div style="width:32px;height:32px;border-radius:50%;background-color:${color};color:#ffffff;font-size:11px;font-weight:600;text-align:center;line-height:32px;">${escapeHtml(initials)}</div>
    </td>
    <td valign="middle">
      <div style="font-size:14px;color:#1a1a2e;font-weight:500;">${escapeHtml(safeName)}</div>
      ${subtitleHtml}
    </td>
  </tr>
</table>`;
}

function priorityChip(priority: string | null | undefined): string | null {
  const safe = nonEmpty(priority);
  if (!safe) return null;
  const normalized = safe.toLowerCase();
  if (normalized === "critical") return "Critical Priority";
  if (normalized === "high") return "High Priority";
  if (normalized === "low") return "Low Priority";
  return "Medium Priority";
}

function statusChip(status: string | null | undefined): string | null {
  const safe = nonEmpty(status);
  if (!safe) return null;
  return safe.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function divider(): string {
  return `<div style="height:1px;background-color:#f0eefd;margin:24px 0;"></div>`;
}

function expiryNotice(expiryHours: number | null | undefined): string {
  if (expiryHours == null || !Number.isFinite(expiryHours) || expiryHours <= 0) return "";
  return `<p style="margin:0;font-size:12px;color:#9090ae;line-height:1.6;">This invitation expires in ${Math.round(expiryHours)} hours. If you didn't expect this, you can safely ignore this email.</p>`;
}

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
    bodyText("We received a request to reset your AI-Harness password. Use the button below to choose a new one."),
    credBox([{ label: "Account", value: input.recipientEmail }]),
    primaryButton(input.resetUrl, "Choose a new password"),
    linkFallback(input.resetUrl),
  ].join("");

  return {
    textBody,
    htmlBody: wrapAiHarnessEmail({
      pageTitle: "Reset your password",
      heroEyebrow: "Password Reset",
      heroTitle: "Reset your password",
      heroSubHtml: `Choose a new password for ${heroAccent(input.recipientEmail)}.`,
      bodyHtml,
      footerNote: "If you did not request a password reset, you can ignore this message. Your password will not be changed.",
    }),
  };
}

export function buildHumanInviteEmailBodies(input: {
  toName: string;
  temporaryUsername: string;
  temporaryPassword: string;
  signInUrl: string;
  inviterName?: string | null;
  companyName?: string | null;
  workspaceSlug?: string | null;
  membershipRole?: string | null;
  projectNames?: string[] | null;
  expiryHours?: number | null;
}): EmailBodies {
  const inviter = nonEmpty(input.inviterName);
  const company = nonEmpty(input.companyName);
  const role = nonEmpty(input.membershipRole);
  const slug = nonEmpty(input.workspaceSlug);
  const projectChipHtml = projectChipList(input.projectNames ?? undefined);

  const textBody = [
    `Hello ${input.toName},`,
    "",
    inviter && company
      ? `${inviter} has added you to the ${company} workspace on AI-Harness.`
      : company
        ? `You have been added to the ${company} workspace on AI-Harness.`
        : "You have been invited to AI-Harness.",
    "",
    `Sign in: ${input.signInUrl}`,
    `Email: ${input.temporaryUsername}`,
    `Temporary password: ${input.temporaryPassword}`,
    slug ? `Workspace: ${slug}` : "",
    role ? `Role: ${role}` : "",
    input.expiryHours ? `Invitation expires in ${input.expiryHours} hours.` : "",
    "",
    "Please sign in and change your password on first login.",
  ]
    .filter(Boolean)
    .join("\n");

  const bodyParts = [
    bodyText("Your account has been created with temporary credentials below. You'll be prompted to set a new password on first login."),
    credBox([
      { label: "Email", value: input.temporaryUsername },
      { label: "Temp password", value: input.temporaryPassword },
      { label: "Workspace", value: slug },
    ]),
    primaryButton(input.signInUrl, "Accept Invitation"),
  ];

  if (inviter) {
    bodyParts.push(divider(), bodyLabel("Invited By"), personRow(inviter, company ? `Workspace Admin · ${company}` : null));
  }

  if (role || projectChipHtml) {
    bodyParts.push(bodyLabel("Your Role"));
    if (role) {
      bodyParts.push(`<div style="font-size:15px;color:#1a1a2e;font-weight:500;margin-bottom:8px;">${escapeHtml(role)}</div>`);
    }
    if (projectChipHtml) bodyParts.push(projectChipHtml);
  }

  bodyParts.push(expiryNotice(input.expiryHours));

  const heroSub = inviter && company
    ? `${escapeHtml(inviter)} has added you to the ${heroAccent(company)} workspace on AI-Harness.`
    : company
      ? `You have been added to the ${heroAccent(company)} workspace on AI-Harness.`
      : "You have been invited to AI-Harness.";

  return {
    textBody,
    htmlBody: wrapAiHarnessEmail({
      pageTitle: "You're invited to AI-Harness",
      heroEyebrow: "New Workspace Invitation",
      heroTitle: `Welcome to the team, ${input.toName.split(" ")[0] ?? input.toName}.`,
      heroSubHtml: `${heroSub} You're ready to collaborate alongside humans and AI agents.`,
      bodyHtml: bodyParts.join(""),
      footerNote: "This is a transactional email sent because you were invited to a workspace.",
    }),
  };
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
    bodyText("Use this one-time code to sign in to AI-Harness. It expires in 10 minutes."),
    `<div style="margin:0 0 20px 0;padding:16px 20px;background-color:#f4f4f5;border:1px solid #e4e4e7;border-radius:12px;font-family:${FONT_MONO};font-size:28px;font-weight:700;letter-spacing:0.12em;text-align:center;color:#18181b;">${escapeHtml(input.otp)}</div>`,
  ].join("");

  return {
    textBody,
    htmlBody: wrapAiHarnessEmail({
      pageTitle: "Your AI-Harness sign-in code",
      heroEyebrow: "Sign-In Code",
      heroTitle: "Your sign-in code",
      heroSubHtml: "Enter this code to continue signing in.",
      bodyHtml,
      footerNote: "If you did not request this code, you can ignore this email.",
    }),
  };
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
  changes?: EmailTicketChange[] | null;
  commentSnippet?: string | null;
  assignedUserName?: string | null;
  issueUrl?: string | null;
  commentUrl?: string | null;
  projectName?: string | null;
  departmentPath?: string | null;
  issueDescription?: string | null;
  priority?: string | null;
  currentStatus?: string | null;
  dueAt?: Date | string | null;
  boardUrl?: string | null;
  occurredAt?: Date | string | null;
}): EmailBodies {
  const issueRef = input.issueIdentifier ?? input.issueTitle;
  const actor = nonEmpty(input.actorLabel) ?? input.actorType;
  const relativeTime = formatRelativeTime(input.occurredAt);

  if (input.eventType === "issue.assigned") {
    return buildTicketAssignedEmailBodies({
      recipientName: input.recipientName,
      issueRef,
      issueTitle: input.issueTitle,
      actor,
      issueUrl: input.issueUrl,
      projectName: input.projectName,
      departmentPath: input.departmentPath,
      issueDescription: input.issueDescription,
      priority: input.priority,
      currentStatus: input.currentStatus ?? input.newStatus,
      dueAt: input.dueAt,
      boardUrl: input.boardUrl,
      occurredAt: input.occurredAt,
    });
  }

  if (input.eventType === "issue.status_changed") {
    return buildTicketUpdatedEmailBodies({
      recipientName: input.recipientName,
      issueRef,
      issueTitle: input.issueTitle,
      actor,
      oldStatus: input.oldStatus,
      newStatus: input.newStatus,
      changes: input.changes,
      issueUrl: input.issueUrl,
      projectName: input.projectName,
      departmentPath: input.departmentPath,
      occurredAt: input.occurredAt,
    });
  }

  if (input.eventType === "issue.comment_mentioned") {
    return buildCommentMentionEmailBodies({
      recipientName: input.recipientName,
      issueRef,
      issueTitle: input.issueTitle,
      actor,
      commentSnippet: input.commentSnippet,
      issueUrl: input.issueUrl,
      commentUrl: input.commentUrl,
      projectName: input.projectName,
      departmentPath: input.departmentPath,
      relativeTime,
    });
  }

  const textLines = [
    `Hello ${input.recipientName},`,
    "",
    `Update on issue ${issueRef} (${input.issueTitle}):`,
    "",
    input.eventType === "issue.comment_added" ? `${actor} added a comment.` : `${actor} updated this issue.`,
  ];
  if (input.commentSnippet) textLines.push(`Comment: "${truncateText(input.commentSnippet, 600)}"`);
  if (input.issueUrl) textLines.push("", `Open ticket: ${input.issueUrl}`);
  textLines.push("", "This email was sent by your project notification settings.");

  const bodyParts = [
    ticketCard({
      issueIdentifier: issueRef,
      issueTitle: input.issueTitle,
      projectName: input.projectName,
      departmentPath: input.departmentPath,
    }),
    bodyText(input.eventType === "issue.comment_added" ? `${actor} added a comment.` : `${actor} updated this issue.`),
  ];
  if (input.commentSnippet) {
    bodyParts.push(commentBlock(actor, truncateText(input.commentSnippet, 600), relativeTime));
  }
  if (input.issueUrl) {
    bodyParts.push(primaryButton(input.issueUrl, "View Ticket"), linkFallback(input.issueUrl));
  }

  return {
    textBody: textLines.join("\n"),
    htmlBody: wrapAiHarnessEmail({
      pageTitle: "Ticket update",
      heroEyebrow: "Ticket Updated",
      heroTitle: `Update on ${issueRef}.`,
      heroSubHtml: `${escapeHtml(actor)} posted an update on ${heroAccent(issueRef)}${relativeTime ? ` · ${escapeHtml(relativeTime)}` : ""}.`,
      bodyHtml: bodyParts.join(""),
      footerNote: "You're receiving this because you're a project member.",
    }),
  };
}

function buildTicketAssignedEmailBodies(input: {
  recipientName: string;
  issueRef: string;
  issueTitle: string;
  actor: string;
  issueUrl?: string | null;
  projectName?: string | null;
  departmentPath?: string | null;
  issueDescription?: string | null;
  priority?: string | null;
  currentStatus?: string | null;
  dueAt?: Date | string | null;
  boardUrl?: string | null;
  occurredAt?: Date | string | null;
}): EmailBodies {
  const chips = [priorityChip(input.priority), statusChip(input.currentStatus)].filter(Boolean) as string[];
  const dueDate = formatEmailDate(input.dueAt);
  const relativeTime = formatRelativeTime(input.occurredAt);

  const textBody = [
    `Hello ${input.recipientName},`,
    "",
    `${input.actor} assigned you to ticket ${input.issueRef} (${input.issueTitle}).`,
    nonEmpty(input.projectName) ? `Project: ${input.projectName}` : "",
    nonEmpty(input.departmentPath) ? `Department: ${input.departmentPath}` : "",
    nonEmpty(input.issueDescription) ? `Description: ${truncateText(input.issueDescription, 600)}` : "",
    dueDate ? `Due date: ${dueDate}` : "",
    input.issueUrl ? `\nOpen ticket: ${input.issueUrl}` : "",
    "",
    "This email was sent by your project notification settings.",
  ]
    .filter(Boolean)
    .join("\n");

  const bodyParts = [
    ticketCard({
      issueIdentifier: input.issueRef,
      issueTitle: input.issueTitle,
      projectName: input.projectName,
      departmentPath: input.departmentPath,
      chips,
    }),
  ];
  if (nonEmpty(input.issueDescription)) {
    bodyParts.push(bodyLabel("Description"), bodyText(truncateText(input.issueDescription!, 600)));
  }
  bodyParts.push(divider());
  bodyParts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>`);
  bodyParts.push(`<td width="50%" valign="top">${bodyLabel("Assigned by")}${personRow(input.actor, nonEmpty(input.projectName), "#3b82f6")}</td>`);
  if (dueDate) {
    bodyParts.push(`<td width="50%" valign="top">${bodyLabel("Due date")}<div style="font-size:13px;color:#1a1a2e;font-weight:500;margin-top:4px;">${escapeHtml(dueDate)}</div></td>`);
  }
  bodyParts.push(`</tr></table>`);
  if (input.issueUrl) {
    bodyParts.push(
      primaryButton(input.issueUrl, "View Ticket"),
      ghostButton(input.boardUrl ?? null, "Open Board"),
      linkFallback(input.issueUrl),
    );
  }

  return {
    textBody,
    htmlBody: wrapAiHarnessEmail({
      pageTitle: "Ticket assigned",
      heroEyebrow: "Ticket Assigned",
      heroTitle: "A ticket has been assigned to you.",
      heroSubHtml: `${escapeHtml(input.actor)} assigned you to ticket ${heroAccent(input.issueRef)}${nonEmpty(input.projectName) ? ` in the ${heroAccent(input.projectName!)} project` : ""}${relativeTime ? ` · ${escapeHtml(relativeTime)}` : ""}.`,
      bodyHtml: bodyParts.join(""),
      footerNote: "You're receiving this because you're a project member.",
    }),
  };
}

function buildTicketUpdatedEmailBodies(input: {
  recipientName: string;
  issueRef: string;
  issueTitle: string;
  actor: string;
  oldStatus?: string | null;
  newStatus?: string | null;
  changes?: EmailTicketChange[] | null;
  issueUrl?: string | null;
  projectName?: string | null;
  departmentPath?: string | null;
  occurredAt?: Date | string | null;
}): EmailBodies {
  const relativeTime = formatRelativeTime(input.occurredAt);
  const resolvedChanges =
    input.changes && input.changes.length > 0
      ? input.changes
      : input.oldStatus != null && input.newStatus != null
        ? [
            {
              field: "Status",
              before: statusChip(input.oldStatus) ?? input.oldStatus,
              after: statusChip(input.newStatus) ?? input.newStatus,
            },
          ]
        : [];

  const textBody = [
    `Hello ${input.recipientName},`,
    "",
    `${input.actor} updated ${input.issueRef} (${input.issueTitle}).`,
    ...resolvedChanges.map((change) => `${change.field}: ${change.before} → ${change.after}`),
    input.issueUrl ? `\nOpen ticket: ${input.issueUrl}` : "",
    "",
    "This email was sent by your project notification settings.",
  ]
    .filter(Boolean)
    .join("\n");

  const bodyParts = [
    ticketCard({
      issueIdentifier: input.issueRef,
      issueTitle: input.issueTitle,
      projectName: input.projectName,
      departmentPath: input.departmentPath,
    }),
    bodyLabel("What Changed"),
    changeTable(resolvedChanges),
  ];
  if (input.issueUrl) {
    bodyParts.push(primaryButton(input.issueUrl, "View Ticket"), linkFallback(input.issueUrl));
  }

  const changeCount = resolvedChanges.length;
  const heroTitle =
    changeCount > 1 ? `${changeCount} changes on ${input.issueRef}.` : `Update on ${input.issueRef}.`;

  return {
    textBody,
    htmlBody: wrapAiHarnessEmail({
      pageTitle: "Ticket updated",
      heroEyebrow: "Ticket Updated",
      heroTitle,
      heroSubHtml: `${escapeHtml(input.actor)} made updates to ${heroAccent(input.issueTitle)}${relativeTime ? ` · ${escapeHtml(relativeTime)}` : ""}.`,
      bodyHtml: bodyParts.join(""),
      footerNote: "You're receiving this as assignee or reporter on this ticket.",
    }),
  };
}

function buildCommentMentionEmailBodies(input: {
  recipientName: string;
  issueRef: string;
  issueTitle: string;
  actor: string;
  commentSnippet?: string | null;
  issueUrl?: string | null;
  commentUrl?: string | null;
  projectName?: string | null;
  departmentPath?: string | null;
  relativeTime?: string | null;
}): EmailBodies {
  const comment = nonEmpty(input.commentSnippet) ? truncateText(input.commentSnippet, 600) : null;

  const textBody = [
    `Hello ${input.recipientName},`,
    "",
    `${input.actor} mentioned you in a comment on ${input.issueRef} (${input.issueTitle}).`,
    comment ? `Comment: "${comment}"` : "",
    input.commentUrl ? `\nReply: ${input.commentUrl}` : input.issueUrl ? `\nOpen ticket: ${input.issueUrl}` : "",
    "",
    "This email was sent by your project notification settings.",
  ]
    .filter(Boolean)
    .join("\n");

  const bodyParts = [
    ticketCard({
      issueIdentifier: input.issueRef,
      issueTitle: input.issueTitle,
      projectName: input.projectName,
      departmentPath: input.departmentPath,
    }),
  ];
  if (comment) bodyParts.push(commentBlock(input.actor, comment, input.relativeTime));
  bodyParts.push(
    primaryButton(input.commentUrl ?? input.issueUrl ?? null, "Reply to Comment"),
    ghostButton(input.issueUrl ?? null, "View Ticket"),
    linkFallback(input.commentUrl ?? input.issueUrl),
  );

  return {
    textBody,
    htmlBody: wrapAiHarnessEmail({
      pageTitle: "You were mentioned",
      heroEyebrow: "You were mentioned",
      heroTitle: `${input.actor} mentioned you.`,
      heroSubHtml: `In a comment on ${heroAccent(input.issueRef)} · ${escapeHtml(input.issueTitle)}${input.relativeTime ? ` · ${escapeHtml(input.relativeTime)}` : ""}.`,
      bodyHtml: bodyParts.join(""),
      footerNote: "You received this because you were mentioned in a comment.",
    }),
  };
}

export function buildHumanApprovalEmailBodies(input: {
  recipientName: string;
  issueIdentifier: string | null;
  issueTitle: string;
  approvalStepName: string;
  issueUrl?: string | null;
  approveUrl?: string | null;
  rejectUrl?: string | null;
  decisionDeadline?: Date | string | null;
  governanceDescription?: string | null;
  actorLabel?: string | null;
  actorType?: "agent" | "user" | "system";
  projectName?: string | null;
  departmentPath?: string | null;
}): EmailBodies {
  const issueRef = input.issueIdentifier ?? input.issueTitle;
  const requester = nonEmpty(input.actorLabel) ?? nonEmpty(input.actorType) ?? "";
  const deadline = formatEmailDate(input.decisionDeadline);
  const governance = nonEmpty(input.governanceDescription);

  const textBody = [
    `Hello ${input.recipientName},`,
    "",
    `Human approval is required for issue ${issueRef} (${input.issueTitle}).`,
    "",
    `The issue has entered the "${input.approvalStepName}" step and is awaiting your review.`,
    requester ? `Requested by: ${requester}` : "",
    governance ? `Policy: ${governance}` : "",
    deadline ? `Decision deadline: ${deadline}` : "",
    input.approveUrl ? `Approve: ${input.approveUrl}` : "",
    input.rejectUrl ? `Reject: ${input.rejectUrl}` : "",
    input.issueUrl ? `Open ticket: ${input.issueUrl}` : "",
    "",
    "This email was sent by your project notification settings.",
  ]
    .filter(Boolean)
    .join("\n");

  const bodyParts = [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#fef9ee;border:1px solid #fde68a;border-radius:8px;padding:20px 24px;margin:0 0 20px 0;">
      <tr><td style="font-size:10px;font-family:${FONT_MONO};color:#b45309;letter-spacing:0.1em;text-transform:uppercase;padding-bottom:8px;">Approval Gate Triggered</td></tr>
      <tr><td style="font-size:15px;font-weight:600;color:#1a1a2e;padding-bottom:6px;">${escapeHtml(input.approvalStepName)}</td></tr>
      <tr><td style="font-size:13px;color:#5a5a7a;line-height:1.6;">${governance ? escapeHtml(governance) : "This issue is awaiting your review before it can proceed."}</td></tr>
    </table>`,
    ticketCard({
      issueIdentifier: issueRef,
      issueTitle: input.issueTitle,
      projectName: input.projectName,
      departmentPath: input.departmentPath,
    }),
  ];

  if (requester) {
    bodyParts.push(bodyLabel("Requested By"), personRow(requester, input.actorType === "agent" ? "AI Agent" : null, PURPLE));
  }

  bodyParts.push(optionalValueBlock("Decision Deadline", deadline));
  bodyParts.push(
    primaryButton(input.approveUrl ?? null, "Approve", "#22c55e"),
    ghostButton(input.rejectUrl ?? null, "Reject", "#ef4444"),
    primaryButton(input.issueUrl ?? null, "Review in App"),
    linkFallback(input.issueUrl),
  );
  bodyParts.push(bodyText("Approving will allow work to proceed. Rejecting will pause the task and notify the project lead."));

  return {
    textBody,
    htmlBody: wrapAiHarnessEmail({
      pageTitle: "Approval required",
      heroEyebrow: "Approval Required",
      heroTitle: "An approval is waiting for you.",
      heroSubHtml: requester
        ? `${escapeHtml(requester)} paused on ticket ${heroAccent(issueRef)} and needs your approval to continue.`
        : `Ticket ${heroAccent(issueRef)} needs your approval to continue.`,
      bodyHtml: bodyParts.join(""),
      footerNote: "Sent because you are a designated approver for this project.",
      heroVariant: "approval",
    }),
  };
}

export type DailyDigestTicketRow = {
  issueIdentifier: string | null;
  issueTitle: string;
  statusLabel?: string | null;
};

export function buildDailyDigestEmailBodies(input: {
  recipientName: string;
  companyName?: string | null;
  digestDate?: Date | string | null;
  stats?: {
    updates?: number | null;
    completed?: number | null;
    mentions?: number | null;
    blocked?: number | null;
  } | null;
  assignedTickets?: DailyDigestTicketRow[] | null;
  attentionTickets?: DailyDigestTicketRow[] | null;
  boardUrl?: string | null;
}): EmailBodies {
  const firstName = input.recipientName.trim().split(/\s+/)[0] ?? input.recipientName;
  const digestDate = formatEmailDate(input.digestDate);
  const company = nonEmpty(input.companyName);
  const stats = input.stats ?? {};
  const assigned = input.assignedTickets ?? [];
  const attention = input.attentionTickets ?? [];

  const textBody = [
    `Daily digest for ${input.recipientName}`,
    digestDate ? `Date: ${digestDate}` : "",
    company ? `Workspace: ${company}` : "",
    "",
    "This digest will include activity summaries when configured.",
    input.boardUrl ? `\nOpen board: ${input.boardUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const statCells = [
    { label: "Updates", value: stats.updates },
    { label: "Completed", value: stats.completed },
    { label: "Mentions", value: stats.mentions },
    { label: "Blocked", value: stats.blocked },
  ]
    .map(
      (cell) => `<td style="flex:1;padding:16px;text-align:center;border-right:1px solid #ece8fd;">
      <div style="font-size:24px;font-weight:600;color:#6d28d9;letter-spacing:-0.03em;line-height:1.2;">${cell.value ?? ""}</div>
      <div style="font-size:11px;color:#9090ae;margin-top:3px;">${escapeHtml(cell.label)}</div>
    </td>`,
    )
    .join("");

  const digestRow = (row: DailyDigestTicketRow) => {
    const id = nonEmpty(row.issueIdentifier) ?? "—";
    const title = nonEmpty(row.issueTitle) ?? "";
    const status = nonEmpty(row.statusLabel);
    return `<tr>
      <td style="padding:10px 0;border-bottom:1px solid #f5f3ff;">
        <span style="font-size:11px;font-family:${FONT_MONO};color:${PURPLE};min-width:56px;display:inline-block;">${escapeHtml(id)}</span>
        <span style="font-size:13px;color:#1a1a2e;font-weight:500;">${escapeHtml(title)}</span>
        ${status ? `<span style="float:right;font-size:11px;font-family:${FONT_MONO};color:#9090ae;">${escapeHtml(status)}</span>` : ""}
      </td>
    </tr>`;
  };

  const bodyParts = [
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border:1px solid #ece8fd;border-radius:8px;overflow:hidden;margin:20px 0;"><tr>${statCells}</tr></table>`,
  ];

  if (assigned.length > 0) {
    bodyParts.push(bodyLabel("Your Assigned Tickets"), `<table role="presentation" width="100%">${assigned.map(digestRow).join("")}</table>`);
  }
  if (attention.length > 0) {
    bodyParts.push(divider(), bodyLabel("Needs Attention"), `<table role="presentation" width="100%">${attention.map(digestRow).join("")}</table>`);
  }

  bodyParts.push(primaryButton(input.boardUrl ?? null, "Open My Board"), linkFallback(input.boardUrl));

  return {
    textBody,
    htmlBody: wrapAiHarnessEmail({
      pageTitle: "Daily digest",
      heroEyebrow: "Daily Digest",
      heroTitle: digestDate ? `Yesterday's activity, ${firstName}.` : `Your digest, ${firstName}.`,
      heroSubHtml: digestDate
        ? `Here's what happened across your projects on ${heroAccent(digestDate)}${company ? ` · ${heroAccent(company)}` : ""}.`
        : company
          ? `Activity summary for ${heroAccent(company)}.`
          : "Activity summary for your projects.",
      bodyHtml: bodyParts.join(""),
      footerNote: "Sent daily when digest delivery is configured.",
    }),
  };
}

export function buildSystemAlertEmailBodies(input: {
  recipientName: string;
  alertTitle: string;
  alertSummary?: string | null;
  severityLabel?: string | null;
  actorOrSource?: string | null;
  issueIdentifier?: string | null;
  projectName?: string | null;
  errorTitle?: string | null;
  errorDetails?: string | null;
  traceId?: string | null;
  occurredAt?: Date | string | null;
  incidentUrl?: string | null;
  auditLogUrl?: string | null;
}): EmailBodies {
  const relativeTime = formatRelativeTime(input.occurredAt);
  const formattedAt = formatEmailDate(input.occurredAt);
  const issueRef = nonEmpty(input.issueIdentifier);
  const errorTitle = nonEmpty(input.errorTitle);
  const errorDetails = nonEmpty(input.errorDetails);
  const traceId = nonEmpty(input.traceId);

  const textBody = [
    `Hello ${input.recipientName},`,
    "",
    input.alertTitle,
    nonEmpty(input.alertSummary) ?? "",
    errorTitle ? `Error: ${errorTitle}` : "",
    errorDetails ? errorDetails : "",
    traceId ? `Trace ID: ${traceId}` : "",
    formattedAt ? `Occurred: ${formattedAt}` : "",
    input.incidentUrl ? `\nView incident: ${input.incidentUrl}` : "",
    input.auditLogUrl ? `Audit log: ${input.auditLogUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const bodyParts: string[] = [];

  if (errorTitle || errorDetails || traceId) {
    bodyParts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#fff8f8;border:1px solid #fecaca;border-left:3px solid #ef4444;border-radius:8px;padding:16px 20px;margin:16px 0;">
      <tr><td style="font-size:11px;font-family:${FONT_MONO};color:#dc2626;letter-spacing:0.06em;text-transform:uppercase;padding-bottom:8px;">Error Details</td></tr>
      ${errorTitle ? `<tr><td style="font-size:13px;color:#1a1a2e;font-weight:500;padding-bottom:6px;">${escapeHtml(errorTitle)}</td></tr>` : ""}
      ${errorDetails ? `<tr><td style="font-size:12px;color:#6b7280;font-family:${FONT_MONO};background:#fff8f8;padding:10px;border-radius:4px;line-height:1.6;white-space:pre-wrap;">${escapeHtml(errorDetails)}</td></tr>` : ""}
      ${traceId ? `<tr><td style="font-size:11px;color:#9090ae;padding-top:8px;">Trace ID: ${escapeHtml(traceId)}</td></tr>` : ""}
    </table>`);
  }

  bodyParts.push(`<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>`);
  if (issueRef || nonEmpty(input.projectName)) {
    bodyParts.push(`<td width="50%" valign="top">${bodyLabel("Affected Ticket")}<div style="font-size:13px;color:#1a1a2e;font-weight:500;margin-top:4px;">${issueRef ? escapeHtml(issueRef) : ""}${nonEmpty(input.projectName) ? ` · ${escapeHtml(input.projectName!)}` : ""}</div></td>`);
  }
  if (formattedAt) {
    bodyParts.push(`<td width="50%" valign="top">${bodyLabel("Failed at")}<div style="font-size:13px;color:#1a1a2e;font-weight:500;margin-top:4px;">${escapeHtml(formattedAt)}</div></td>`);
  }
  bodyParts.push(`</tr></table>`);

  bodyParts.push(
    primaryButton(input.incidentUrl ?? null, "View Incident", "#ef4444"),
    ghostButton(input.auditLogUrl ?? null, "View Audit Log", "#ef4444"),
    linkFallback(input.incidentUrl),
  );

  const severity = nonEmpty(input.severityLabel) ?? "System Alert";

  return {
    textBody,
    htmlBody: wrapAiHarnessEmail({
      pageTitle: input.alertTitle,
      heroEyebrow: severity,
      heroTitle: input.alertTitle,
      heroSubHtml: `${nonEmpty(input.alertSummary) ? `${escapeHtml(input.alertSummary)}` : ""}${nonEmpty(input.actorOrSource) ? ` ${heroAccent(input.actorOrSource!)}` : ""}${relativeTime ? ` · ${escapeHtml(relativeTime)}` : ""}.`,
      bodyHtml: bodyParts.join(""),
      footerNote: "Sent to workspace admins per system alert policy.",
      heroVariant: "alert",
    }),
  };
}

export function humanInviteEmailSubject(companyName?: string | null): string {
  const workspace = nonEmpty(companyName);
  return workspace
    ? `You've been invited to AI-Harness — ${workspace} Workspace`
    : "You have been invited to AI-Harness";
}

export function issueCommentUrl(issueUrl: string | null | undefined, commentId: string | null | undefined): string | null {
  const base = nonEmpty(issueUrl);
  const id = nonEmpty(commentId);
  if (!base || !id) return base;
  return `${base}#comment-${encodeURIComponent(id)}`;
}
