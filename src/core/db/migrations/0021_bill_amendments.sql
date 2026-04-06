CREATE TABLE "bill_amendments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"bill_id" uuid NOT NULL,
	"proposer_id" uuid NOT NULL,
	"amendment_text" text NOT NULL,
	"type" varchar(20) NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"reasoning" text,
	"votes_for" real DEFAULT 0 NOT NULL,
	"votes_against" real DEFAULT 0 NOT NULL,
	"proposed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE INDEX "bill_amendments_bill_id_idx" ON "bill_amendments" ("bill_id");--> statement-breakpoint
CREATE INDEX "bill_amendments_status_idx" ON "bill_amendments" ("status");--> statement-breakpoint
CREATE INDEX "bill_amendments_proposer_id_idx" ON "bill_amendments" ("proposer_id");--> statement-breakpoint
ALTER TABLE "bill_amendments" ADD CONSTRAINT "bill_amendments_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_amendments" ADD CONSTRAINT "bill_amendments_proposer_id_agents_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
