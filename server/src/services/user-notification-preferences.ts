import { eq } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { userNotificationPreferences } from "@paperclipai/db";
import {
  type ProjectNotificationEventType,
  type UserNotificationPreferences,
  updateUserNotificationPreferencesSchema,
  userNotificationPreferencesSchema,
} from "@paperclipai/shared";

const ALL_EVENTS: ProjectNotificationEventType[] = [
  "issue.status_changed",
  "issue.comment_added",
  "issue.assigned",
];

export function defaultUserNotificationPreferences(): UserNotificationPreferences {
  const eventDefaults = Object.fromEntries(
    ALL_EVENTS.map((eventType) => [eventType, { enabled: true, channels: ["email"] }]),
  ) as UserNotificationPreferences["events"];
  return {
    enabled: true,
    defaultChannels: ["email"],
    channels: {
      email: { enabled: true, destination: null },
      sms: { enabled: false, destination: null },
      whatsapp: { enabled: false, destination: null },
    },
    events: eventDefaults,
  };
}

function mergePreferences(base: UserNotificationPreferences, patch: Partial<UserNotificationPreferences>): UserNotificationPreferences {
  return userNotificationPreferencesSchema.parse({
    ...base,
    ...patch,
    channels: {
      ...base.channels,
      ...(patch.channels ?? {}),
    },
    events: {
      ...base.events,
      ...(patch.events ?? {}),
    },
  });
}

export function userNotificationPreferencesService(db: Db) {
  return {
    getByUserId: async (userId: string): Promise<UserNotificationPreferences> => {
      const row = await db
        .select({ preferences: userNotificationPreferences.preferences })
        .from(userNotificationPreferences)
        .where(eq(userNotificationPreferences.userId, userId))
        .then((rows) => rows[0] ?? null);
      const defaults = defaultUserNotificationPreferences();
      if (!row) return defaults;
      const parsed = userNotificationPreferencesSchema.safeParse(row.preferences);
      if (!parsed.success) return defaults;
      return mergePreferences(defaults, parsed.data);
    },

    upsertByUserId: async (userId: string, patch: unknown): Promise<UserNotificationPreferences> => {
      const parsedPatch = updateUserNotificationPreferencesSchema.parse(patch);
      const current = await (async () => {
        const existing = await db
          .select({ preferences: userNotificationPreferences.preferences })
          .from(userNotificationPreferences)
          .where(eq(userNotificationPreferences.userId, userId))
          .then((rows) => rows[0] ?? null);
        const defaults = defaultUserNotificationPreferences();
        if (!existing) return defaults;
        const parsed = userNotificationPreferencesSchema.safeParse(existing.preferences);
        return parsed.success ? mergePreferences(defaults, parsed.data) : defaults;
      })();

      const merged = mergePreferences(current, parsedPatch);
      const now = new Date();
      const [saved] = await db
        .insert(userNotificationPreferences)
        .values({
          userId,
          preferences: merged as unknown as Record<string, unknown>,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [userNotificationPreferences.userId],
          set: {
            preferences: merged as unknown as Record<string, unknown>,
            updatedAt: now,
          },
        })
        .returning({ preferences: userNotificationPreferences.preferences });
      const parsedSaved = userNotificationPreferencesSchema.safeParse(saved?.preferences ?? merged);
      return parsedSaved.success ? parsedSaved.data : merged;
    },
  };
}
