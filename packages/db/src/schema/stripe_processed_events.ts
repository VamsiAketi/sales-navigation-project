import { pgTable, text, timestamp, uuid, uniqueIndex, index } from "drizzle-orm/pg-core";

export const stripeProcessedEvents = pgTable(
  "stripe_processed_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stripeEventId: text("stripe_event_id").notNull(),
    eventType: text("event_type").notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    stripeEventIdUniqueIdx: uniqueIndex("stripe_processed_events_event_id_unique_idx").on(table.stripeEventId),
    eventTypeIdx: index("stripe_processed_events_event_type_idx").on(table.eventType),
  }),
);
