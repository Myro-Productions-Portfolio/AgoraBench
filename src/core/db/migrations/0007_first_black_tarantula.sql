CREATE TABLE "court_case_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"tick" integer NOT NULL,
	"type" varchar(30) NOT NULL,
	"actor_id" uuid,
	"role" varchar(20),
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "court_case_votes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"justice_id" uuid NOT NULL,
	"vote" varchar(20) NOT NULL,
	"reasoning" text,
	"cited_articles" text,
	"cast_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "court_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_number" varchar(20) NOT NULL,
	"caption" varchar(200) NOT NULL,
	"case_type" varchar(30) NOT NULL,
	"status" varchar(20) DEFAULT 'filed' NOT NULL,
	"law_id" uuid,
	"deal_id" uuid,
	"petitioner_id" uuid NOT NULL,
	"respondent_id" uuid,
	"question_presented" text,
	"filing_text" text,
	"filed_tick" integer NOT NULL,
	"hearing_tick" integer,
	"decided_tick" integer,
	"hearing_event_id" uuid,
	"outcome" varchar(20),
	"majority_opinion" text,
	"majority_author_id" uuid,
	"majority_citations" text,
	"dissent_opinion" text,
	"dissent_author_id" uuid,
	"dissent_citations" text,
	"votes_for" integer DEFAULT 0,
	"votes_against" integer DEFAULT 0,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "court_cases_case_number_unique" UNIQUE("case_number")
);
--> statement-breakpoint
ALTER TABLE "court_case_events" ADD CONSTRAINT "court_case_events_case_id_court_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."court_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_case_events" ADD CONSTRAINT "court_case_events_actor_id_agents_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_case_votes" ADD CONSTRAINT "court_case_votes_case_id_court_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."court_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_case_votes" ADD CONSTRAINT "court_case_votes_justice_id_agents_id_fk" FOREIGN KEY ("justice_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_cases" ADD CONSTRAINT "court_cases_law_id_laws_id_fk" FOREIGN KEY ("law_id") REFERENCES "public"."laws"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_cases" ADD CONSTRAINT "court_cases_deal_id_agent_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."agent_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_cases" ADD CONSTRAINT "court_cases_petitioner_id_agents_id_fk" FOREIGN KEY ("petitioner_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_cases" ADD CONSTRAINT "court_cases_respondent_id_agents_id_fk" FOREIGN KEY ("respondent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_cases" ADD CONSTRAINT "court_cases_hearing_event_id_government_events_id_fk" FOREIGN KEY ("hearing_event_id") REFERENCES "public"."government_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_cases" ADD CONSTRAINT "court_cases_majority_author_id_agents_id_fk" FOREIGN KEY ("majority_author_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "court_cases" ADD CONSTRAINT "court_cases_dissent_author_id_agents_id_fk" FOREIGN KEY ("dissent_author_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;