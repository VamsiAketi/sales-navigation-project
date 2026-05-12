import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import {
  connectorInboundEventSchema,
  createConnectorConnectionSchema,
  createConnectorEventBindingSchema,
  updateConnectorConnectionSchema,
  updateConnectorEventBindingSchema,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { accessService, connectorService, logActivity } from "../services/index.js";
import { forbidden } from "../errors.js";

export function connectorRoutes(db: Db) {
  const router = Router();
  const svc = connectorService(db);
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

  router.get("/connectors/catalog", async (_req, res) => {
    res.json(svc.listCatalog());
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
