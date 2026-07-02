CREATE TABLE "committee_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"committee" varchar(50) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "uniq_committee_membership" UNIQUE("agent_id","committee")
);
--> statement-breakpoint
CREATE TABLE "gazette_issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tick_id" uuid,
	"headline" varchar(200) NOT NULL,
	"body" text NOT NULL,
	"digest" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "committee_memberships" ADD CONSTRAINT "committee_memberships_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gazette_issues" ADD CONSTRAINT "gazette_issues_tick_id_tick_log_id_fk" FOREIGN KEY ("tick_id") REFERENCES "public"."tick_log"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "committee_memberships_committee_idx" ON "committee_memberships" USING btree ("committee");--> statement-breakpoint
CREATE INDEX "gazette_issues_created_at_idx" ON "gazette_issues" USING btree ("created_at");