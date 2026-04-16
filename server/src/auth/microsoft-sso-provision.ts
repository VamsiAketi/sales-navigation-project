import { and, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { authAccounts, companies, companyMemberships } from "@paperclipai/db";
import { logger } from "../middleware/logger.js";
import { accessService } from "../services/access.js";
import { logActivity } from "../services/activity-log.js";

export type MicrosoftSsoAutoProvisionSettings = {
  companyIds: string[];
  membershipRole: string;
  /** Lowercase domains without "@", e.g. ["contoso.com"]. Empty = do not filter by domain. */
  emailDomains: string[];
};

function normalizeEmailDomains(raw: string | undefined): string[] {
  if (!raw?.trim()) return [];
  return raw
    .split(",")
    .map((part) => part.trim().toLowerCase().replace(/^@+/, ""))
    .filter((d) => d.length > 0);
}

export function parseMicrosoftSsoAutoProvisionFromEnv(): MicrosoftSsoAutoProvisionSettings {
  const fromList =
    process.env.PAPERCLIP_AUTH_MICROSOFT_AUTO_PROVISION_COMPANY_IDS?.trim() ||
    process.env.AI_HARNESS_AUTH_MICROSOFT_AUTO_PROVISION_COMPANY_IDS?.trim() ||
    process.env["AI-HARNESS_AUTH_MICROSOFT_AUTO_PROVISION_COMPANY_IDS"]?.trim() ||
    "";
  const single =
    process.env.PAPERCLIP_AUTH_MICROSOFT_AUTO_PROVISION_COMPANY_ID?.trim() ||
    process.env.AI_HARNESS_AUTH_MICROSOFT_AUTO_PROVISION_COMPANY_ID?.trim() ||
    process.env["AI-HARNESS_AUTH_MICROSOFT_AUTO_PROVISION_COMPANY_ID"]?.trim() ||
    "";

  const companyIds = [...fromList.split(",").map((s) => s.trim()).filter(Boolean), single].filter(Boolean);
  const unique = [...new Set(companyIds)];

  const membershipRole =
    process.env.PAPERCLIP_AUTH_MICROSOFT_AUTO_PROVISION_MEMBERSHIP_ROLE?.trim() ||
    process.env.AI_HARNESS_AUTH_MICROSOFT_AUTO_PROVISION_MEMBERSHIP_ROLE?.trim() ||
    process.env["AI-HARNESS_AUTH_MICROSOFT_AUTO_PROVISION_MEMBERSHIP_ROLE"]?.trim() ||
    "member";

  const emailDomainsRaw =
    process.env.PAPERCLIP_AUTH_MICROSOFT_AUTO_PROVISION_EMAIL_DOMAINS?.trim() ||
    process.env.AI_HARNESS_AUTH_MICROSOFT_AUTO_PROVISION_EMAIL_DOMAINS?.trim() ||
    process.env["AI-HARNESS_AUTH_MICROSOFT_AUTO_PROVISION_EMAIL_DOMAINS"]?.trim() ||
    "";

  return {
    companyIds: unique,
    membershipRole,
    emailDomains: normalizeEmailDomains(emailDomainsRaw),
  };
}

async function userHasMicrosoftLinkedAccount(db: Db, userId: string): Promise<boolean> {
  const row = await db
    .select({ id: authAccounts.id })
    .from(authAccounts)
    .where(and(eq(authAccounts.userId, userId), eq(authAccounts.providerId, "microsoft")))
    .then((rows) => rows[0] ?? null);
  return Boolean(row);
}

function emailDomainAllowed(email: string | null | undefined, domains: string[]): boolean {
  if (domains.length === 0) return true;
  if (!email?.trim()) return false;
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 0) return false;
  const domain = lower.slice(at + 1);
  return domains.includes(domain);
}

/**
 * Ensures Microsoft SSO users get company membership + baseline grants when they have no access yet.
 * Idempotent per company via `ensureMembership` / `setPrincipalGrants`.
 */
export async function maybeProvisionMicrosoftSsoUser(
  db: Db,
  userId: string,
  userEmail: string | null | undefined,
  settings: MicrosoftSsoAutoProvisionSettings,
): Promise<boolean> {
  if (settings.companyIds.length === 0) return false;
  if (!(await userHasMicrosoftLinkedAccount(db, userId))) return false;
  if (!emailDomainAllowed(userEmail, settings.emailDomains)) return false;

  const existingCompanies = await db
    .select({ id: companies.id })
    .from(companies)
    .where(inArray(companies.id, settings.companyIds));
  const validCompanyIds = new Set(existingCompanies.map((row) => row.id));
  const access = accessService(db);

  let provisionedAny = false;

  for (const companyId of settings.companyIds) {
    if (!validCompanyIds.has(companyId)) {
      logger.warn({ companyId, userId }, "Microsoft SSO auto-provision: company id not found, skipping");
      continue;
    }

    await access.ensureMembership(companyId, "user", userId, settings.membershipRole, "active");

    const membershipRow = await access.getMembership(companyId, "user", userId);
    if (!membershipRow) continue;

    const ownerMembership = await db
      .select({ id: companyMemberships.id })
      .from(companyMemberships)
      .where(
        and(
          eq(companyMemberships.companyId, companyId),
          eq(companyMemberships.principalType, "user"),
          eq(companyMemberships.status, "active"),
          eq(companyMemberships.membershipRole, "owner"),
        ),
      )
      .then((rows) => rows[0] ?? null);

    if (ownerMembership && ownerMembership.id !== membershipRow.id) {
      await db
        .update(companyMemberships)
        .set({
          reportsToMembershipId: ownerMembership.id,
          updatedAt: new Date(),
        })
        .where(and(eq(companyMemberships.id, membershipRow.id), isNull(companyMemberships.reportsToMembershipId)));
    }

    // Same baseline as `humanInviteGrants()` in access routes (currently empty).
    await access.setPrincipalGrants(companyId, "user", userId, [], null);

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: userId,
      action: "user.microsoft_sso_provisioned",
      entityType: "user",
      entityId: userId,
      details: {
        email: userEmail ?? null,
        membershipRole: settings.membershipRole,
      },
    });

    provisionedAny = true;
  }

  if (provisionedAny) {
    logger.info(
      { userId, companyIds: settings.companyIds.filter((id) => validCompanyIds.has(id)) },
      "Microsoft SSO user auto-provisioned",
    );
  }

  return provisionedAny;
}
