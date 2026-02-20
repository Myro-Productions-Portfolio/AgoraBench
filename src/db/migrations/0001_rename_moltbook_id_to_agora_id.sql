ALTER TABLE "agents" RENAME COLUMN "moltbook_id" TO "agora_id";--> statement-breakpoint
ALTER TABLE "agents" RENAME CONSTRAINT "agents_moltbook_id_unique" TO "agents_agora_id_unique";