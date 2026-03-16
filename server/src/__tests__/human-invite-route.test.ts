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
  deduplicateAgentName: vi.fn(),
  logActivity: mockLogActivity,
  notifyHireApproved: vi.fn(),
}));

function createDbStub(selectQueue: unknown[]) {
  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(async () => (selectQueue.shift() ?? []) as unknown[]),
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
    mockAccessService.canUser.mockResolvedValue(true);
    mockAccessService.ensureMembership.mockResolvedValue({ id: "membership-1" });
    mockLogActivity.mockResolvedValue(undefined);
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
    expect(fetchMock).not.toHaveBeenCalled();
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
  });
});
