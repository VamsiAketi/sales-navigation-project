import { pgTable, uuid, text, timestamp, index } from "drizzle-orm/pg-core";
import { authUsers } from "./auth.js";

export const deletedUserEmails = pgTable(
  "deleted_user_emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull().references(() => authUsers.id, { onDelete: "cascade" }),
    originalEmail: text("original_email").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    userIdx: index("deleted_user_emails_user_idx").on(table.userId),
    emailIdx: index("deleted_user_emails_email_idx").on(table.originalEmail),
    deletedAtIdx: index("deleted_user_emails_deleted_at_idx").on(table.deletedAt),
  }),
);
