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
CREATE INDEX "agent_deals_initiator_id_idx" ON "agent_deals" ("initiator_id");--> statement-breakpoint
CREATE INDEX "agent_deals_target_id_idx" ON "agent_deals" ("target_id");--> statement-breakpoint
CREATE INDEX "agent_deals_bill_id_idx" ON "agent_deals" ("bill_id");--> statement-breakpoint
CREATE INDEX "agent_deals_status_idx" ON "agent_deals" ("status");--> statement-breakpoint
ALTER TABLE "agent_deals" ADD CONSTRAINT "agent_deals_initiator_id_agents_id_fk" FOREIGN KEY ("initiator_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deals" ADD CONSTRAINT "agent_deals_target_id_agents_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_deals" ADD CONSTRAINT "agent_deals_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;
