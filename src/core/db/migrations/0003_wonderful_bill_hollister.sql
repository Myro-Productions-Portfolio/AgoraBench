CREATE TABLE "coalition_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"blocs" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
