import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";

export const salesNavigationState = pgTable(
  "sales_navigation_state",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    sourceFileName: text("source_file_name"),
    graphJson: jsonb("graph_json").notNull().default({}),
    insightsJson: jsonb("insights_json").notNull().default({}),
    importedAt: timestamp("imported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyUnique: uniqueIndex("sales_navigation_state_company_unique").on(table.companyId),
    companyIdx: index("sales_navigation_state_company_idx").on(table.companyId),
  }),
);
