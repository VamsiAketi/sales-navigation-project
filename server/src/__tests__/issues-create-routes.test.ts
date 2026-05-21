import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const mockIssueService = vi.hoisted(() => ({
  create: vi.fn(),
}));

const mockLogActivity = vi.hoisted(() => vi.fn(async () => undefined));
const mockQueueIssueAssignmentWakeup = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../services/issue-assignment-wakeup.js", () => ({
  queueIssueAssignmentWakeup: mockQueueIssueAssignmentWakeup,
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: vi.fn(async () => true),
    hasPermission: vi.fn(async () => true),
    companyUsesRestrictedProjectAccess: vi.fn(async () => false),
    satisfiesProjectPermission: vi.fn(async () => true),
    listProjectIdsVisibleToActor: vi.fn(async () => null),
  }),
  agentService: () => ({
    getById: vi.fn(async () => null),
  }),
  documentService: () => ({
    getIssueDocumentPayload: vi.fn(async () => ({})),
  }),
  executionWorkspaceService: () => ({
    getById: vi.fn(async () => null),
  }),
  goalService: () => ({
    getById: vi.fn(async () => null),
    getDefaultCompanyGoal: vi.fn(async () => null),
  }),
  heartbeatService: () => ({
    wakeup: vi.fn(async () => undefined),
    reportRunActivity: vi.fn(async () => undefined),
  }),
  issueNotificationService: () => ({
    notifyIssueEvent: vi.fn(async () => undefined),
  }),
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: mockLogActivity,
  projectDataService: () => ({
    listDataObjects: vi.fn(async () => []),
  }),
  projectIssueStatusService: () => ({
    list: vi.fn(async () => []),
  }),
  projectService: () => ({
    getById: vi.fn(async () => null),
    listByIds: vi.fn(async () => []),
  }),
  routineService: () => ({
    syncRunStatusForIssue: vi.fn(async () => undefined),
  }),
  workProductService: () => ({
    listForIssue: vi.fn(async () => []),
  }),
}));

function createApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "local-board",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", issueRoutes({} as any, {} as any));
  app.use(errorHandler);
  return app;
}

describe("issue create routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.create.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      companyId: "company-1",
      identifier: "PAP-1",
      title: "Create issue",
      status: "todo",
      priority: "medium",
      projectId: "22222222-2222-4222-8222-222222222222",
      assigneeAgentId: null,
      assigneeUserId: null,
    });
  });

  it("rejects manual create without projectId with 422", async () => {
    const res = await request(createApp())
      .post("/api/companies/company-1/issues")
      .send({
        title: "Missing project",
        status: "todo",
        priority: "medium",
      });

    expect(res.status).toBe(422);
    expect(res.body).toEqual({
      error: "Manual task creation requires a projectId.",
      details: { field: "projectId" },
    });
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });

  it("creates issue when projectId is present", async () => {
    const projectId = "22222222-2222-4222-8222-222222222222";
    const res = await request(createApp())
      .post("/api/companies/company-1/issues")
      .send({
        title: "Valid issue",
        projectId,
        status: "todo",
        priority: "medium",
      });

    expect(res.status).toBe(201);
    expect(mockIssueService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        title: "Valid issue",
        projectId,
      }),
    );
  });
});
