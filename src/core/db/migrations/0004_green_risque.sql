-- CATCH-UP MIGRATION — NEVER EXECUTE AGAINST PRODUCTION.
-- Every statement below was already applied to production by the hand-numbered
-- migrations 0021-0025 before the drizzle journal was restored (the journal
-- ended at 0003 while 0021-0025 lived outside it). This file exists solely to
-- reconcile drizzle-kit's snapshot bookkeeping so future generates are clean.
-- The DROP TABLE statements for benchmark_runs/benchmark_scenarios that
-- drizzle-kit emitted here (stale snapshot-0003 tables no longer in the schema)
-- were deliberately removed: those tables may still exist on prod and must not
-- be dropped by tooling.
CREATE TABLE "agent_deals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"initiator_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"initiator_commitment" text NOT NULL,
	"target_commitment" text NOT NULL,
	"status" varchar(20) DEFAULT 'proposed' NOT NULL,
	"initiator_honored" boolean,
	"target_honored" boolean,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone
);
--> statement-breakpoint
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
CREATE TABLE "lobbying_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lobbyist_id" uuid NOT NULL,
	"target_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"argument" text NOT NULL,
	"desired_vote" varchar(10) NOT NULL,
	"position_shifted" boolean DEFAULT false NOT NULL,
	"sentiment_delta" real DEFAULT 0.03 NOT NULL,
	"tick_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "agent_deals" ADD CONSTRAINT "agent_deals_initiator_id_agents_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deals" ADD CONSTRAINT "agent_deals_target_id_agents_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deals" ADD CONSTRAINT "agent_deals_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_statements" ADD CONSTRAINT "agent_statements_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_amendments" ADD CONSTRAINT "bill_amendments_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_amendments" ADD CONSTRAINT "bill_amendments_proposer_id_agents_id_fk" FOREIGN KEY ("proposer_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobbying_events" ADD CONSTRAINT "lobbying_events_lobbyist_id_agents_id_fk" FOREIGN KEY ("lobbyist_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobbying_events" ADD CONSTRAINT "lobbying_events_target_id_agents_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobbying_events" ADD CONSTRAINT "lobbying_events_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_deals_initiator_id_idx" ON "agent_deals" USING btree ("initiator_id");--> statement-breakpoint
CREATE INDEX "agent_deals_target_id_idx" ON "agent_deals" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "agent_deals_bill_id_idx" ON "agent_deals" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "agent_deals_status_idx" ON "agent_deals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_statements_agent_id_idx" ON "agent_statements" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_statements_trigger_type_idx" ON "agent_statements" USING btree ("trigger_type");--> statement-breakpoint
CREATE INDEX "agent_statements_created_at_idx" ON "agent_statements" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "bill_amendments_bill_id_idx" ON "bill_amendments" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "bill_amendments_status_idx" ON "bill_amendments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "bill_amendments_proposer_id_idx" ON "bill_amendments" USING btree ("proposer_id");--> statement-breakpoint
CREATE INDEX "lobbying_events_bill_id_idx" ON "lobbying_events" USING btree ("bill_id");--> statement-breakpoint
CREATE INDEX "lobbying_events_lobbyist_id_idx" ON "lobbying_events" USING btree ("lobbyist_id");--> statement-breakpoint
CREATE INDEX "lobbying_events_target_id_idx" ON "lobbying_events" USING btree ("target_id");--> statement-breakpoint
CREATE INDEX "lobbying_events_tick_id_idx" ON "lobbying_events" USING btree ("tick_id");