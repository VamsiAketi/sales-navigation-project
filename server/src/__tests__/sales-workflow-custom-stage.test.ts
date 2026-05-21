import { randomUUID } from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  applyPendingMigrations,
  companies,
  companyMemberships,
  createDb,
  ensurePostgresDatabase,
  heartbeatRuns,
  issues,
  projectIssueStatuses,
  projects,
} from "@paperclipai/db";
import { issueService } from "../services/issues.ts";
import { projectDataService } from "../services/project-data.ts";

type EmbeddedPostgresInstance = {
  initialise(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
};

type EmbeddedPostgresCtor = new (opts: {
  databaseDir: string;
  user: string;
  password: string;
  port: number;
  persistent: boolean;
  initdbFlags?: string[];
  onLog?: (message: unknown) => void;
  onError?: (message: unknown) => void;
}) => EmbeddedPostgresInstance;

async function getEmbeddedPostgresCtor(): Promise<EmbeddedPostgresCtor> {
  const mod = await import("embedded-postgres");
  return mod.default as EmbeddedPostgresCtor;
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to allocate test port")));
        return;
      }
      const { port } = address;
      server.close((error) => {
        if (error) reject(error);
        else resolve(port);
      });
    });
  });
}

async function startTempDatabase() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "paperclip-sales-custom-stage-"));
  const port = await getAvailablePort();
  const EmbeddedPostgres = await getEmbeddedPostgresCtor();
  const instance = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: "paperclip",
    password: "paperclip",
    port,
    persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C", "--lc-messages=C"],
    onLog: () => {},
    onError: () => {},
  });
  await instance.initialise();
  await instance.start();

  const adminConnectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/postgres`;
  await ensurePostgresDatabase(adminConnectionString, "paperclip");
  const connectionString = `postgres://paperclip:paperclip@127.0.0.1:${port}/paperclip`;
  await applyPendingMigrations(connectionString);
  return { connectionString, dataDir, instance };
}

describe("sales pipeline custom-stage execution", () => {
  let db!: ReturnType<typeof createDb>;
  let issuesSvc!: ReturnType<typeof issueService>;
  let projectDataSvc!: ReturnType<typeof projectDataService>;
  let instance: EmbeddedPostgresInstance | null = null;
  let dataDir = "";

  beforeAll(async () => {
    const started = await startTempDatabase();
    db = createDb(started.connectionString);
    issuesSvc = issueService(db);
    projectDataSvc = projectDataService(db);
    instance = started.instance;
    dataDir = started.dataDir;
  }, 20_000);

  afterEach(async () => {
    await db.delete(issues);
    await db.delete(heartbeatRuns);
    await db.delete(projectIssueStatuses);
    await db.delete(projects);
    await db.delete(companyMemberships);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await instance?.stop();
    if (dataDir) {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("preserves custom stage on checkout, hands off assignee on transition, and writes project data rows", async () => {
    const companyId = randomUUID();
    const projectId = randomUUID();
    const generatorAgentId = randomUUID();
    const verifierAgentId = randomUUID();
    const issueId = randomUUID();

    await db.insert(companies).values({
      id: companyId,
      name: "SalesCo",
      issuePrefix: `S${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });

    await db.insert(agents).values([
      {
        id: generatorAgentId,
        companyId,
        name: "Lead Generator",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
      {
        id: verifierAgentId,
        companyId,
        name: "Lead Verifier",
        role: "engineer",
        status: "active",
        adapterType: "codex_local",
        adapterConfig: {},
        runtimeConfig: {},
        permissions: {},
      },
    ]);

    await db.insert(companyMemberships).values([
      {
        companyId,
        principalType: "agent",
        principalId: generatorAgentId,
        status: "active",
      },
      {
        companyId,
        principalType: "agent",
        principalId: verifierAgentId,
        status: "active",
      },
    ]);

    await db.insert(projects).values({
      id: projectId,
      companyId,
      name: "Sales Pipeline",
    });

    await db.insert(projectIssueStatuses).values([
      {
        projectId,
        companyId,
        name: "Generate Lead",
        value: "generate_lead",
        color: "#2563eb",
        position: 0,
        allowedActors: "agent_only",
        defaultAssigneeAgentId: generatorAgentId,
        allowedNextStatusValues: ["verify_leads"],
      },
      {
        projectId,
        companyId,
        name: "Verify Leads",
        value: "verify_leads",
        color: "#16a34a",
        position: 1,
        allowedActors: "agent_only",
        defaultAssigneeAgentId: verifierAgentId,
        allowedNextStatusValues: ["done"],
      },
    ]);

    await db.insert(issues).values({
      id: issueId,
      companyId,
      projectId,
      title: "Find leads for ACME",
      status: "generate_lead",
      priority: "high",
      assigneeAgentId: generatorAgentId,
    });

    const checkoutRun1 = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: checkoutRun1,
      companyId,
      agentId: generatorAgentId,
      status: "running",
      invocationSource: "event",
      triggerDetail: "test",
      startedAt: new Date(),
    });
    const checkedOutGenerate = await issuesSvc.checkout(
      issueId,
      generatorAgentId,
      ["generate_lead"],
      checkoutRun1,
    );
    expect(checkedOutGenerate.status).toBe("generate_lead");
    expect(checkedOutGenerate.checkoutRunId).toBe(checkoutRun1);
    expect(checkedOutGenerate.executionRunId).toBe(checkoutRun1);

    await projectDataSvc.createTable({
      projectId,
      payload: {
        name: "leads",
        columns: [
          { name: "id", type: "uuid", nullable: false },
          { name: "issue_id", type: "uuid", nullable: false },
          { name: "email", type: "text", nullable: false },
          { name: "verified", type: "bool", default: "false" },
        ],
        primaryKey: ["id"],
      },
    });

    await projectDataSvc.insertRows({
      projectId,
      table: "leads",
      rows: [
        { id: randomUUID(), issue_id: issueId, email: "a@acme.com", verified: false },
        { id: randomUUID(), issue_id: issueId, email: "b@acme.com", verified: false },
      ],
    });

    const queried = await projectDataSvc.queryData({
      projectId,
      payload: {
        ref: { kind: "table", name: "leads" },
        filters: [{ column: "issue_id", op: "eq", value: issueId }],
        limit: 10,
        offset: 0,
      },
    });
    expect(queried.rows).toHaveLength(2);

    const handoff = await issuesSvc.update(issueId, { status: "verify_leads" });
    expect(handoff).not.toBeNull();
    expect(handoff!.status).toBe("verify_leads");
    expect(handoff!.assigneeAgentId).toBe(verifierAgentId);
    expect(handoff!.checkoutRunId).toBeNull();
    expect(handoff!.executionRunId).toBeNull();

    const checkoutRun2 = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: checkoutRun2,
      companyId,
      agentId: verifierAgentId,
      status: "running",
      invocationSource: "event",
      triggerDetail: "test",
      startedAt: new Date(),
    });
    const checkedOutVerify = await issuesSvc.checkout(
      issueId,
      verifierAgentId,
      ["verify_leads"],
      checkoutRun2,
    );
    expect(checkedOutVerify.status).toBe("verify_leads");
    expect(checkedOutVerify.checkoutRunId).toBe(checkoutRun2);

    const released = await issuesSvc.release(issueId, verifierAgentId, checkoutRun2);
    expect(released).not.toBeNull();
    expect(released!.status).toBe("verify_leads");
    expect(released!.assigneeAgentId).toBe(verifierAgentId);
    expect(released!.checkoutRunId).toBeNull();

    const checkoutRun3 = randomUUID();
    await db.insert(heartbeatRuns).values({
      id: checkoutRun3,
      companyId,
      agentId: verifierAgentId,
      status: "running",
      invocationSource: "event",
      triggerDetail: "test",
      startedAt: new Date(),
    });
    await issuesSvc.checkout(issueId, verifierAgentId, ["verify_leads"], checkoutRun3);
    const completed = await issuesSvc.update(issueId, { status: "done" });
    expect(completed).not.toBeNull();
    expect(completed!.status).toBe("done");
    expect(completed!.checkoutRunId).toBeNull();
    expect(completed!.executionRunId).toBeNull();
  });
});
