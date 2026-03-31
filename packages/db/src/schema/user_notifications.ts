import { pgTable, uuid, text, timestamp, jsonb, index } from "drizzle-orm/pg-core";
import { authUsers } from "./auth.js";
import { companies } from "./companies.js";
import { issues } from "./issues.js";
import { projects } from "./projects.js";

export const userNotifications = pgTable(
  "user_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    issueId: uuid("issue_id").references(() => issues.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    title: text("title").notNull(),
    message: text("message").notNull(),
    channel: text("channel").notNull().default("in_app"),
    emailDeliveryStatus: text("email_delivery_status"),
    payload: jsonb("payload").$type<Record<string, unknown> | null>(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userCreatedIdx: index("user_notifications_user_created_idx").on(table.userId, table.createdAt),
    userReadIdx: index("user_notifications_user_read_idx").on(table.userId, table.readAt),
    companyCreatedIdx: index("user_notifications_company_created_idx").on(table.companyId, table.createdAt),
  }),
);
