CREATE TABLE "agent_memory_summaries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"summary" text NOT NULL,
	"decisions_from" timestamp NOT NULL,
	"decisions_to" timestamp NOT NULL,
	"decision_count" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_policy_positions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"category" text NOT NULL,
	"support_count" integer DEFAULT 0 NOT NULL,
	"oppose_count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_agent_policy_position" UNIQUE("agent_id","category")
);
--> statement-breakpoint
CREATE TABLE "agent_relationships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"target_agent_id" uuid NOT NULL,
	"vote_alignment" real DEFAULT 0.5 NOT NULL,
	"forum_interactions" integer DEFAULT 0 NOT NULL,
	"sentiment" real DEFAULT 0.5 NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "uniq_agent_relationship" UNIQUE("agent_id","target_agent_id")
);
--> statement-breakpoint
CREATE TABLE "agge_interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"agent_id" uuid NOT NULL,
	"action" varchar(10) NOT NULL,
	"previous_mod" text,
	"new_mod" text,
	"reasoning" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"scenario_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"model_endpoint" text,
	"model_name" text NOT NULL,
	"model_backend" text DEFAULT 'internal' NOT NULL,
	"config_hash" text NOT NULL,
	"agent_assignment" jsonb,
	"started_at" timestamp,
	"completed_at" timestamp,
	"ticks_completed" integer DEFAULT 0,
	"metrics_report" jsonb,
	"raw_data" jsonb,
	"error" text,
	"triggered_by" text DEFAULT 'admin' NOT NULL,
	"callback_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "benchmark_scenarios" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"world_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"agent_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"seed_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"run_length" integer DEFAULT 100 NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"difficulty" text DEFAULT 'medium' NOT NULL,
	"category" text DEFAULT 'outcome' NOT NULL,
	"tier" integer DEFAULT 1 NOT NULL,
	"is_built_in" boolean DEFAULT false NOT NULL,
	"created_by" text DEFAULT 'system',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orchestrator_interventions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" varchar(50) NOT NULL,
	"payload" jsonb NOT NULL,
	"result" jsonb,
	"reasoning" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_mentions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mentioned_agent_id" uuid NOT NULL,
	"thread_id" uuid NOT NULL,
	"mentioner_name" varchar(100) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runtime_config" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tick_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"fired_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "personality_mod" text;--> statement-breakpoint
ALTER TABLE "agents" ADD COLUMN "personality_mod_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "api_providers" ADD COLUMN "default_model" varchar(200);--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "yea_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "bills" ADD COLUMN "nay_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "agent_memory_summaries" ADD CONSTRAINT "agent_memory_summaries_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_policy_positions" ADD CONSTRAINT "agent_policy_positions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_relationships" ADD CONSTRAINT "agent_relationships_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_relationships" ADD CONSTRAINT "agent_relationships_target_agent_id_agents_id_fk" FOREIGN KEY ("target_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agge_interventions" ADD CONSTRAINT "agge_interventions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "benchmark_runs" ADD CONSTRAINT "benchmark_runs_scenario_id_benchmark_scenarios_id_fk" FOREIGN KEY ("scenario_id") REFERENCES "public"."benchmark_scenarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_mentions" ADD CONSTRAINT "pending_mentions_mentioned_agent_id_agents_id_fk" FOREIGN KEY ("mentioned_agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_mentions" ADD CONSTRAINT "pending_mentions_thread_id_forum_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."forum_threads"("id") ON DELETE no action ON UPDATE no action;