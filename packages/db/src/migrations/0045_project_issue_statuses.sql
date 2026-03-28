CREATE TABLE IF NOT EXISTS "project_issue_statuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"value" text NOT NULL,
	"color" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_issue_statuses_project_id_projects_id_fk') THEN
  ALTER TABLE "project_issue_statuses" ADD CONSTRAINT "project_issue_statuses_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_issue_statuses_company_id_companies_id_fk') THEN
  ALTER TABLE "project_issue_statuses" ADD CONSTRAINT "project_issue_statuses_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
 END IF;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "proj_statuses_project_value_idx" ON "project_issue_statuses" USING btree ("project_id","value");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proj_statuses_project_active_pos_idx" ON "project_issue_statuses" USING btree ("project_id","is_active","position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "proj_statuses_company_idx" ON "project_issue_statuses" USING btree ("company_id");
--> statement-breakpoint
INSERT INTO "project_issue_statuses" ("project_id", "company_id", "name", "value", "color", "position", "is_active")
SELECT
  p.id,
  p.company_id,
  s.name,
  s.value,
  s.color,
  s.position,
  true
FROM "projects" p
CROSS JOIN (VALUES
  ('Backlog',     'backlog',     '#6b7280', 0),
  ('Todo',        'todo',        '#3b82f6', 1),
  ('In Progress', 'in_progress', '#eab308', 2),
  ('In Review',   'in_review',   '#8b5cf6', 3),
  ('Blocked',     'blocked',     '#ef4444', 4),
  ('Done',        'done',        '#22c55e', 5),
  ('Cancelled',   'cancelled',   '#6b7280', 6)
) AS s(name, value, color, position)
ON CONFLICT DO NOTHING;
