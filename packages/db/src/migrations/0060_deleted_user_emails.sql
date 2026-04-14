CREATE TABLE IF NOT EXISTS "deleted_user_emails" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"original_email" text NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM pg_constraint
		WHERE conname = 'deleted_user_emails_user_id_user_id_fk'
	) THEN
		ALTER TABLE "deleted_user_emails"
			ADD CONSTRAINT "deleted_user_emails_user_id_user_id_fk"
			FOREIGN KEY ("user_id")
			REFERENCES "public"."user"("id")
			ON DELETE cascade
			ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deleted_user_emails_user_idx" ON "deleted_user_emails" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deleted_user_emails_email_idx" ON "deleted_user_emails" USING btree ("original_email");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "deleted_user_emails_deleted_at_idx" ON "deleted_user_emails" USING btree ("deleted_at");
--> statement-breakpoint
WITH "deletable_users" AS (
	SELECT DISTINCT "u"."id" AS "user_id", "u"."email" AS "original_email"
	FROM "user" "u"
	INNER JOIN "company_memberships" "cm"
		ON "cm"."principal_type" = 'user'
		AND "cm"."principal_id" = "u"."id"
	WHERE "cm"."status" = 'deleted'
		AND "u"."email" NOT LIKE '%@deleted.invalid'
		AND NOT EXISTS (
			SELECT 1
			FROM "company_memberships" "cm2"
			WHERE "cm2"."principal_type" = 'user'
				AND "cm2"."principal_id" = "u"."id"
				AND "cm2"."status" != 'deleted'
		)
)
INSERT INTO "deleted_user_emails" ("user_id", "original_email", "deleted_at", "created_at", "updated_at")
SELECT "du"."user_id", "du"."original_email", now(), now(), now()
FROM "deletable_users" "du"
WHERE NOT EXISTS (
	SELECT 1
	FROM "deleted_user_emails" "due"
	WHERE "due"."user_id" = "du"."user_id"
		AND "due"."original_email" = "du"."original_email"
);
--> statement-breakpoint
WITH "deletable_users" AS (
	SELECT DISTINCT "u"."id" AS "user_id"
	FROM "user" "u"
	INNER JOIN "company_memberships" "cm"
		ON "cm"."principal_type" = 'user'
		AND "cm"."principal_id" = "u"."id"
	WHERE "cm"."status" = 'deleted'
		AND "u"."email" NOT LIKE '%@deleted.invalid'
		AND NOT EXISTS (
			SELECT 1
			FROM "company_memberships" "cm2"
			WHERE "cm2"."principal_type" = 'user'
				AND "cm2"."principal_id" = "u"."id"
				AND "cm2"."status" != 'deleted'
		)
)
UPDATE "user" AS "u"
SET
	"email" = 'deleted+' || "u"."id" || '.' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint || '@deleted.invalid',
	"email_verified" = false,
	"updated_at" = now()
WHERE "u"."id" IN (SELECT "du"."user_id" FROM "deletable_users" "du");
--> statement-breakpoint
WITH "deletable_users" AS (
	SELECT DISTINCT "u"."id" AS "user_id"
	FROM "user" "u"
	INNER JOIN "company_memberships" "cm"
		ON "cm"."principal_type" = 'user'
		AND "cm"."principal_id" = "u"."id"
	WHERE "cm"."status" = 'deleted'
		AND NOT EXISTS (
			SELECT 1
			FROM "company_memberships" "cm2"
			WHERE "cm2"."principal_type" = 'user'
				AND "cm2"."principal_id" = "u"."id"
				AND "cm2"."status" != 'deleted'
		)
)
DELETE FROM "session"
WHERE "user_id" IN (SELECT "du"."user_id" FROM "deletable_users" "du");
--> statement-breakpoint
WITH "deletable_users" AS (
	SELECT DISTINCT "u"."id" AS "user_id"
	FROM "user" "u"
	INNER JOIN "company_memberships" "cm"
		ON "cm"."principal_type" = 'user'
		AND "cm"."principal_id" = "u"."id"
	WHERE "cm"."status" = 'deleted'
		AND NOT EXISTS (
			SELECT 1
			FROM "company_memberships" "cm2"
			WHERE "cm2"."principal_type" = 'user'
				AND "cm2"."principal_id" = "u"."id"
				AND "cm2"."status" != 'deleted'
		)
)
DELETE FROM "account"
WHERE "user_id" IN (SELECT "du"."user_id" FROM "deletable_users" "du");
--> statement-breakpoint
WITH "deletable_users" AS (
	SELECT DISTINCT "u"."id" AS "user_id"
	FROM "user" "u"
	INNER JOIN "company_memberships" "cm"
		ON "cm"."principal_type" = 'user'
		AND "cm"."principal_id" = "u"."id"
	WHERE "cm"."status" = 'deleted'
		AND NOT EXISTS (
			SELECT 1
			FROM "company_memberships" "cm2"
			WHERE "cm2"."principal_type" = 'user'
				AND "cm2"."principal_id" = "u"."id"
				AND "cm2"."status" != 'deleted'
		)
)
DELETE FROM "passkey"
WHERE "user_id" IN (SELECT "du"."user_id" FROM "deletable_users" "du");
--> statement-breakpoint
WITH "deletable_users" AS (
	SELECT DISTINCT "u"."id" AS "user_id"
	FROM "user" "u"
	INNER JOIN "company_memberships" "cm"
		ON "cm"."principal_type" = 'user'
		AND "cm"."principal_id" = "u"."id"
	WHERE "cm"."status" = 'deleted'
		AND NOT EXISTS (
			SELECT 1
			FROM "company_memberships" "cm2"
			WHERE "cm2"."principal_type" = 'user'
				AND "cm2"."principal_id" = "u"."id"
				AND "cm2"."status" != 'deleted'
		)
)
UPDATE "board_api_keys"
SET "revoked_at" = now()
WHERE "revoked_at" IS NULL
	AND "user_id" IN (SELECT "du"."user_id" FROM "deletable_users" "du");
