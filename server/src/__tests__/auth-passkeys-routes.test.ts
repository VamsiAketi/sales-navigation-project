import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { authPasskeyRoutes } from "../routes/auth-passkeys.js";

type Actor = { type: "board"; userId: string; source: "session" } | { type: "none"; source: "none" };

function createDbStub() {
  const passkeys = [
    {
      id: "pk-1",
      name: "MacBook Touch ID",
      createdAt: new Date("2026-04-20T10:00:00.000Z"),
      deviceType: "singleDevice",
      backedUp: false,
      transports: "internal",
      aaguid: null,
      userId: "user-1",
    },
    {
      id: "pk-2",
      name: "YubiKey",
      createdAt: new Date("2026-04-22T10:00:00.000Z"),
      deviceType: "multiDevice",
      backedUp: true,
      transports: "usb,nfc",
      aaguid: null,
      userId: "user-1",
    },
    {
      id: "pk-other",
      name: "Other User Key",
      createdAt: new Date("2026-04-21T10:00:00.000Z"),
      deviceType: "singleDevice",
      backedUp: false,
      transports: "internal",
      aaguid: null,
      userId: "user-2",
    },
  ];

  return {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          orderBy: vi.fn(async () =>
            passkeys
              .filter((row) => row.userId === "user-1")
              .map(({ userId: _userId, ...rest }) => rest),
          ),
        })),
      })),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: "pk-1" }]),
      })),
    })),
  };
}

function createApp(db: Record<string, unknown>, actor: Actor = { type: "board", userId: "user-1", source: "session" }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: Actor }).actor = actor;
    next();
  });
  app.use("/api/auth", authPasskeyRoutes(db as any));
  return app;
}

describe("authPasskeyRoutes", () => {
  it("lists passkeys for the signed-in user", async () => {
    const app = createApp(createDbStub());
    const res = await request(app).get("/api/auth/passkeys");

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.passkeys)).toBe(true);
    expect(res.body.passkeys).toHaveLength(2);
    expect(res.body.passkeys.map((row: { id: string }) => row.id)).toEqual(["pk-1", "pk-2"]);
  });

  it("returns unauthorized when actor is not board user", async () => {
    const app = createApp(createDbStub(), { type: "none", source: "none" });
    const res = await request(app).get("/api/auth/passkeys");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ message: "Unauthorized" });
  });

  it("deletes the caller's passkey", async () => {
    const app = createApp(createDbStub());
    const res = await request(app).delete("/api/auth/passkeys/pk-1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: true });
  });

  it("returns not found when passkey does not exist", async () => {
    const db = createDbStub();
    (db.delete as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => []),
      })),
    }));
    const app = createApp(db);
    const res = await request(app).delete("/api/auth/passkeys/missing");

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ message: "Passkey not found." });
  });
});
