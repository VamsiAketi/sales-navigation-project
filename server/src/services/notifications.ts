import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { userNotifications } from "@paperclipai/db";

export function notificationService(db: Db) {
  return {
    create: async (input: typeof userNotifications.$inferInsert) => {
      const [row] = await db.insert(userNotifications).values(input).returning();
      return row;
    },

    listForUser: async (userId: string, limit = 30) =>
      db
        .select()
        .from(userNotifications)
        .where(eq(userNotifications.userId, userId))
        .orderBy(desc(userNotifications.createdAt))
        .limit(limit),

    countUnreadForUser: async (userId: string) => {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(userNotifications)
        .where(and(eq(userNotifications.userId, userId), isNull(userNotifications.readAt)));
      return Number(row?.count ?? 0);
    },

    markRead: async (userId: string, id: string) =>
      db
        .update(userNotifications)
        .set({ readAt: new Date() })
        .where(and(eq(userNotifications.id, id), eq(userNotifications.userId, userId)))
        .returning()
        .then((rows) => rows[0] ?? null),

    markAllRead: async (userId: string) =>
      db
        .update(userNotifications)
        .set({ readAt: new Date() })
        .where(and(eq(userNotifications.userId, userId), isNull(userNotifications.readAt))),

    updateEmailDeliveryStatus: async (id: string, status: string) =>
      db
        .update(userNotifications)
        .set({ emailDeliveryStatus: status })
        .where(eq(userNotifications.id, id)),

    listForInstance: async (limit = 200) =>
      db
        .select()
        .from(userNotifications)
        .orderBy(desc(userNotifications.createdAt))
        .limit(limit),
  };
}
