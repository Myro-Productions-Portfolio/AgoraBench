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
CREATE INDEX "lobbying_events_bill_id_idx" ON "lobbying_events" ("bill_id");--> statement-breakpoint
CREATE INDEX "lobbying_events_lobbyist_id_idx" ON "lobbying_events" ("lobbyist_id");--> statement-breakpoint
CREATE INDEX "lobbying_events_target_id_idx" ON "lobbying_events" ("target_id");--> statement-breakpoint
CREATE INDEX "lobbying_events_tick_id_idx" ON "lobbying_events" ("tick_id");--> statement-breakpoint
ALTER TABLE "lobbying_events" ADD CONSTRAINT "lobbying_events_lobbyist_id_agents_id_fk" FOREIGN KEY ("lobbyist_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobbying_events" ADD CONSTRAINT "lobbying_events_target_id_agents_id_fk" FOREIGN KEY ("target_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lobbying_events" ADD CONSTRAINT "lobbying_events_bill_id_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."bills"("id") ON DELETE no action ON UPDATE no action;
