CREATE TYPE "day" AS ENUM('SATURDAY', 'SUNDAY');--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"guild_id" varchar(20) NOT NULL,
	"event_id" varchar(20),
	"day" "day" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"created_at" date DEFAULT now(),
	"updated_at" date DEFAULT now(),
	CONSTRAINT "events_guild_id_starts_at_unique" UNIQUE("guild_id","starts_at")
);
--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_guild_id_configs_guild_id_fkey" FOREIGN KEY ("guild_id") REFERENCES "configs"("guild_id") ON DELETE CASCADE;