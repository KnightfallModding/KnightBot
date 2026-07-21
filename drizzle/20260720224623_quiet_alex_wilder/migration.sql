ALTER TABLE "configs" ADD COLUMN "reminder" varchar(2000) NOT NULL;--> statement-breakpoint
ALTER TABLE "configs" ALTER COLUMN "banner" SET NOT NULL;