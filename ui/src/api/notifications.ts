import { api } from "./client";

export type UserNotification = {
  id: string;
  userId: string;
  companyId: string | null;
  projectId: string | null;
  issueId: string | null;
  eventType: string;
  title: string;
  message: string;
  channel: string;
  emailDeliveryStatus: string | null;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
};

export const notificationsApi = {
  listMine: (limit = 30) =>
    api.get<UserNotification[]>(`/notifications/me?limit=${encodeURIComponent(String(limit))}`),
  getUnreadCount: () => api.get<{ count: number }>("/notifications/me/unread-count"),
  markRead: (id: string) => api.post<UserNotification>(`/notifications/me/${encodeURIComponent(id)}/read`, {}),
  markAllRead: () => api.post<{ ok: true }>("/notifications/me/read-all", {}),
  listInstanceHistory: (limit = 200) =>
    api.get<UserNotification[]>(`/instance/notifications?limit=${encodeURIComponent(String(limit))}`),
};
