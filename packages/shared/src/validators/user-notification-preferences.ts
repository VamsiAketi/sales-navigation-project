import { z } from "zod";

export const notificationChannelTypeSchema = z.enum(["email", "sms", "whatsapp"]);
export const projectNotificationEventTypeSchema = z.enum([
  "issue.status_changed",
  "issue.comment_added",
  "issue.comment_mentioned",
  "issue.assigned",
]);

export const notificationChannelPreferenceSchema = z.object({
  enabled: z.boolean(),
  destination: z.string().trim().nullable().default(null),
}).strict();

export const notificationEventPreferenceSchema = z.object({
  enabled: z.boolean().optional(),
  channels: z.array(notificationChannelTypeSchema).optional(),
}).strict();

export const userNotificationPreferencesSchema = z.object({
  enabled: z.boolean(),
  defaultChannels: z.array(notificationChannelTypeSchema),
  channels: z.object({
    email: notificationChannelPreferenceSchema,
    sms: notificationChannelPreferenceSchema,
    whatsapp: notificationChannelPreferenceSchema,
  }).strict(),
  events: z.record(projectNotificationEventTypeSchema, notificationEventPreferenceSchema).default({}),
}).strict();

export const updateUserNotificationPreferencesSchema = userNotificationPreferencesSchema.partial().strict();

export type UserNotificationPreferences = z.infer<typeof userNotificationPreferencesSchema>;
export type UpdateUserNotificationPreferences = z.infer<typeof updateUserNotificationPreferencesSchema>;
