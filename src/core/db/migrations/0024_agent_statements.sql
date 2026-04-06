CREATE TABLE "agent_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"statement_text" text NOT NULL,
	"trigger_type" varchar(40) NOT NULL,
	"trigger_bill_id" uuid,
	"trigger_election_id" uuid,
	"trigger_deal_id" uuid,
	"approval_delta" real DEFAULT 0 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "agent_statements_agent_id_idx" ON "agent_statements" ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_statements_trigger_type_idx" ON "agent_statements" ("trigger_type");--> statement-breakpoint
CREATE INDEX "agent_statements_created_at_idx" ON "agent_statements" ("created_at");--> statement-breakpoint
ALTER TABLE "agent_statements" ADD CONSTRAINT "agent_statements_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;
