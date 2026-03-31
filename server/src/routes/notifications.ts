import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { forbidden, unauthorized } from "../errors.js";
import { notificationService } from "../services/index.js";

function requireSessionUser(req: Request) {
  if (req.actor.type !== "board" || req.actor.source !== "session" || !req.actor.userId) {
    throw unauthorized();
  }
  return req.actor.userId;
}

function assertInstanceAdmin(req: Request) {
  if (req.actor.type !== "board") throw forbidden("Board access required");
  if (req.actor.source === "local_implicit" || req.actor.isInstanceAdmin) return;
  throw forbidden("Instance admin access required");
}

export function notificationRoutes(db: Db) {
  const router = Router();
  const svc = notificationService(db);

  router.get("/notifications/me", async (req, res) => {
    const userId = requireSessionUser(req);
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 100) : 30;
    const rows = await svc.listForUser(userId, limit);
    res.json(rows);
  });

  router.get("/notifications/me/unread-count", async (req, res) => {
    const userId = requireSessionUser(req);
    const count = await svc.countUnreadForUser(userId);
    res.json({ count });
  });

  router.post("/notifications/me/:id/read", async (req, res) => {
    const userId = requireSessionUser(req);
    const id = req.params.id as string;
    const row = await svc.markRead(userId, id);
    if (!row) {
      res.status(404).json({ error: "Notification not found" });
      return;
    }
    res.json(row);
  });

  router.post("/notifications/me/read-all", async (req, res) => {
    const userId = requireSessionUser(req);
    await svc.markAllRead(userId);
    res.json({ ok: true });
  });

  router.get("/instance/notifications", async (req, res) => {
    assertInstanceAdmin(req);
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(Math.floor(limitRaw), 500) : 200;
    const rows = await svc.listForInstance(limit);
    res.json(rows);
  });

  return router;
}
