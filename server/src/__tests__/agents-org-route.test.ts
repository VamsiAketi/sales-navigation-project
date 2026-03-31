import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { agentRoutes } from "../routes/agents.js";

const orgForCompanyMock = vi.fn();

vi.mock("../services/index.js", () => ({
  agentService: () => ({
    orgForCompany: orgForCompanyMock,
    getById: vi.fn(),
    list: vi.fn(),
    updateDirectReportOrder: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updatePermissions: vi.fn(),
    pause: vi.fn(),
    pauseAll: vi.fn(),
    resumeAll: vi.fn(),
    resume: vi.fn(),
    terminate: vi.fn(),
    remove: vi.fn(),
    listKeys: vi.fn(),
    createApiKey: vi.fn(),
    revokeKey: vi.fn(),
    getChainOfCommand: vi.fn(),
    getConfigRevision: vi.fn(),
    listConfigRevisions: vi.fn(),
    rollbackConfigRevision: vi.fn(),
    resolveByReference: vi.fn(),
  }),
  budgetService: () => ({}),
  accessService: () => ({
    canUser: vi.fn(),
    hasPermission: vi.fn(),
    ensureMembership: vi.fn(),
  }),
  workspaceOperationService: () => ({}),
  agentInstructionsService: () => ({
    getResolvedBundle: vi.fn(),
    updateBundle: vi.fn(),
    resetBundle: vi.fn(),
    listFiles: vi.fn(),
    readFile: vi.fn(),
    saveFile: vi.fn(),
    deleteFile: vi.fn(),
  }),
  approvalService: () => ({
    create: vi.fn(),
    getById: vi.fn(),
  }),
  heartbeatService: () => ({
    getRuntimeState: vi.fn(),
    listTaskSessions: vi.fn(),
    resetRuntimeSession: vi.fn(),
    cancelActiveForAgent: vi.fn(),
    list: vi.fn(),
    getRun: vi.fn(),
    listEvents: vi.fn(),
    readLog: vi.fn(),
    getActiveRunForAgent: vi.fn(),
    invoke: vi.fn(),
    wakeup: vi.fn(),
    cancelRun: vi.fn(),
  }),
  issueApprovalService: () => ({
    linkManyForApproval: vi.fn(),
  }),
  issueService: () => ({
    getByIdentifier: vi.fn(),
    getById: vi.fn(),
  }),
  logActivity: vi.fn(),
  secretService: () => ({
    normalizeAdapterConfigForPersistence: vi.fn(),
    resolveAdapterConfigForRuntime: vi.fn(),
  }),
  companySkillService: () => ({
    resolveRequestedSkillKeys: vi.fn(),
    listRuntimeSkillEntries: vi.fn(),
  }),
  instanceSettingsService: () => ({
    getGeneral: vi.fn(async () => ({ censorUsernameInLogs: false })),
  }),
  syncInstructionsBundleConfigFromFilePath: vi.fn(),
}));

function createSelectResult(rows: unknown[], withWhere: boolean) {
  if (withWhere) {
    return {
      from: vi.fn(() => ({
        where: vi.fn(async () => rows),
      })),
    };
  }
  return {
    from: vi.fn(async () => rows),
  };
}

describe("GET /api/companies/:companyId/org", () => {
  it("keeps both human and agent reports under the same human manager", async () => {
    orgForCompanyMock.mockResolvedValueOnce([
      {
        id: "agent-c",
        name: "Agent C",
        role: "general",
        status: "active",
        nodeType: "agent",
        reports: [],
      },
    ]);

    const memberships = [
      {
        id: "m-human-a",
        companyId: "company-1",
        principalType: "user",
        principalId: "user-a",
        status: "active",
        membershipRole: "Engineer",
        reportsToMembershipId: "m-human-b",
      },
      {
        id: "m-human-b",
        companyId: "company-1",
        principalType: "user",
        principalId: "user-b",
        status: "active",
        membershipRole: "Manager",
        reportsToMembershipId: null,
      },
      {
        id: "m-agent-c",
        companyId: "company-1",
        principalType: "agent",
        principalId: "agent-c",
        status: "active",
        membershipRole: "agent",
        reportsToMembershipId: "m-human-b",
      },
    ];

    const users = [
      { id: "user-a", name: "Human A", email: "a@example.com" },
      { id: "user-b", name: "Human B", email: "b@example.com" },
    ];

    const db = {
      select: vi
        .fn()
        .mockImplementationOnce(() => createSelectResult(memberships, true))
        .mockImplementationOnce(() => createSelectResult(users, false)),
    };

    const app = express();
    app.use((req, _res, next) => {
      (req as any).actor = {
        type: "board",
        source: "local_implicit",
      };
      next();
    });
    app.use("/api", agentRoutes(db as any));

    const res = await request(app).get("/api/companies/company-1/org");

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: "m-human-b",
        name: "Human B",
        role: "Manager",
        status: "active",
        nodeType: "human",
        reports: [
          {
            id: "agent-c",
            name: "Agent C",
            role: "general",
            status: "active",
            nodeType: "agent",
            reports: [],
          },
          {
            id: "m-human-a",
            name: "Human A",
            role: "Engineer",
            status: "active",
            nodeType: "human",
            reports: [],
          },
        ],
      },
    ]);
  });
});
