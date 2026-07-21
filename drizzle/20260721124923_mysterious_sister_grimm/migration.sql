ALTER TABLE "keywords" ADD COLUMN "id" uuid DEFAULT gen_random_uuid();--> statement-breakpoint
ALTER TABLE "keywords" ADD PRIMARY KEY ("id");