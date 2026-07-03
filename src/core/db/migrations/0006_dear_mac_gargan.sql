CREATE TABLE "fiscal_tick_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tick_id" uuid,
	"tick_number" integer NOT NULL,
	"revenue" integer NOT NULL,
	"spending" integer NOT NULL,
	"treasury_end" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "fiscal_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "fiscal_amount" integer;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "fiscal_tax_delta" integer;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "fiscal_program_name" varchar(120);--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "sunset_ticks" integer;--> statement-breakpoint
ALTER TABLE "government_settings" ADD COLUMN "last_budget_session_tick" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "laws" ADD COLUMN "fiscal_kind" varchar(20);--> statement-breakpoint
ALTER TABLE "laws" ADD COLUMN "fiscal_amount" integer;--> statement-breakpoint
ALTER TABLE "laws" ADD COLUMN "fiscal_tax_delta" integer;--> statement-breakpoint
ALTER TABLE "laws" ADD COLUMN "fiscal_program_name" varchar(120);--> statement-breakpoint
ALTER TABLE "laws" ADD COLUMN "sunset_ticks" integer;--> statement-breakpoint
ALTER TABLE "laws" ADD COLUMN "program_active" boolean;--> statement-breakpoint
ALTER TABLE "laws" ADD COLUMN "enacted_tick" integer;--> statement-breakpoint
ALTER TABLE "laws" ADD COLUMN "last_renewed_tick" integer;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "related_law_id" uuid;--> statement-breakpoint
ALTER TABLE "fiscal_tick_summaries" ADD CONSTRAINT "fiscal_tick_summaries_tick_id_tick_log_id_fk" FOREIGN KEY ("tick_id") REFERENCES "public"."tick_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fiscal_tick_summaries_created_at_idx" ON "fiscal_tick_summaries" USING btree ("created_at");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_related_law_id_laws_id_fk" FOREIGN KEY ("related_law_id") REFERENCES "public"."laws"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_related_law_id_idx" ON "transactions" USING btree ("related_law_id");