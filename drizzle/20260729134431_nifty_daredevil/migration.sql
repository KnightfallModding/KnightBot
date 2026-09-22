CREATE TYPE "mode" AS ENUM('SOFT_BAN', 'HARD_BAN');--> statement-breakpoint
CREATE TYPE "ignoreType" AS ENUM('USER', 'ROLE');--> statement-breakpoint
CREATE TABLE "honeypotIgnores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"config_id" uuid NOT NULL,
	"type" "ignoreType" NOT NULL,
	"ignored_id" varchar(20) NOT NULL,
	CONSTRAINT "honeypotIgnores_config_id_type_ignored_id_unique" UNIQUE("config_id","type","ignored_id")
);
--> statement-breakpoint
CREATE TABLE "honeypotsVictims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"config_id" uuid NOT NULL,
	"user_id" varchar(20) NOT NULL,
	"mode" "mode" NOT NULL,
	CONSTRAINT "honeypotsVictims_config_id_user_id_unique" UNIQUE("config_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "configs" ADD COLUMN "honeypot_channel_id" varchar(20);--> statement-breakpoint
ALTER TABLE "configs" ADD COLUMN "honeypot_mode" "mode";--> statement-breakpoint
ALTER TABLE "configs" ALTER COLUMN "name" SET DATA TYPE varchar(100) USING "name"::varchar(100);--> statement-breakpoint
ALTER TABLE "configs" ALTER COLUMN "description" SET DATA TYPE varchar(1000) USING "description"::varchar(1000);--> statement-breakpoint
ALTER TABLE "configs" ALTER COLUMN "location" SET DATA TYPE varchar(100) USING "location"::varchar(100);--> statement-breakpoint
ALTER TABLE "configs" ALTER COLUMN "reminder" SET DEFAULT 'Click "**Interested**" to receive a notification when the next event start!

[Event link]({{event}})';--> statement-breakpoint
ALTER TABLE "configs" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "configs" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "configs" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "configs" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "events" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "keywords" ALTER COLUMN "content" SET DATA TYPE varchar(200) USING "content"::varchar(200);--> statement-breakpoint
ALTER TABLE "keywords" ALTER COLUMN "created_at" SET DATA TYPE timestamp with time zone USING "created_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "keywords" ALTER COLUMN "created_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "keywords" ALTER COLUMN "updated_at" SET DATA TYPE timestamp with time zone USING "updated_at"::timestamp with time zone;--> statement-breakpoint
ALTER TABLE "keywords" ALTER COLUMN "updated_at" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "honeypotIgnores" ADD CONSTRAINT "honeypotIgnores_config_id_configs_id_fkey" FOREIGN KEY ("config_id") REFERENCES "configs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "honeypotsVictims" ADD CONSTRAINT "honeypotsVictims_config_id_configs_id_fkey" FOREIGN KEY ("config_id") REFERENCES "configs"("id") ON DELETE CASCADE;