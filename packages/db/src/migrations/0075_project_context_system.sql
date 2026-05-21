ALTER TABLE "projects"
ADD COLUMN IF NOT EXISTS "data_schema_name" text;
--> statement-breakpoint

ALTER TABLE "project_issue_statuses"
ADD COLUMN IF NOT EXISTS "description" text;
--> statement-breakpoint
ALTER TABLE "project_issue_statuses"
ADD COLUMN IF NOT EXISTS "agent_instructions" text;
--> statement-breakpoint
ALTER TABLE "project_issue_statuses"
ADD COLUMN IF NOT EXISTS "agent_capability_tags" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
ALTER TABLE "project_issue_statuses"
ADD COLUMN IF NOT EXISTS "latest_playbook_revision_id" uuid;
--> statement-breakpoint
ALTER TABLE "project_issue_statuses"
ADD COLUMN IF NOT EXISTS "latest_playbook_revision_number" integer;
--> statement-breakpoint
ALTER TABLE "project_issue_statuses"
ADD COLUMN IF NOT EXISTS "playbook_locked_by_user_id" text;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "document_id" uuid NOT NULL REFERENCES "documents"("id") ON DELETE cascade,
  "key" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_documents_company_project_key_uq" ON "project_documents" ("company_id", "project_id", "key");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_documents_document_uq" ON "project_documents" ("document_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_documents_company_project_updated_idx" ON "project_documents" ("company_id", "project_id", "updated_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_context_files" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "asset_id" uuid NOT NULL REFERENCES "assets"("id") ON DELETE cascade,
  "title" text NOT NULL,
  "original_filename" text NOT NULL,
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL,
  "extraction_status" text NOT NULL DEFAULT 'pending',
  "extracted_text" text,
  "extraction_error" text,
  "uploaded_by_user_id" text,
  "uploaded_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_context_files_company_project_created_idx" ON "project_context_files" ("company_id", "project_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_context_files_company_project_status_idx" ON "project_context_files" ("company_id", "project_id", "extraction_status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_context_files_company_asset_idx" ON "project_context_files" ("company_id", "asset_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_context_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "body" text NOT NULL,
  "content_hash" text NOT NULL,
  "revision_number" integer NOT NULL,
  "change_source" text NOT NULL DEFAULT 'agent_sync',
  "source_content_hash" text,
  "change_summary" text,
  "generated_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE set null,
  "generated_by_run_id" uuid REFERENCES "heartbeat_runs"("id") ON DELETE set null,
  "created_by_user_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_context_snapshots_project_kind_revision_uq" ON "project_context_snapshots" ("project_id", "kind", "revision_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_context_snapshots_company_project_created_idx" ON "project_context_snapshots" ("company_id", "project_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_context_snapshots_company_project_kind_created_idx" ON "project_context_snapshots" ("company_id", "project_id", "kind", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_maintenance_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "type" text NOT NULL,
  "description" text NOT NULL,
  "context_ref" jsonb,
  "normalized_description" text,
  "dedupe_hash" text,
  "status" text NOT NULL DEFAULT 'pending',
  "change_risk_class" text NOT NULL DEFAULT 'non_destructive',
  "risk_reasons" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "retry_count" integer NOT NULL DEFAULT 0,
  "max_retries" integer NOT NULL DEFAULT 2,
  "next_retry_at" timestamptz,
  "requested_by_user_id" text,
  "heartbeat_run_id" uuid REFERENCES "heartbeat_runs"("id") ON DELETE set null,
  "approved_by_user_id" text,
  "approved_at" timestamptz,
  "rejected_by_user_id" text,
  "rejected_at" timestamptz,
  "completed_at" timestamptz,
  "failure_reason" text,
  "change_summary" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_maintenance_requests_company_project_created_idx" ON "project_maintenance_requests" ("company_id", "project_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_maintenance_requests_company_project_status_created_idx" ON "project_maintenance_requests" ("company_id", "project_id", "status", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_maintenance_requests_company_project_dedupe_idx" ON "project_maintenance_requests" ("company_id", "project_id", "dedupe_hash", "status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_issue_status_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "project_issue_status_id" uuid NOT NULL REFERENCES "project_issue_statuses"("id") ON DELETE cascade,
  "revision_number" integer NOT NULL,
  "description" text,
  "agent_instructions" text,
  "agent_capability_tags" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "change_source" text NOT NULL DEFAULT 'agent_sync',
  "source_content_hash" text,
  "change_summary" text,
  "created_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE set null,
  "created_by_user_id" text,
  "created_by_run_id" uuid REFERENCES "heartbeat_runs"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_issue_status_revisions_status_revision_uq" ON "project_issue_status_revisions" ("project_issue_status_id", "revision_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_issue_status_revisions_company_project_status_created_idx" ON "project_issue_status_revisions" ("company_id", "project_id", "project_issue_status_id", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_context_file_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "project_context_file_id" uuid NOT NULL REFERENCES "project_context_files"("id") ON DELETE cascade,
  "event_type" text NOT NULL,
  "details" jsonb,
  "created_by_user_id" text,
  "created_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE set null,
  "created_by_run_id" uuid REFERENCES "heartbeat_runs"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_context_file_events_company_project_created_idx" ON "project_context_file_events" ("company_id", "project_id", "created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_context_file_events_file_created_idx" ON "project_context_file_events" ("project_context_file_id", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_data_objects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "schema_name" text,
  "definition" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "latest_revision_number" integer,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_data_objects_company_project_name_uq" ON "project_data_objects" ("company_id", "project_id", "normalized_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_data_objects_company_project_kind_idx" ON "project_data_objects" ("company_id", "project_id", "kind");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_data_objects_company_project_updated_idx" ON "project_data_objects" ("company_id", "project_id", "updated_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_data_object_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "project_data_object_id" uuid NOT NULL REFERENCES "project_data_objects"("id") ON DELETE cascade,
  "revision_number" integer NOT NULL,
  "kind" text NOT NULL,
  "name" text NOT NULL,
  "definition" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "change_source" text NOT NULL DEFAULT 'human',
  "change_summary" text,
  "created_by_user_id" text,
  "created_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE set null,
  "created_by_run_id" uuid REFERENCES "heartbeat_runs"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_data_object_revisions_object_revision_uq" ON "project_data_object_revisions" ("project_data_object_id", "revision_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_data_object_revisions_company_project_object_created_idx" ON "project_data_object_revisions" ("company_id", "project_id", "project_data_object_id", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_views" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "description" text,
  "layout" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_views_company_project_name_uq" ON "project_views" ("company_id", "project_id", "normalized_name");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_views_company_project_updated_idx" ON "project_views" ("company_id", "project_id", "updated_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_view_widgets" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "project_view_id" uuid NOT NULL REFERENCES "project_views"("id") ON DELETE cascade,
  "title" text,
  "normalized_title" text,
  "type" text NOT NULL,
  "position" integer NOT NULL DEFAULT 0,
  "query_ref" jsonb,
  "config" jsonb,
  "layout" jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_view_widgets_company_view_position_idx" ON "project_view_widgets" ("company_id", "project_view_id", "position");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_view_widgets_company_view_title_uq" ON "project_view_widgets" ("company_id", "project_view_id", "normalized_title");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_view_widgets_company_project_created_idx" ON "project_view_widgets" ("company_id", "project_id", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_view_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "project_view_id" uuid NOT NULL REFERENCES "project_views"("id") ON DELETE cascade,
  "revision_number" integer NOT NULL,
  "name" text NOT NULL,
  "layout" jsonb,
  "change_source" text NOT NULL DEFAULT 'human',
  "change_summary" text,
  "created_by_user_id" text,
  "created_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE set null,
  "created_by_run_id" uuid REFERENCES "heartbeat_runs"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_view_revisions_view_revision_uq" ON "project_view_revisions" ("project_view_id", "revision_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_view_revisions_company_project_view_created_idx" ON "project_view_revisions" ("company_id", "project_id", "project_view_id", "created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "project_view_widget_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "project_id" uuid NOT NULL REFERENCES "projects"("id") ON DELETE cascade,
  "project_view_id" uuid NOT NULL REFERENCES "project_views"("id") ON DELETE cascade,
  "project_view_widget_id" uuid NOT NULL REFERENCES "project_view_widgets"("id") ON DELETE cascade,
  "revision_number" integer NOT NULL,
  "title" text,
  "type" text NOT NULL,
  "query_ref" jsonb,
  "config" jsonb,
  "layout" jsonb,
  "change_source" text NOT NULL DEFAULT 'human',
  "change_summary" text,
  "created_by_user_id" text,
  "created_by_agent_id" uuid REFERENCES "agents"("id") ON DELETE set null,
  "created_by_run_id" uuid REFERENCES "heartbeat_runs"("id") ON DELETE set null,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "project_view_widget_revisions_widget_revision_uq" ON "project_view_widget_revisions" ("project_view_widget_id", "revision_number");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_view_widget_revisions_company_project_view_widget_created_idx" ON "project_view_widget_revisions" ("company_id", "project_id", "project_view_id", "project_view_widget_id", "created_at");
