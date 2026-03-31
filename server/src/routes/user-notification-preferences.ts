import { Router, type Request } from "express";
import type { Db } from "@paperclipai/db";
import { updateUserNotificationPreferencesSchema } from "@paperclipai/shared";
import { unauthorized } from "../errors.js";
import { validate } from "../middleware/validate.js";
import { userNotificationPreferencesService } from "../services/index.js";

export function userNotificationPreferencesRoutes(db: Db) {
  const router = Router();
  const svc = userNotificationPreferencesService(db);

  function requireSessionUserId(req: Request) {
    if (req.actor.type !== "board" || !req.actor.userId || req.actor.source !== "session") {
      throw unauthorized();
    }
    return req.actor.userId;
  }

  router.get("/users/me/notification-preferences", async (req, res) => {
    const userId = requireSessionUserId(req);
    const prefs = await svc.getByUserId(userId);
    res.json(prefs);
  });

  router.patch(
    "/users/me/notification-preferences",
    validate(updateUserNotificationPreferencesSchema),
    async (req, res) => {
      const userId = requireSessionUserId(req);
      const prefs = await svc.upsertByUserId(userId, req.body);
      res.json(prefs);
    },
  );

  return router;
}
