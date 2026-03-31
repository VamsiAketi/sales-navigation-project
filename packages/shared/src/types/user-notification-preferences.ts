import type { ProjectNotificationEventType } from "./project.js";

export type NotificationChannelType = "email" | "sms" | "whatsapp";

export interface NotificationChannelPreference {
  enabled: boolean;
  destination: string | null;
}

export interface NotificationEventPreference {
  enabled?: boolean;
  channels?: NotificationChannelType[];
}

export interface UserNotificationPreferences {
  enabled: boolean;
  defaultChannels: NotificationChannelType[];
  channels: Record<NotificationChannelType, NotificationChannelPreference>;
  events: Partial<Record<ProjectNotificationEventType, NotificationEventPreference>>;
}
