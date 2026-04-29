import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { authPasskeys, type Db } from "@paperclipai/db";

export function authPasskeyRoutes(db: Db) {
  const router = Router();

  router.get("/passkeys", async (req, res) => {
    if (req.actor.type !== "board" || !req.actor.userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const passkeys = await db
      .select({
        id: authPasskeys.id,
        name: authPasskeys.name,
        createdAt: authPasskeys.createdAt,
        deviceType: authPasskeys.deviceType,
        backedUp: authPasskeys.backedUp,
        transports: authPasskeys.transports,
        aaguid: authPasskeys.aaguid,
      })
      .from(authPasskeys)
      .where(eq(authPasskeys.userId, req.actor.userId))
      .orderBy(desc(authPasskeys.createdAt), desc(authPasskeys.id));

    res.json({ passkeys });
  });

  router.delete("/passkeys/:passkeyId", async (req, res) => {
    if (req.actor.type !== "board" || !req.actor.userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const passkeyId = typeof req.params.passkeyId === "string" ? req.params.passkeyId.trim() : "";
    if (!passkeyId) {
      res.status(400).json({ message: "Passkey id is required." });
      return;
    }

    const deleted = await db
      .delete(authPasskeys)
      .where(and(eq(authPasskeys.id, passkeyId), eq(authPasskeys.userId, req.actor.userId)))
      .returning({ id: authPasskeys.id })
      .then((rows) => rows[0] ?? null);

    if (!deleted) {
      res.status(404).json({ message: "Passkey not found." });
      return;
    }

    res.json({ status: true });
  });

  return router;
}
