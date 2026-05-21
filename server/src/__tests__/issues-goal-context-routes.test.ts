import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueRoutes } from "../routes/issues.js";
import { errorHandler } from "../middleware/index.js";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  getAncestors: vi.fn(),
  findMentionedProjectIds: vi.fn(),
  getCommentCursor: vi.fn(),
  getComment: vi.fn(),
  create: vi.fn(),
}));

const mockProjectService = vi.hoisted(() => ({
  getById: vi.fn(),
  listByIds: vi.fn(),
}));

const mockGoalService = vi.hoisted(() => ({
  getById: vi.fn(),
  getDefaultCompanyGoal: vi.fn(),
}));

const mockProjectIssueStatusService = vi.hoisted(() => ({
  list: vi.fn(),
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    canUser: vi.fn(),
    hasPermission: vi.fn(),
    companyUsesRestrictedProjectAccess: vi.fn(async () => false),
    satisfiesProjectPermission: vi.fn(async () => true),
    listProjectIdsVisibleToActor: vi.fn(async () => null),
    seedIssueAssigneeGrantsForAgent: vi.fn(async () => false),
  }),
  agentService: () => ({
    getById: vi.fn(),
  }),
  documentService: () => ({
    getIssueDocumentPayload: vi.fn(async () => ({})),
  }),
  executionWorkspaceService: () => ({
    getById: vi.fn(),
  }),
  goalService: () => mockGoalService,
  heartbeatService: () => ({
    wakeup: vi.fn(async () => undefined),
    reportRunActivity: vi.fn(async () => undefined),
  }),
  issueNotificationService: () => ({
    notifyIssueEvent: vi.fn(async () => undefined),
  }),
  issueApprovalService: () => ({}),
  issueService: () => mockIssueService,
  logActivity: vi.fn(async () => undefined),
  projectIssueStatusService: () => mockProjectIssueStatusService,
  projectService: () => mockProjectService,
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

const legacyProjectLinkedIssue = {
  id: "11111111-1111-4111-8111-111111111111",
  companyId: "company-1",
  identifier: "PAP-581",
  title: "Legacy onboarding task",
  description: "Seed the first CEO task",
  status: "todo",
  priority: "medium",
  projectId: "22222222-2222-4222-8222-222222222222",
  goalId: null,
  parentId: null,
  assigneeAgentId: "33333333-3333-4333-8333-333333333333",
  assigneeUserId: null,
  updatedAt: new Date("2026-03-24T12:00:00Z"),
  executionWorkspaceId: null,
  labels: [],
  labelIds: [],
};

const projectGoal = {
  id: "44444444-4444-4444-8444-444444444444",
  companyId: "company-1",
  title: "Launch the company",
  description: null,
  level: "company",
  status: "active",
  parentId: null,
  ownerAgentId: null,
  createdAt: new Date("2026-03-20T00:00:00Z"),
  updatedAt: new Date("2026-03-20T00:00:00Z"),
};

describe("issue goal context routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssueService.getById.mockResolvedValue(legacyProjectLinkedIssue);
    mockIssueService.getAncestors.mockResolvedValue([]);
    mockIssueService.findMentionedProjectIds.mockResolvedValue([]);
    mockIssueService.getCommentCursor.mockResolvedValue({
      totalComments: 0,
      latestCommentId: null,
      latestCommentAt: null,
    });
    mockIssueService.getComment.mockResolvedValue(null);
    mockIssueService.create.mockResolvedValue({
      ...legacyProjectLinkedIssue,
      id: "99999999-9999-4999-8999-999999999999",
      identifier: "PAP-999",
      title: "Created issue",
      goalId: null,
      originKind: "manual",
      originId: null,
      originRunId: null,
      createdByAgentId: null,
      createdByUserId: "local-board",
      createdAt: new Date("2026-03-24T12:00:00Z"),
    });
    mockProjectService.getById.mockResolvedValue({
      id: legacyProjectLinkedIssue.projectId,
      companyId: "company-1",
      urlKey: "onboarding",
      goalId: projectGoal.id,
      goalIds: [projectGoal.id],
      goals: [{ id: projectGoal.id, title: projectGoal.title }],
      name: "Onboarding",
      description: null,
      status: "in_progress",
      leadAgentId: null,
      targetDate: null,
      color: null,
      pauseReason: null,
      pausedAt: null,
      executionWorkspacePolicy: null,
      codebase: {
        workspaceId: null,
        repoUrl: null,
        repoRef: null,
        defaultRef: null,
        repoName: null,
        localFolder: null,
        managedFolder: "/tmp/company-1/project-1",
        effectiveLocalFolder: "/tmp/company-1/project-1",
        origin: "managed_checkout",
      },
      workspaces: [],
      primaryWorkspace: null,
      archivedAt: null,
      createdAt: new Date("2026-03-20T00:00:00Z"),
      updatedAt: new Date("2026-03-20T00:00:00Z"),
    });
    mockProjectService.listByIds.mockResolvedValue([]);
    mockProjectIssueStatusService.list.mockResolvedValue([
      {
        value: "todo",
        name: "Todo",
        allowedNextStatusValues: ["in_progress", "done"],
        allowedActors: "human_and_agent",
        isHumanApproval: false,
      },
      {
        value: "in_progress",
        name: "In Progress",
        allowedNextStatusValues: ["done"],
        allowedActors: "agent_only",
        isHumanApproval: false,
      },
    ]);
    mockGoalService.getById.mockImplementation(async (id: string) =>
      id === projectGoal.id ? projectGoal : null,
    );
    mockGoalService.getDefaultCompanyGoal.mockResolvedValue(null);
  });

  it("surfaces the project goal from GET /issues/:id when the issue has no direct goal", async () => {
    const res = await request(createApp()).get("/api/issues/11111111-1111-4111-8111-111111111111");

    expect(res.status).toBe(200);
    expect(res.body.goalId).toBe(projectGoal.id);
    expect(res.body.goal).toEqual(
      expect.objectContaining({
        id: projectGoal.id,
        title: projectGoal.title,
      }),
    );
    expect(mockGoalService.getDefaultCompanyGoal).not.toHaveBeenCalled();
  });

  it("surfaces the project goal from GET /issues/:id/heartbeat-context", async () => {
    const res = await request(createApp()).get(
      "/api/issues/11111111-1111-4111-8111-111111111111/heartbeat-context",
    );

    expect(res.status).toBe(200);
    expect(res.body.issue.goalId).toBe(projectGoal.id);
    expect(res.body.goal).toEqual(
      expect.objectContaining({
        id: projectGoal.id,
        title: projectGoal.title,
      }),
    );
    expect(res.body.issue.statusMeaning).toBe("Todo (API key: todo)");
    expect(res.body.projectWorkflow).toEqual({
      statusMeaning: "Todo (API key: todo)",
      currentStage: {
        value: "todo",
        name: "Todo",
        description: null,
        agentInstructions: null,
        capabilityTags: [],
        allowedNextStatusValues: ["in_progress", "done"],
        allowedActors: "human_and_agent",
        isHumanApproval: false,
      },
      checkoutStage: {
        value: "todo",
        name: "Todo",
        allowedActors: "human_and_agent",
      },
      allowedNextStages: [
        { value: "in_progress", name: "In Progress" },
        { value: "done", name: "done" },
      ],
      allowedCheckoutStatuses: ["todo", "in_progress"],
    });
    expect(mockGoalService.getDefaultCompanyGoal).not.toHaveBeenCalled();
  });

  it("rejects manual create without projectId", async () => {
    const res = await request(createApp()).post("/api/companies/company-1/issues").send({
      title: "Unscoped task",
      status: "todo",
      priority: "medium",
    });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Manual task creation requires a projectId.");
    expect(res.body.details).toEqual({ field: "projectId" });
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });

  it("creates issue when projectId is provided", async () => {
    const res = await request(createApp()).post("/api/companies/company-1/issues").send({
      title: "Scoped task",
      status: "todo",
      priority: "medium",
      projectId: legacyProjectLinkedIssue.projectId,
    });

    expect(res.status).toBe(201);
    expect(res.body.projectId).toBe(legacyProjectLinkedIssue.projectId);
    expect(mockIssueService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({
        title: "Scoped task",
        projectId: legacyProjectLinkedIssue.projectId,
      }),
    );
  });
});
