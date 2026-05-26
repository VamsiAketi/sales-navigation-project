/** Optional outbound-email footer links and address (unset env vars = blank). */
export type EmailFooterLinks = {
  unsubscribeUrl: string | null;
  privacyUrl: string | null;
  helpCenterUrl: string | null;
  notificationSettingsUrl: string | null;
  auditLogUrl: string | null;
  governanceSettingsUrl: string | null;
  runbookUrl: string | null;
  alertSettingsUrl: string | null;
  digestSettingsUrl: string | null;
  physicalAddress: string | null;
};

function readOptionalEnv(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

export function readEmailFooterLinks(): EmailFooterLinks {
  return {
    unsubscribeUrl: readOptionalEnv("PAPERCLIP_EMAIL_UNSUBSCRIBE_URL"),
    privacyUrl: readOptionalEnv("PAPERCLIP_EMAIL_PRIVACY_URL"),
    helpCenterUrl: readOptionalEnv("PAPERCLIP_EMAIL_HELP_URL"),
    notificationSettingsUrl: readOptionalEnv("PAPERCLIP_EMAIL_NOTIFICATION_SETTINGS_URL"),
    auditLogUrl: readOptionalEnv("PAPERCLIP_EMAIL_AUDIT_LOG_URL"),
    governanceSettingsUrl: readOptionalEnv("PAPERCLIP_EMAIL_GOVERNANCE_SETTINGS_URL"),
    runbookUrl: readOptionalEnv("PAPERCLIP_EMAIL_RUNBOOK_URL"),
    alertSettingsUrl: readOptionalEnv("PAPERCLIP_EMAIL_ALERT_SETTINGS_URL"),
    digestSettingsUrl: readOptionalEnv("PAPERCLIP_EMAIL_DIGEST_SETTINGS_URL"),
    physicalAddress: readOptionalEnv("PAPERCLIP_EMAIL_PHYSICAL_ADDRESS"),
  };
}

/** Branded from-address override; falls back to MS_GRAPH_SENDER_EMAIL at send time. */
export function readBrandedFromEmail(): string | null {
  return readOptionalEnv("PAPERCLIP_EMAIL_FROM_ADDRESS");
}
