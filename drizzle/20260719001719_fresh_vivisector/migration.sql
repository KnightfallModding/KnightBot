CREATE TABLE "configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"guild_id" varchar(20) NOT NULL UNIQUE,
	"name" varchar(20) NOT NULL,
	"description" varchar(500) NOT NULL,
	"location" varchar(30) NOT NULL,
	"banner" bytea,
	"created_at" date DEFAULT now(),
	"updated_at" date DEFAULT now()
);
