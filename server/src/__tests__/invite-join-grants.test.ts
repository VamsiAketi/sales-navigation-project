import { describe, expect, it } from "vitest";
import {
  defaultCompanyPermissionsForAgentRole,
} from "@paperclipai/shared";
import { agentJoinGrantsFromDefaults, humanInviteGrants } from "../routes/access.js";

describe("agentJoinGrantsFromDefaults", () => {
  it("includes baseline agent permissions when invite defaults are empty", () => {
    expect(agentJoinGrantsFromDefaults(null).map((grant) => grant.permissionKey)).toEqual(
      defaultCompanyPermissionsForAgentRole("general"),
    );
  });

  it("preserves invite extras and scoped overrides", () => {
    const merged = agentJoinGrantsFromDefaults({
      agent: {
        grants: [
          {
            permissionKey: "agents:create",
            scope: null,
          },
        ],
      },
    });
    expect(merged.find((grant) => grant.permissionKey === "agents:create")).toEqual({
      permissionKey: "agents:create",
      scope: null,
    });
    expect(merged.find((grant) => grant.permissionKey === "tasks.create")).toEqual({
      permissionKey: "tasks.create",
      scope: null,
    });
  });

  it("does not duplicate tasks:assign when invite defaults already include scoped assign", () => {
    expect(
      agentJoinGrantsFromDefaults({
        agent: {
          grants: [
            {
              permissionKey: "tasks:assign",
              scope: { projectId: "project-1" },
            },
          ],
        },
      }).find((grant) => grant.permissionKey === "tasks:assign"),
    ).toEqual({
      permissionKey: "tasks:assign",
      scope: { projectId: "project-1" },
    });
  });

  it("includes CEO extras when role is ceo", () => {
    const keys = agentJoinGrantsFromDefaults(null, "ceo").map((grant) => grant.permissionKey);
    expect(keys).toEqual(defaultCompanyPermissionsForAgentRole("ceo"));
  });
});

describe("humanInviteGrants", () => {
  it("starts newly invited human members with restricted baseline grants", () => {
    expect(humanInviteGrants()).toEqual([]);
  });
});
