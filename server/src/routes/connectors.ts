import { Router, type Request, type Response } from "express";
import type { Db } from "@paperclipai/db";
import {
  connectorExecuteActionBodySchema,
  connectorInboundEventSchema,
  createConnectorConnectionSchema,
  createConnectorEventBindingSchema,
  updateConnectorConnectionSchema,
  updateConnectorEventBindingSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { loadConfig } from "../config.js";
import { assertBoard, assertCompanyAccess, getActorInfo } from "./authz.js";
import { accessService, connectorService, gmailConnectorService, outlookConnectorService, logActivity } from "../services/index.js";
import { forbidden, unauthorized, unprocessable } from "../errors.js";

const GMAIL_OAUTH_POPUP_MESSAGE_TYPE = "paperclip:gmail-oauth";

type GmailOAuthPopupResult = {
  status: "connected" | "error";
  connectionId?: string;
};

function sendGmailOAuthPopupResult(res: Response, result: GmailOAuthPopupResult) {
  const payload = {
    type: GMAIL_OAUTH_POPUP_MESSAGE_TYPE,
    status: result.status,
    ...(result.connectionId ? { connectionId: result.connectionId } : {}),
  };
  const fallbackPath =
    result.status === "connected" && result.connectionId
      ? `/company/connectors?gmail=connected&connectionId=${encodeURIComponent(result.connectionId)}`
      : "/company/connectors?gmail=error";
  const payloadJson = JSON.stringify(payload);
  const fallbackJson = JSON.stringify(fallbackPath);

  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Google sign-in</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; color: #444; }
    </style>
  </head>
  <body>
    <p>Finishing Google sign-in…</p>
    <script>
      (function () {
        var payload = ${payloadJson};
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
          window.close();
          return;
        }
        window.location.replace(${fallbackJson});
      })();
    </script>
  </body>
</html>`);
}

const OUTLOOK_OAUTH_POPUP_MESSAGE_TYPE = "paperclip:outlook-oauth";

type OutlookOAuthPopupResult = {
  status: "connected" | "error";
  connectionId?: string;
};

function sendOutlookOAuthPopupResult(res: Response, result: OutlookOAuthPopupResult) {
  const payload = {
    type: OUTLOOK_OAUTH_POPUP_MESSAGE_TYPE,
    status: result.status,
    ...(result.connectionId ? { connectionId: result.connectionId } : {}),
  };
  const fallbackPath =
    result.status === "connected" && result.connectionId
      ? `/company/connectors?outlook=connected&connectionId=${encodeURIComponent(result.connectionId)}`
      : "/company/connectors?outlook=error";
  const payloadJson = JSON.stringify(payload);
  const fallbackJson = JSON.stringify(fallbackPath);

  res.type("html").send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Microsoft sign-in</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; color: #444; }
    </style>
  </head>
  <body>
    <p>Finishing Microsoft sign-in…</p>
    <script>
      (function () {
        var payload = ${payloadJson};
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage(payload, window.location.origin);
          window.close();
          return;
        }
        window.location.replace(${fallbackJson});
      })();
    </script>
  </body>
</html>`);
}

export function connectorRoutes(db: Db) {
  const router = Router();
  const svc = connectorService(db);
  const config = loadConfig();
  const gmail = gmailConnectorService(db, config);
  const outlook = outlookConnectorService(db, config);
  const access = accessService(db);

  async function assertCanReadConnectors(req: Request, companyId: string) {
    assertBoard(req);
    assertCompanyAccess(req, companyId);
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
    const allowed = await access.canUser(companyId, req.actor.userId, "connectors.read");
    if (!allowed) throw forbidden("Missing permission: connectors.read");
  }

  async function assertCanManageConnectors(req: Request, companyId: string) {
    await assertCanReadConnectors(req, companyId);
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
    const allowed = await access.canUser(companyId, req.actor.userId, "connectors.manage");
    if (!allowed) throw forbidden("Missing permission: connectors.manage");
  }

  async function assertCanManageBindings(req: Request, companyId: string) {
    await assertCanReadConnectors(req, companyId);
    if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
    const allowed = await access.canUser(companyId, req.actor.userId, "connectors.bindings.manage");
    if (!allowed) throw forbidden("Missing permission: connectors.bindings.manage");
  }

  async function assertCanInvokeConnectorAction(req: Request, companyId: string, connectionId: string) {
    if (req.actor.type === "none") throw unauthorized();
    assertCompanyAccess(req, companyId);
    if (req.actor.type === "board") {
      if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
      const allowed = await access.canUser(companyId, req.actor.userId ?? "", "connectors.manage");
      if (!allowed) throw forbidden("Missing permission: connectors.manage");
      return;
    }
    if (req.actor.type === "agent") {
      if (!req.actor.agentId) throw forbidden("Agent authentication required");
      const ok = await svc.agentHasEnabledBindingForConnection(companyId, connectionId, req.actor.agentId);
      if (!ok) throw forbidden("No enabled connector binding for this agent on this connection");
      return;
    }
    throw unauthorized();
  }

  router.get("/connectors/catalog", async (_req, res) => {
    res.json({
      catalog: svc.listCatalog(),
      gmailOAuthConfigured: gmail.isConfigured(),
      outlookOAuthConfigured: outlook.isConfigured(),
    });
  });

  router.get("/companies/:companyId/connectors", async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanReadConnectors(req, companyId);
    res.json(await svc.listConnections(companyId));
  });

  router.post("/companies/:companyId/connectors", validate(createConnectorConnectionSchema), async (req, res) => {
    const companyId = req.params.companyId as string;
    await assertCanManageConnectors(req, companyId);
    const created = await svc.createConnection(companyId, req.body, req.actor.userId ?? null);
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "connector.connection.created",
      entityType: "connector_connection",
      entityId: created.id,
      details: {
        connectorTypeKey: created.connectorTypeKey,
        name: created.name,
      },
    });
    res.status(201).json(created);
  });

  router.get("/companies/:companyId/connectors/:connectionId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const connectionId = req.params.connectionId as string;
    await assertCanReadConnectors(req, companyId);
    res.json(await svc.getConnection(companyId, connectionId));
  });

  router.patch(
    "/companies/:companyId/connectors/:connectionId",
    validate(updateConnectorConnectionSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const connectionId = req.params.connectionId as string;
      await assertCanManageConnectors(req, companyId);
      const updated = await svc.updateConnection(companyId, connectionId, req.body, req.actor.userId ?? null);
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "connector.connection.updated",
        entityType: "connector_connection",
        entityId: updated.id,
        details: { status: updated.status, name: updated.name },
      });
      res.json(updated);
    },
  );

  router.post("/companies/:companyId/connectors/:connectionId/rotate-inbound-secret", async (req, res) => {
    const companyId = req.params.companyId as string;
    const connectionId = req.params.connectionId as string;
    await assertCanManageConnectors(req, companyId);
    const rotated = await svc.rotateInboundSecret(companyId, connectionId, req.actor.userId ?? null);
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "connector.connection.inbound_secret_rotated",
      entityType: "connector_connection",
      entityId: rotated.id,
      details: {},
    });
    res.json(rotated);
  });

  router.delete("/companies/:companyId/connectors/:connectionId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const connectionId = req.params.connectionId as string;
    await assertCanManageConnectors(req, companyId);
    await svc.deleteConnection(companyId, connectionId);
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "connector.connection.deleted",
      entityType: "connector_connection",
      entityId: connectionId,
      details: {},
    });
    res.json({ ok: true });
  });

  router.get("/companies/:companyId/connectors/:connectionId/bindings", async (req, res) => {
    const companyId = req.params.companyId as string;
    const connectionId = req.params.connectionId as string;
    await assertCanReadConnectors(req, companyId);
    res.json(await svc.listBindings(companyId, connectionId));
  });

  router.post(
    "/companies/:companyId/connectors/:connectionId/bindings",
    validate(createConnectorEventBindingSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const connectionId = req.params.connectionId as string;
      await assertCanManageBindings(req, companyId);
      const created = await svc.createBinding(companyId, connectionId, req.body, req.actor.userId ?? null);
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "connector.binding.created",
        entityType: "connector_event_binding",
        entityId: created.id,
        details: { eventType: created.eventType, agentId: created.agentId },
      });
      res.status(201).json(created);
    },
  );

  router.patch(
    "/companies/:companyId/connectors/:connectionId/bindings/:bindingId",
    validate(updateConnectorEventBindingSchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const bindingId = req.params.bindingId as string;
      await assertCanManageBindings(req, companyId);
      const updated = await svc.updateBinding(companyId, bindingId, req.body, req.actor.userId ?? null);
      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "connector.binding.updated",
        entityType: "connector_event_binding",
        entityId: updated.id,
        details: { enabled: updated.enabled, eventType: updated.eventType },
      });
      res.json(updated);
    },
  );

  router.delete("/companies/:companyId/connectors/:connectionId/bindings/:bindingId", async (req, res) => {
    const companyId = req.params.companyId as string;
    const bindingId = req.params.bindingId as string;
    await assertCanManageBindings(req, companyId);
    await svc.deleteBinding(companyId, bindingId);
    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "connector.binding.deleted",
      entityType: "connector_event_binding",
      entityId: bindingId,
      details: {},
    });
    res.json({ ok: true });
  });

  router.get("/companies/:companyId/connectors/:connectionId/deliveries", async (req, res) => {
    const companyId = req.params.companyId as string;
    const connectionId = req.params.connectionId as string;
    await assertCanReadConnectors(req, companyId);
    const limit = Number(req.query.limit ?? 50);
    res.json(await svc.listDeliveries(companyId, connectionId, Number.isFinite(limit) ? limit : 50));
  });

  router.get("/companies/:companyId/connectors/:connectionId/gmail/oauth-url", async (req, res) => {
    const companyId = req.params.companyId as string;
    const connectionId = req.params.connectionId as string;
    await assertCanManageConnectors(req, companyId);
    res.json(await gmail.getAuthorizationUrl(companyId, connectionId));
  });

  router.get("/connectors/gmail/oauth/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    if (!code || !state) {
      sendGmailOAuthPopupResult(res, { status: "error" });
      return;
    }
    try {
      const result = await gmail.completeOAuthCallback({ code, state });
      sendGmailOAuthPopupResult(res, { status: "connected", connectionId: result.connectionId });
    } catch {
      sendGmailOAuthPopupResult(res, { status: "error" });
    }
  });

  router.post("/companies/:companyId/connectors/:connectionId/gmail/sync", async (req, res) => {
    const companyId = req.params.companyId as string;
    const connectionId = req.params.connectionId as string;
    await assertCanManageConnectors(req, companyId);
    await svc.getConnection(companyId, connectionId);
    res.json(await gmail.syncConnection(connectionId));
  });

  router.get("/companies/:companyId/connectors/:connectionId/outlook/oauth-url", async (req, res) => {
    const companyId = req.params.companyId as string;
    const connectionId = req.params.connectionId as string;
    await assertCanManageConnectors(req, companyId);
    res.json(await outlook.getAuthorizationUrl(companyId, connectionId));
  });

  router.get("/connectors/outlook/oauth/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    if (!code || !state) {
      sendOutlookOAuthPopupResult(res, { status: "error" });
      return;
    }
    try {
      const result = await outlook.completeOAuthCallback({ code, state });
      sendOutlookOAuthPopupResult(res, { status: "connected", connectionId: result.connectionId });
    } catch {
      sendOutlookOAuthPopupResult(res, { status: "error" });
    }
  });

  router.post("/companies/:companyId/connectors/:connectionId/outlook/sync", async (req, res) => {
    const companyId = req.params.companyId as string;
    const connectionId = req.params.connectionId as string;
    await assertCanManageConnectors(req, companyId);
    await svc.getConnection(companyId, connectionId);
    res.json(await outlook.syncConnection(connectionId));
  });

  router.post(
    "/companies/:companyId/connectors/:connectionId/actions",
    validate(connectorExecuteActionBodySchema),
    async (req, res) => {
      const companyId = req.params.companyId as string;
      const connectionId = req.params.connectionId as string;
      await assertCanInvokeConnectorAction(req, companyId, connectionId);
      const conn = await svc.getConnection(companyId, connectionId);
      const body = req.body as { action: string; params?: Record<string, unknown> };
      const result =
        conn.connectorTypeKey === "gmail"
          ? await gmail.executeAction({
              companyId,
              connectionId,
              action: body.action,
              params: body.params ?? {},
            })
          : conn.connectorTypeKey === "outlook"
            ? await outlook.executeAction({
                companyId,
                connectionId,
                action: body.action,
                params: body.params ?? {},
              })
            : null;
      if (!result) {
        throw unprocessable("Connector actions are not implemented for this connection type");
      }
      const actor = getActorInfo(req);
      await logActivity(db, {
        companyId,
        actorType: actor.actorType === "agent" ? "agent" : "user",
        actorId: actor.actorId,
        action: "connector.action.executed",
        entityType: "connector_connection",
        entityId: connectionId,
        runId: actor.runId,
        details: { ...result },
      });
      res.json(result);
    },
  );

  router.post("/connector-inbound/:publicId", validate(connectorInboundEventSchema), async (req, res) => {
    const result = await svc.ingestInbound({
      publicId: req.params.publicId as string,
      authorizationHeader: req.header("authorization"),
      event: req.body,
    });
    res.status(202).json(result);
  });

  return router;
}
