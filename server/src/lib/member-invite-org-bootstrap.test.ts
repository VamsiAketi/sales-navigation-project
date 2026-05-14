import { describe, expect, it } from "vitest";
import {
  MEMBER_INVITE_ORG_BOOTSTRAP_MAX_AGE_MS,
  mayApplyInviteOrgBootstrapPower,
} from "./member-invite-org-bootstrap.js";

const base = () => ({
  needsOrgPower: true,
  canManageOrgConfig: false,
  canInviteHumans: true,
  managerTargetsUpdateRequested: false,
  memberPrincipalType: "user",
  membershipCreatedAt: new Date("2026-05-14T12:00:00.000Z"),
  nowMs: Date.parse("2026-05-14T12:15:00.000Z"),
  hasMustChangePasswordRole: true,
});

describe("mayApplyInviteOrgBootstrapPower", () => {
  it("allows role/reports bootstrap for recent invitee with must_change_password", () => {
    expect(mayApplyInviteOrgBootstrapPower(base())).toBe(true);
  });

  it("denies when actor can already manage org config (normal admin path)", () => {
    expect(mayApplyInviteOrgBootstrapPower({ ...base(), canManageOrgConfig: true })).toBe(false);
  });

  it("denies without users:invite", () => {
    expect(mayApplyInviteOrgBootstrapPower({ ...base(), canInviteHumans: false })).toBe(false);
  });

  it("denies managedAgentMemberIds updates (admin-only)", () => {
    expect(mayApplyInviteOrgBootstrapPower({ ...base(), managerTargetsUpdateRequested: true })).toBe(false);
  });

  it("denies when membership is older than the bootstrap window", () => {
    const created = Date.parse("2026-05-14T12:00:00.000Z");
    expect(
      mayApplyInviteOrgBootstrapPower({
        ...base(),
        membershipCreatedAt: new Date(created),
        nowMs: created + MEMBER_INVITE_ORG_BOOTSTRAP_MAX_AGE_MS + 1,
      }),
    ).toBe(false);
  });

  it("denies after first-login password flow clears must_change_password", () => {
    expect(mayApplyInviteOrgBootstrapPower({ ...base(), hasMustChangePasswordRole: false })).toBe(false);
  });

  it("denies for non-user principals", () => {
    expect(mayApplyInviteOrgBootstrapPower({ ...base(), memberPrincipalType: "agent" })).toBe(false);
  });

  it("denies when no org-power fields are being updated", () => {
    expect(mayApplyInviteOrgBootstrapPower({ ...base(), needsOrgPower: false })).toBe(false);
  });
});
