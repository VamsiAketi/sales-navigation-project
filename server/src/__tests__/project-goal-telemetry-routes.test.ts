import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { projectRoutes } from "../routes/projects.js";
import { goalRoutes } from "../routes/goals.js";
import { errorHandler } from "../middleware/index.js";

const mockProjectService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  createWorkspace: vi.fn(),
  resolveByReference: vi.fn(),
}));

const mockGoalService = vi.hoisted(() => ({
  list: vi.fn(),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

const mockWorkspaceOperationService = vi.hoisted(() => ({}));
const mockLogActivity = vi.hoisted(() => vi.fn());
const mockTrackProjectCreated = vi.hoisted(() => vi.fn());
const mockTrackGoalCreated = vi.hoisted(() => vi.fn());
const mockGetTelemetryClient = vi.hoisted(() => vi.fn());

vi.mock("@paperclipai/shared/telemetry", async () => {
  const actual = await vi.importActual<typeof import("@paperclipai/shared/telemetry")>(
    "@paperclipai/shared/telemetry",
  );
  return {
    ...actual,
    trackProjectCreated: mockTrackProjectCreated,
    trackGoalCreated: mockTrackGoalCreated,
  };
});

vi.mock("../telemetry.js", () => ({
  getTelemetryClient: mockGetTelemetryClient,
}));

vi.mock("../services/index.js", () => ({
  accessService: () => ({
    companyUsesRestrictedProjectAccess: vi.fn(async () => false),
    satisfiesProjectPermission: vi.fn(async () => true),
    listProjectIdsVisibleToActor: vi.fn(async () => null),
    seedFullProjectGrantsForUser: vi.fn(async () => undefined),
  }),
  goalService: () => mockGoalService,
  logActivity: mockLogActivity,
  projectIssueStatusService: () => ({
    seedDefaults: vi.fn(async () => undefined),
    listForProject: vi.fn(async () => []),
    reorderForProject: vi.fn(async () => []),
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({})),
    update: vi.fn(async () => ({})),
    reorder: vi.fn(async () => []),
    remove: vi.fn(async () => null),
  }),
  projectContextService: () => ({
    listMaintenanceRequests: vi.fn(async () => []),
    createMaintenanceRequest: vi.fn(async () => ({ request: { id: "req-1", status: "pending" }, queued: false })),
    patchMaintenanceRequest: vi.fn(async () => ({})),
    approveMaintenanceRequest: vi.fn(async () => ({})),
    rejectMaintenanceRequest: vi.fn(async () => ({})),
    dequeueNextMaintenanceRequest: vi.fn(async () => null),
  }),
  projectContextFileService: () => ({
    list: vi.fn(async () => []),
    createFromAsset: vi.fn(async () => ({})),
    setExtractionStatus: vi.fn(async () => ({})),
    listEvents: vi.fn(async () => []),
    remove: vi.fn(async () => null),
  }),
  projectContextBootstrapService: () => ({
    initializeProjectContext: vi.fn(async () => undefined),
    backfillExistingProjects: vi.fn(async () => ({ scanned: 0, initialized: 0 })),
  }),
  projectContextSyncService: () => ({
    dispatchRequestById: vi.fn(async () => null),
    dispatchPendingForProject: vi.fn(async () => null),
    recoverPendingQueueStateOnStartup: vi.fn(async () => undefined),
    tickRetryQueue: vi.fn(async () => 0),
  }),
  heartbeatService: () => ({
    getRun: vi.fn(async () => null),
  }),
  projectDataService: () => ({
    listDataObjects: vi.fn(async () => []),
    createTable: vi.fn(async () => ({})),
    addTableColumn: vi.fn(async () => ({})),
    createViewObject: vi.fn(async () => ({})),
    queryData: vi.fn(async () => ({ rows: [] })),
    insertRows: vi.fn(async () => []),
    updateRowByPk: vi.fn(async () => ({})),
    deleteRowByPk: vi.fn(async () => ({})),
    listViews: vi.fn(async () => []),
    createView: vi.fn(async () => ({})),
    createWidget: vi.fn(async () => ({})),
    listWidgets: vi.fn(async () => []),
    updateWidget: vi.fn(async () => ({})),
    deleteWidget: vi.fn(async () => ({})),
  }),
  documentService: () => ({
    listProjectDocuments: vi.fn(async () => []),
    getProjectDocumentByKey: vi.fn(async () => null),
    upsertProjectDocument: vi.fn(async () => ({})),
    deleteProjectDocument: vi.fn(async () => null),
    listProjectDocumentRevisions: vi.fn(async () => []),
    restoreProjectDocumentRevision: vi.fn(async () => ({})),
  }),
  projectService: () => mockProjectService,
  projectSecretService: () => ({
    list: vi.fn(async () => []),
    create: vi.fn(),
    getById: vi.fn(),
    getByName: vi.fn(),
    resolveSecretValue: vi.fn(),
    rotate: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listProviders: vi.fn(() => []),
  }),
  secretService: () => ({
    create: vi.fn(),
    listForProject: vi.fn(async () => []),
    deleteByName: vi.fn(async () => false),
  }),
  workspaceOperationService: () => mockWorkspaceOperationService,
}));

vi.mock("../services/workspace-runtime.js", () => ({
  startRuntimeServicesForWorkspaceControl: vi.fn(),
  stopRuntimeServicesForProjectWorkspace: vi.fn(),
}));

function createApp(route: ReturnType<typeof projectRoutes> | ReturnType<typeof goalRoutes>) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).actor = {
      type: "board",
      userId: "board-user",
      companyIds: ["company-1"],
      source: "local_implicit",
      isInstanceAdmin: false,
    };
    next();
  });
  app.use("/api", route);
  app.use(errorHandler);
  return app;
}

describe("project and goal telemetry routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTelemetryClient.mockReturnValue({ track: vi.fn() });
    mockProjectService.resolveByReference.mockResolvedValue({ ambiguous: false, project: null });
    mockProjectService.create.mockResolvedValue({
      id: "project-1",
      companyId: "company-1",
      name: "Telemetry project",
      description: null,
      status: "backlog",
    });
    mockGoalService.create.mockResolvedValue({
      id: "goal-1",
      companyId: "company-1",
      title: "Telemetry goal",
      description: null,
      level: "team",
      status: "planned",
    });
    mockLogActivity.mockResolvedValue(undefined);
  });

  it("emits telemetry when a project is created", async () => {
    const res = await request(createApp(projectRoutes({} as any)))
      .post("/api/companies/company-1/projects")
      .send({ name: "Telemetry project" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockTrackProjectCreated).not.toHaveBeenCalled();
  });

  it("emits telemetry when a goal is created", async () => {
    const res = await request(createApp(goalRoutes({} as any)))
      .post("/api/companies/company-1/goals")
      .send({ title: "Telemetry goal", level: "team" });

    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(mockTrackGoalCreated).toHaveBeenCalledWith(expect.anything(), { goalLevel: "team" });
  });
});
