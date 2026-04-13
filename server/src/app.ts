import express, { Router, type Request as ExpressRequest } from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { authSessions, authUsers, instanceUserRoles, type Db } from "@paperclipai/db";
import { and, eq } from "drizzle-orm";
import type { DeploymentExposure, DeploymentMode } from "@paperclipai/shared";
import type { StorageService } from "./storage/types.js";
import { httpLogger, errorHandler } from "./middleware/index.js";
import { actorMiddleware } from "./middleware/auth.js";
import { boardMutationGuard } from "./middleware/board-mutation-guard.js";
import { privateHostnameGuard, resolvePrivateHostnameAllowSet } from "./middleware/private-hostname-guard.js";
import { healthRoutes } from "./routes/health.js";
import { companyRoutes } from "./routes/companies.js";
import { companySkillRoutes } from "./routes/company-skills.js";
import { agentRoutes } from "./routes/agents.js";
import { projectRoutes } from "./routes/projects.js";
import { issueRoutes } from "./routes/issues.js";
import { routineRoutes } from "./routes/routines.js";
import { executionWorkspaceRoutes } from "./routes/execution-workspaces.js";
import { goalRoutes } from "./routes/goals.js";
import { approvalRoutes } from "./routes/approvals.js";
import { secretRoutes } from "./routes/secrets.js";
import { costRoutes } from "./routes/costs.js";
import { activityRoutes } from "./routes/activity.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { sidebarBadgeRoutes } from "./routes/sidebar-badges.js";
import { instanceSettingsRoutes } from "./routes/instance-settings.js";
import { llmRoutes } from "./routes/llms.js";
import { assetRoutes } from "./routes/assets.js";
import { accessRoutes } from "./routes/access.js";
import { userNotificationPreferencesRoutes } from "./routes/user-notification-preferences.js";
import { notificationRoutes } from "./routes/notifications.js";
import { pluginRoutes } from "./routes/plugins.js";
import { pluginUiStaticRoutes } from "./routes/plugin-ui-static.js";
import { applyUiBranding, buildSiteWebManifest } from "./ui-branding.js";
import { logger } from "./middleware/logger.js";
import { DEFAULT_LOCAL_PLUGIN_DIR, pluginLoader } from "./services/plugin-loader.js";
import { createPluginWorkerManager } from "./services/plugin-worker-manager.js";
import { createPluginJobScheduler } from "./services/plugin-job-scheduler.js";
import { pluginJobStore } from "./services/plugin-job-store.js";
import { createPluginToolDispatcher } from "./services/plugin-tool-dispatcher.js";
import { pluginLifecycleManager } from "./services/plugin-lifecycle.js";
import { createPluginJobCoordinator } from "./services/plugin-job-coordinator.js";
import { buildHostServices, flushPluginLogBuffer } from "./services/plugin-host-services.js";
import { createPluginEventBus } from "./services/plugin-event-bus.js";
import { setPluginEventBus } from "./services/activity-log.js";
import { createPluginDevWatcher } from "./services/plugin-dev-watcher.js";
import { createPluginHostServiceCleanup } from "./services/plugin-host-service-cleanup.js";
import { pluginRegistryService } from "./services/plugin-registry.js";
import { createHostClientHandlers } from "@paperclipai/plugin-sdk";
import type { BetterAuthSessionResult } from "./auth/better-auth.js";

type UiMode = "none" | "static" | "vite-dev";
const FEEDBACK_EXPORT_FLUSH_INTERVAL_MS = 5_000;

export function resolveViteHmrPort(serverPort: number): number {
  if (serverPort <= 55_535) {
    return serverPort + 10_000;
  }
  return Math.max(1_024, serverPort - 10_000);
}

export async function createApp(
  db: Db,
  opts: {
    uiMode: UiMode;
    serverPort: number;
    storageService: StorageService;
    feedbackExportService?: {
      flushPendingFeedbackTraces(input?: {
        companyId?: string;
        traceId?: string;
        limit?: number;
        now?: Date;
      }): Promise<unknown>;
    };
    deploymentMode: DeploymentMode;
    deploymentExposure: DeploymentExposure;
    allowedHostnames: string[];
    bindHost: string;
    authReady: boolean;
    companyDeletionEnabled: boolean;
    instanceId?: string;
    hostVersion?: string;
    localPluginDir?: string;
    betterAuthHandler?: express.RequestHandler;
    resolveSession?: (req: ExpressRequest) => Promise<BetterAuthSessionResult | null>;
    requestPasswordReset?: (input: { email: string; redirectTo?: string; callbackURL?: string }) => Promise<void>;
    changePassword?: (input: { userId: string; newPassword: string }) => Promise<void>;
  },
) {
  const app = express();

  app.use(express.json({
    // Company import/export payloads can inline full portable packages.
    limit: "10mb",
    verify: (req, _res, buf) => {
      (req as unknown as { rawBody: Buffer }).rawBody = buf;
    },
  }));
  app.use(httpLogger);
  const privateHostnameGateEnabled =
    opts.deploymentMode === "authenticated" && opts.deploymentExposure === "private";
  const privateHostnameAllowSet = resolvePrivateHostnameAllowSet({
    allowedHostnames: opts.allowedHostnames,
    bindHost: opts.bindHost,
  });
  app.use(
    privateHostnameGuard({
      enabled: privateHostnameGateEnabled,
      allowedHostnames: opts.allowedHostnames,
      bindHost: opts.bindHost,
    }),
  );
  app.use(
    actorMiddleware(db, {
      deploymentMode: opts.deploymentMode,
      resolveSession: opts.resolveSession,
    }),
  );
  app.get("/api/auth/get-session", async (req, res) => {
    if (req.actor.type !== "board" || !req.actor.userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    let name: string | null = null;
    let email: string | null = null;
    let mustChangePassword = false;
    if (db) {
      const [userRow, mustChangeRow] = await Promise.all([
        db
          .select({ name: authUsers.name, email: authUsers.email })
          .from(authUsers)
          .where(eq(authUsers.id, req.actor.userId))
          .then((rows) => rows[0] ?? null),
        db
          .select({ id: instanceUserRoles.id })
          .from(instanceUserRoles)
          .where(and(eq(instanceUserRoles.userId, req.actor.userId), eq(instanceUserRoles.role, "must_change_password")))
          .then((rows) => rows[0] ?? null),
      ]);
      if (userRow) {
        name = userRow.name;
        email = userRow.email;
      }
      mustChangePassword = Boolean(mustChangeRow);
    }
    if (name === null && req.actor.source === "local_implicit") {
      name = "Local Board";
    }
    res.json({
      session: {
        id: `paperclip:${req.actor.source}:${req.actor.userId}`,
        userId: req.actor.userId,
      },
      user: { id: req.actor.userId, email, name, mustChangePassword },
    });
  });

  app.post("/api/auth/logout", async (req, res) => {
    if (req.actor.type !== "board" || !req.actor.userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    // Force-revoke active sessions for this user so logout works even if
    // Better Auth sign-out route is unavailable or fails in the current setup.
    if (opts.deploymentMode === "authenticated") {
      await db.delete(authSessions).where(eq(authSessions.userId, req.actor.userId));
    }

    res.json({ status: true });
  });

  // local_trusted has no Better Auth HTTP routes; still expose profile updates for the implicit board principal.
  if (opts.deploymentMode === "local_trusted") {
    const simpleEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    app.post("/api/auth/update-user", async (req, res) => {
      if (req.actor.type !== "board" || !req.actor.userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        res.status(400).json({ message: "Invalid body" });
        return;
      }
      if ("email" in body && body.email !== undefined) {
        res.status(400).json({ message: "Email cannot be updated via this endpoint" });
        return;
      }
      const name = typeof body.name === "string" ? body.name.trim() : undefined;
      if (name === undefined) {
        res.status(400).json({ message: "No fields to update" });
        return;
      }
      if (!name) {
        res.status(400).json({ message: "Name cannot be empty" });
        return;
      }
      const now = new Date();
      const updated = await db
        .update(authUsers)
        .set({ name, updatedAt: now })
        .where(eq(authUsers.id, req.actor.userId))
        .returning({ id: authUsers.id })
        .then((rows) => rows[0] ?? null);
      if (!updated) {
        res.status(404).json({ message: "User not found" });
        return;
      }
      res.json({ status: true });
    });
    app.post("/api/auth/change-email", async (req, res) => {
      if (req.actor.type !== "board" || !req.actor.userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      const raw = req.body?.newEmail;
      const newEmail = typeof raw === "string" ? raw.trim().toLowerCase() : "";
      if (!newEmail || !simpleEmail.test(newEmail)) {
        res.status(400).json({ message: "Invalid email address" });
        return;
      }
      const current = await db
        .select({ email: authUsers.email })
        .from(authUsers)
        .where(eq(authUsers.id, req.actor.userId))
        .then((rows) => rows[0] ?? null);
      if (!current) {
        res.status(404).json({ message: "User not found" });
        return;
      }
      if (current.email.toLowerCase() === newEmail) {
        res.status(400).json({ message: "Email is the same" });
        return;
      }
      const taken = await db
        .select({ id: authUsers.id })
        .from(authUsers)
        .where(eq(authUsers.email, newEmail))
        .then((rows) => rows[0] ?? null);
      if (taken) {
        res.status(422).json({ message: "User already exists. Use another email." });
        return;
      }
      const now = new Date();
      await db
        .update(authUsers)
        .set({ email: newEmail, updatedAt: now })
        .where(eq(authUsers.id, req.actor.userId));
      res.json({ status: true });
    });
  }

  // Force password change on first login: change password and clear the must_change_password flag
  if (opts.changePassword) {
    app.post("/api/auth/complete-password-setup", async (req: express.Request, res: express.Response) => {
      if (req.actor.type !== "board" || !req.actor.userId) {
        res.status(401).json({ message: "Unauthorized" });
        return;
      }
      const newPassword = typeof req.body?.newPassword === "string" ? req.body.newPassword : "";
      if (newPassword.length < 8) {
        res.status(400).json({ message: "Password must be at least 8 characters." });
        return;
      }
      try {
        await opts.changePassword!({ userId: req.actor.userId, newPassword });
        // Clear the must_change_password flag
        if (db) {
          await db
            .delete(instanceUserRoles)
            .where(and(eq(instanceUserRoles.userId, req.actor.userId), eq(instanceUserRoles.role, "must_change_password")));
        }
        res.json({ status: true });
      } catch (error) {
        logger.error({ error }, "complete-password-setup failed");
        res.status(500).json({ message: "Failed to update password." });
      }
    });
  }

  if (opts.requestPasswordReset) {
    const requestPasswordResetHandler = async (req: express.Request, res: express.Response) => {
      const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
      if (!email) {
        res.status(400).json({ message: "email is required" });
        return;
      }
      if (db) {
        const userExists = await db
          .select({ id: authUsers.id })
          .from(authUsers)
          .where(eq(authUsers.email, email))
          .then((rows) => rows[0] ?? null);
        if (!userExists) {
          res.json({ status: true });
          return;
        }
      }
      const redirectTo =
        typeof req.body?.redirectTo === "string" ? req.body.redirectTo : undefined;
      const callbackURL =
        typeof req.body?.callbackURL === "string" ? req.body.callbackURL : undefined;
      try {
        await opts.requestPasswordReset!({ email, redirectTo, callbackURL });
        res.json({ status: true });
      } catch (error) {
        logger.error(
          { error, endpoint: req.path },
          "password reset request failed in compatibility endpoint",
        );
        res.status(500).json({ message: "Failed to request password reset" });
      }
    };
    app.post("/api/auth/request-password-reset", requestPasswordResetHandler);
    app.post("/api/auth/forget-password", requestPasswordResetHandler);
    app.post("/api/auth/forgot-password", requestPasswordResetHandler);
  }

  // Validate existing account before sending sign-in OTP.
  app.post("/api/auth/email-otp/send-verification-otp", async (req, res, next) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim().toLowerCase() : "";
    if (!email) {
      res.status(400).json({ message: "Email is required." });
      return;
    }
    if (!db) {
      next();
      return;
    }
    const existingUser = await db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.email, email))
      .then((rows) => rows[0] ?? null);
    if (!existingUser) {
      res.json({ status: true });
      return;
    }
    const mustChangePassword = await db
      .select({ id: instanceUserRoles.id })
      .from(instanceUserRoles)
      .where(and(eq(instanceUserRoles.userId, existingUser.id), eq(instanceUserRoles.role, "must_change_password")))
      .then((rows) => rows[0] ?? null);
    if (mustChangePassword) {
      // Do not send OTP until initial temporary password setup is completed.
      res.json({ status: true });
      return;
    }
    req.body.email = email;
    next();
  });

  if (opts.betterAuthHandler) {
    app.all("/api/auth/{*authPath}", opts.betterAuthHandler);
  }
  app.use(llmRoutes(db));

  // Mount API routes
  const api = Router();
  api.use(boardMutationGuard());
  api.use(
    "/health",
    healthRoutes(db, {
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      authReady: opts.authReady,
      companyDeletionEnabled: opts.companyDeletionEnabled,
    }),
  );
  api.use("/companies", companyRoutes(db, opts.storageService));
  api.use(companySkillRoutes(db));
  api.use(agentRoutes(db));
  api.use(assetRoutes(db, opts.storageService));
  api.use(projectRoutes(db));
  api.use(issueRoutes(db, opts.storageService));
  api.use(routineRoutes(db));
  api.use(executionWorkspaceRoutes(db));
  api.use(goalRoutes(db));
  api.use(approvalRoutes(db));
  api.use(secretRoutes(db));
  api.use(costRoutes(db));
  api.use(activityRoutes(db));
  api.use(dashboardRoutes(db));
  api.use(sidebarBadgeRoutes(db));
  api.use(instanceSettingsRoutes(db));
  const hostServicesDisposers = new Map<string, () => void>();
  const workerManager = createPluginWorkerManager();
  const pluginRegistry = pluginRegistryService(db);
  const eventBus = createPluginEventBus();
  setPluginEventBus(eventBus);
  const jobStore = pluginJobStore(db);
  const lifecycle = pluginLifecycleManager(db, { workerManager });
  const scheduler = createPluginJobScheduler({
    db,
    jobStore,
    workerManager,
  });
  const toolDispatcher = createPluginToolDispatcher({
    workerManager,
    lifecycleManager: lifecycle,
    db,
  });
  const jobCoordinator = createPluginJobCoordinator({
    db,
    lifecycle,
    scheduler,
    jobStore,
  });
  const hostServiceCleanup = createPluginHostServiceCleanup(lifecycle, hostServicesDisposers);
  const loader = pluginLoader(
    db,
    { localPluginDir: opts.localPluginDir ?? DEFAULT_LOCAL_PLUGIN_DIR },
    {
      workerManager,
      eventBus,
      jobScheduler: scheduler,
      jobStore,
      toolDispatcher,
      lifecycleManager: lifecycle,
      instanceInfo: {
        instanceId: opts.instanceId ?? "default",
        hostVersion: opts.hostVersion ?? "0.0.0",
      },
      buildHostHandlers: (pluginId, manifest) => {
        const notifyWorker = (method: string, params: unknown) => {
          const handle = workerManager.getWorker(pluginId);
          if (handle) handle.notify(method, params);
        };
        const services = buildHostServices(db, pluginId, manifest.id, eventBus, notifyWorker);
        hostServicesDisposers.set(pluginId, () => services.dispose());
        return createHostClientHandlers({
          pluginId,
          capabilities: manifest.capabilities,
          services,
        });
      },
    },
  );
  api.use(
    pluginRoutes(
      db,
      loader,
      { scheduler, jobStore },
      { workerManager },
      { toolDispatcher },
      { workerManager },
    ),
  );
  api.use(
    accessRoutes(db, {
      deploymentMode: opts.deploymentMode,
      deploymentExposure: opts.deploymentExposure,
      bindHost: opts.bindHost,
      allowedHostnames: opts.allowedHostnames,
    }),
  );
  api.use(userNotificationPreferencesRoutes(db));
  api.use(notificationRoutes(db));
  app.use("/api", api);
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found" });
  });
  app.use(pluginUiStaticRoutes(db, {
    localPluginDir: opts.localPluginDir ?? DEFAULT_LOCAL_PLUGIN_DIR,
  }));
  app.get("/site.webmanifest", (_req, res) => {
    res
      .status(200)
      .type("application/manifest+json")
      .send(JSON.stringify(buildSiteWebManifest(process.env)));
  });

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  if (opts.uiMode === "static") {
    // Try published location first (server/ui-dist/), then monorepo dev location (../../ui/dist)
    const candidates = [
      path.resolve(__dirname, "../ui-dist"),
      path.resolve(__dirname, "../../ui/dist"),
    ];
    const uiDist = candidates.find((p) => fs.existsSync(path.join(p, "index.html")));
    if (uiDist) {
      const indexHtml = applyUiBranding(fs.readFileSync(path.join(uiDist, "index.html"), "utf-8"));
      app.use(express.static(uiDist));
      app.get(/.*/, (_req, res) => {
        res.status(200).set("Content-Type", "text/html").end(indexHtml);
      });
    } else {
      console.warn("[paperclip] UI dist not found; running in API-only mode");
    }
  }

  if (opts.uiMode === "vite-dev") {
    const uiRoot = path.resolve(__dirname, "../../ui");
    const hmrPort = resolveViteHmrPort(opts.serverPort);
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: uiRoot,
      appType: "custom",
      server: {
        middlewareMode: true,
        hmr: {
          host: opts.bindHost,
          port: hmrPort,
          clientPort: hmrPort,
        },
        allowedHosts: privateHostnameGateEnabled ? Array.from(privateHostnameAllowSet) : undefined,
      },
    });

    app.use(vite.middlewares);
    app.get(/.*/, async (req, res, next) => {
      try {
        const templatePath = path.resolve(uiRoot, "index.html");
        const template = fs.readFileSync(templatePath, "utf-8");
        const html = applyUiBranding(await vite.transformIndexHtml(req.originalUrl, template));
        res.status(200).set({ "Content-Type": "text/html" }).end(html);
      } catch (err) {
        next(err);
      }
    });
  }

  app.use(errorHandler);

  jobCoordinator.start();
  scheduler.start();
  const feedbackExportTimer = opts.feedbackExportService
    ? setInterval(() => {
      void opts.feedbackExportService?.flushPendingFeedbackTraces().catch((err) => {
        logger.error({ err }, "Failed to flush pending feedback exports");
      });
    }, FEEDBACK_EXPORT_FLUSH_INTERVAL_MS)
    : null;
  feedbackExportTimer?.unref?.();
  if (opts.feedbackExportService) {
    void opts.feedbackExportService.flushPendingFeedbackTraces().catch((err) => {
      logger.error({ err }, "Failed to flush pending feedback exports");
    });
  }
  void toolDispatcher.initialize().catch((err) => {
    logger.error({ err }, "Failed to initialize plugin tool dispatcher");
  });
  const devWatcher = opts.uiMode === "vite-dev"
    ? createPluginDevWatcher(
      lifecycle,
      async (pluginId) => (await pluginRegistry.getById(pluginId))?.packagePath ?? null,
    )
    : null;
  void loader.loadAll().then((result) => {
    if (!result) return;
    for (const loaded of result.results) {
      if (devWatcher && loaded.success && loaded.plugin.packagePath) {
        devWatcher.watch(loaded.plugin.id, loaded.plugin.packagePath);
      }
    }
  }).catch((err) => {
    logger.error({ err }, "Failed to load ready plugins on startup");
  });
  process.once("exit", () => {
    if (feedbackExportTimer) clearInterval(feedbackExportTimer);
    devWatcher?.close();
    hostServiceCleanup.disposeAll();
    hostServiceCleanup.teardown();
  });
  process.once("beforeExit", () => {
    void flushPluginLogBuffer();
  });

  return app;
}
