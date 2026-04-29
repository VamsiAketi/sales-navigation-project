import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accessRoutes } from "../routes/access.js";
import { errorHandler } from "../middleware/index.js";

const mockAccessService = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  canUser: vi.fn(),
  isInstanceAdmin: vi.fn(),
  getMembership: vi.fn(),
  ensureMembership: vi.fn(),
  listMembers: vi.fn(),
  setMemberPermissions: vi.fn(),
  promoteInstanceAdmin: vi.fn(),
  demoteInstanceAdmin: vi.fn(),
  listUserCompanyAccess: vi.fn(),
  setUserCompanyAccess: vi.fn(),
  setPrincipalGrants: vi.fn(),
}));

const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn());

vi.mock("../services/index.js", () => ({
  accessService: () => mockAccessService,
  agentService: () => mockAgentService,
  boardAuthService: () => ({
    createChallenge: vi.fn(),
    getChallengeBySecret: vi.fn(),
    approveChallenge: vi.fn(),
    consumeChallenge: vi.fn(),
    listKeysForUser: vi.fn(),
    revokeKey: vi.fn(),
    hashApiKey: vi.fn(),
  }),
  deduplicateAgentName: vi.fn(),
  logActivity: mockLogActivity,
  notifyHireApproved: vi.fn(),
  sendHumanInviteEmail: vi.fn(),
}));

function createDbStub(rowBatches: unknown[][]) {
  const queue = [...rowBatches];
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const rows = queue.shift() ?? [];
          return Promise.resolve(rows);
        }),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(async () => []),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async () => []),
    })),
  };
}

function createApp(db: Record<string, unknown>, changePassword?: (input: unknown) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: Record<string, unknown> }).actor = {
      type: "board",
      userId: "user-1",
      companyIds: ["company-1"],
      source: "session",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use(
    "/api",
    accessRoutes(db as unknown as Parameters<typeof accessRoutes>[0], {
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
      changePassword:
        changePassword ?? (async () => {
          /* noop */
        }),
    }),
  );
  app.use(errorHandler);
  return app;
}

describe("POST /companies/:companyId/members/:memberId/set-password", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.canUser.mockResolvedValue(true);
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("generates random password when body is empty (same helpers as invites)", async () => {
    const changePassword = vi.fn().mockResolvedValue(undefined);
    const db = createDbStub([
      [
        {
          id: "mem-1",
          principalType: "user",
          principalId: "target-user-9",
          status: "active",
        },
      ],
    ]);
    const app = createApp(db, changePassword);

    const res = await request(app)
      .post("/api/companies/company-1/members/mem-1/set-password")
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.temporaryPassword).toBe("string");
    expect((res.body.temporaryPassword as string).length).toBeGreaterThanOrEqual(15);
    expect(changePassword).toHaveBeenCalledWith({
      userId: "target-user-9",
      newPassword: res.body.temporaryPassword,
    });
    expect(mockLogActivity).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        companyId: "company-1",
        actorType: "user",
        actorId: "user-1",
        action: "user.password_set_by_operator",
        entityType: "user",
        entityId: "target-user-9",
        details: expect.objectContaining({ generatedRandomPassword: true }),
      }),
    );
  });

  it("returns 422 when credential account does not exist", async () => {
    const changePassword = vi.fn().mockRejectedValue(
      new Error("No credential account found for user — cannot update password"),
    );
    const db = createDbStub([
      [
        {
          id: "mem-1",
          principalType: "user",
          principalId: "target-user-sso-only",
          status: "active",
        },
      ],
    ]);
    const app = createApp(db, changePassword);

    const res = await request(app)
      .post("/api/companies/company-1/members/mem-1/set-password")
      .send({});

    expect(res.status).toBe(422);
    expect(mockLogActivity).not.toHaveBeenCalled();
  });
});
