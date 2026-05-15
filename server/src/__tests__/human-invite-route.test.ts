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
const mockSendHumanInviteEmail = vi.hoisted(() => vi.fn());

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
  sendHumanInviteEmail: mockSendHumanInviteEmail,
}));

function createDbStub(selectQueue: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => (selectQueue.shift() ?? []) as unknown[]),
      })),
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => []),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoNothing: vi.fn(async () => []),
      })),
    })),
  };
}

function createApp(db: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
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
    accessRoutes(db as any, {
      deploymentMode: "authenticated",
      deploymentExposure: "private",
      bindHost: "127.0.0.1",
      allowedHostnames: [],
    }),
  );
  app.use(errorHandler);
  return app;
}

describe("POST /companies/:companyId/human-invites", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.ensureMembership.mockResolvedValue({ id: "membership-1" });
    mockAccessService.setPrincipalGrants.mockResolvedValue(undefined);
    mockLogActivity.mockResolvedValue(undefined);
    mockSendHumanInviteEmail.mockResolvedValue({
      status: "skipped",
      message: "Microsoft Graph mail is not configured",
    });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  });

  it("creates a temporary-credential invite for a new user", async () => {
    const db = createDbStub([[]]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user: {
          id: "new-user-1",
          email: "new.user@example.com",
          name: "New User",
        },
      }),
    } as Response);
    const app = createApp(db);

    const res = await request(app)
      .post("/api/companies/company-1/human-invites")
      .send({ email: "new.user@example.com", name: "New User" });

    expect(res.status).toBe(201);
    expect(res.body.email).toBe("new.user@example.com");
    expect(res.body.temporaryUsername).toBe("new.user@example.com");
    expect(typeof res.body.temporaryPassword).toBe("string");
    expect(res.body.temporaryPassword.length).toBeGreaterThanOrEqual(8);
    expect(res.body.emailDelivery?.status).toBe("skipped");
    expect(mockAccessService.setPrincipalGrants).toHaveBeenCalledWith(
      "company-1",
      "user",
      "new-user-1",
      [],
      "user-1",
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const call = fetchMock.mock.calls[0];
    expect(typeof call?.[0]).toBe("string");
    expect((call?.[0] as string).endsWith("/api/auth/sign-up/email")).toBe(true);
    expect((call?.[1] as { headers?: Record<string, string> })?.headers).toMatchObject({
      origin: expect.stringMatching(/^http:\/\/127\.0\.0\.1(?::\d+)?$/),
      referer: expect.stringMatching(/^http:\/\/127\.0\.0\.1(?::\d+)?\/$/),
    });
  });

  it("rejects when user already has active company membership", async () => {
    const db = createDbStub([
      [{ id: "existing-user", email: "existing@example.com" }],
      [{ id: "existing-membership" }],
    ]);
    const app = createApp(db);

    const res = await request(app)
      .post("/api/companies/company-1/human-invites")
      .send({ email: "existing@example.com" });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain("already has access");
    expect(mockAccessService.setPrincipalGrants).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies explicitly provided invite grants", async () => {
    const db = createDbStub([[]]);
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        user: {
          id: "new-user-2",
          email: "granted.user@example.com",
          name: "Granted User",
        },
      }),
    } as Response);
    const app = createApp(db);

    const res = await request(app)
      .post("/api/companies/company-1/human-invites")
      .send({
        email: "granted.user@example.com",
        grants: [
          { permissionKey: "tasks:assign", scope: null },
          { permissionKey: "users:invite", scope: null },
        ],
      });

    expect(res.status).toBe(201);
    expect(mockAccessService.setPrincipalGrants).toHaveBeenCalledWith(
      "company-1",
      "user",
      "new-user-2",
      [
        { permissionKey: "tasks:assign", scope: null },
        { permissionKey: "users:invite", scope: null },
      ],
      "user-1",
    );
  });

  it("surfaces actionable error when sign-up is disabled", async () => {
    const db = createDbStub([[]]);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: "Sign-up is disabled" } }),
    } as Response);
    const app = createApp(db);

    const res = await request(app)
      .post("/api/companies/company-1/human-invites")
      .send({ email: "disabled@example.com" });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain("Sign-up is disabled");
    expect(mockAccessService.setPrincipalGrants).not.toHaveBeenCalled();
  });
});

describe("GET /companies/:companyId/members", () => {
  beforeEach(() => {
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.listMembers.mockResolvedValue([
      {
        id: "member-user-1",
        companyId: "company-1",
        principalType: "user",
        principalId: "user-2",
        status: "active",
        membershipRole: "member",
        createdAt: new Date("2026-03-16T00:00:00.000Z"),
        updatedAt: new Date("2026-03-16T00:00:00.000Z"),
      },
      {
        id: "member-agent-1",
        companyId: "company-1",
        principalType: "agent",
        principalId: "agent-1",
        status: "active",
        membershipRole: "member",
        createdAt: new Date("2026-03-16T00:00:00.000Z"),
        updatedAt: new Date("2026-03-16T00:00:00.000Z"),
      },
    ]);
  });

  it("returns memberships enriched with user and agent details", async () => {
    const db = createDbStub([
      [{ id: "user-2", name: "User Two", email: "user.two@example.com" }],
      [{ id: "agent-1", name: "Agent One", role: "engineer" }],
      [{ principalId: "user-2", permissionKey: "tasks:assign", scope: null }],
      [],
    ]);
    const app = createApp(db);

    const res = await request(app).get("/api/companies/company-1/members");

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({
      id: "member-user-1",
      principalType: "user",
      grants: [{ permissionKey: "tasks:assign", scope: null }],
      user: {
        id: "user-2",
        name: "User Two",
        email: "user.two@example.com",
      },
      agent: null,
    });
    expect(res.body[1]).toMatchObject({
      id: "member-agent-1",
      principalType: "agent",
      grants: [],
      user: null,
      agent: {
        id: "agent-1",
        name: "Agent One",
        role: "engineer",
      },
    });
  });
});

describe("PATCH /companies/:companyId/members/:memberId/permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.setMemberPermissions.mockResolvedValue({
      id: "member-user-1",
      companyId: "company-1",
      principalType: "user",
      principalId: "user-2",
      status: "active",
      membershipRole: "member",
      reportsToMembershipId: null,
      createdAt: new Date("2026-03-16T00:00:00.000Z"),
      updatedAt: new Date("2026-03-16T00:00:00.000Z"),
    });
  });

  it("updates member grants when actor can manage permissions", async () => {
    const app = createApp(createDbStub([]));
    const grants = [{ permissionKey: "tasks:assign", scope: null }];

    const res = await request(app)
      .patch("/api/companies/company-1/members/member-user-1/permissions")
      .send({ grants });

    expect(res.status).toBe(200);
    expect(mockAccessService.setMemberPermissions).toHaveBeenCalledWith(
      "company-1",
      "member-user-1",
      grants,
      "user-1",
    );
  });

  it("returns 403 when actor lacks users:manage_permissions", async () => {
    mockAccessService.canUser.mockResolvedValue(false);
    const app = createApp(createDbStub([]));

    const res = await request(app)
      .patch("/api/companies/company-1/members/member-user-1/permissions")
      .send({ grants: [{ permissionKey: "tasks:assign", scope: null }] });

    expect(res.status).toBe(403);
    expect(mockAccessService.setMemberPermissions).not.toHaveBeenCalled();
  });
});
