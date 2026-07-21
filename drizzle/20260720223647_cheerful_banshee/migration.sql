CREATE TABLE "keywords" (
	"config_id" varchar(20) NOT NULL,
	"content" varchar(100) NOT NULL,
	"strict" boolean DEFAULT false,
	"created_at" date DEFAULT now(),
	"updated_at" date DEFAULT now(),
	CONSTRAINT "keywords_config_id_content_unique" UNIQUE("config_id","content")
);
--> statement-breakpoint
ALTER TABLE "keywords" ADD CONSTRAINT "keywords_config_id_configs_id_fkey" FOREIGN KEY ("config_id") REFERENCES "configs"("id") ON DELETE CASCADE;