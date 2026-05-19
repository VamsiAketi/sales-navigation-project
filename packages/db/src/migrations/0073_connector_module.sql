CREATE TABLE IF NOT EXISTS "connector_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connector_type_key" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"inbound_public_id" text NOT NULL,
	"inbound_secret_id" uuid,
	"last_error" text,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "connector_event_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"prompt" text NOT NULL,
	"agent_id" uuid NOT NULL,
	"project_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by_user_id" text,
	"updated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "connector_event_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"binding_id" uuid,
	"external_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"payload" jsonb,
	"heartbeat_run_id" uuid,
	"error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
 ALTER TABLE "connector_connections" ADD CONSTRAINT "connector_connections_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "connector_connections" ADD CONSTRAINT "connector_connections_inbound_secret_id_company_secrets_id_fk" FOREIGN KEY ("inbound_secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "connector_event_bindings" ADD CONSTRAINT "connector_event_bindings_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "connector_event_bindings" ADD CONSTRAINT "connector_event_bindings_connection_id_connector_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connector_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "connector_event_bindings" ADD CONSTRAINT "connector_event_bindings_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "connector_event_bindings" ADD CONSTRAINT "connector_event_bindings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "connector_event_deliveries" ADD CONSTRAINT "connector_event_deliveries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "connector_event_deliveries" ADD CONSTRAINT "connector_event_deliveries_connection_id_connector_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."connector_connections"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "connector_event_deliveries" ADD CONSTRAINT "connector_event_deliveries_binding_id_connector_event_bindings_id_fk" FOREIGN KEY ("binding_id") REFERENCES "public"."connector_event_bindings"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
 ALTER TABLE "connector_event_deliveries" ADD CONSTRAINT "connector_event_deliveries_heartbeat_run_id_heartbeat_runs_id_fk" FOREIGN KEY ("heartbeat_run_id") REFERENCES "public"."heartbeat_runs"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;

CREATE INDEX IF NOT EXISTS "connector_connections_company_status_idx" ON "connector_connections" ("company_id","status");
CREATE INDEX IF NOT EXISTS "connector_connections_company_type_idx" ON "connector_connections" ("company_id","connector_type_key");
CREATE UNIQUE INDEX IF NOT EXISTS "connector_connections_inbound_public_idx" ON "connector_connections" ("inbound_public_id");
CREATE INDEX IF NOT EXISTS "connector_event_bindings_company_connection_idx" ON "connector_event_bindings" ("company_id","connection_id");
CREATE INDEX IF NOT EXISTS "connector_event_bindings_company_agent_idx" ON "connector_event_bindings" ("company_id","agent_id");
CREATE INDEX IF NOT EXISTS "connector_event_bindings_connection_event_idx" ON "connector_event_bindings" ("connection_id","event_type","enabled");
CREATE INDEX IF NOT EXISTS "connector_event_deliveries_company_connection_idx" ON "connector_event_deliveries" ("company_id","connection_id");
CREATE INDEX IF NOT EXISTS "connector_event_deliveries_binding_idx" ON "connector_event_deliveries" ("binding_id");
CREATE UNIQUE INDEX IF NOT EXISTS "connector_event_deliveries_dedupe_idx" ON "connector_event_deliveries" ("connection_id","binding_id","external_event_id");
