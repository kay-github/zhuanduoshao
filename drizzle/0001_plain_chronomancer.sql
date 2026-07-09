CREATE TABLE "dividend_snapshots" (
	"stock_code" varchar(6) PRIMARY KEY NOT NULL,
	"payload" text NOT NULL,
	"source" varchar(32) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quote_snapshots" (
	"stock_code" varchar(6) PRIMARY KEY NOT NULL,
	"latest_price" numeric(18, 4) NOT NULL,
	"total_market_cap" numeric(20, 0) NOT NULL,
	"price_change_pct" numeric(10, 4) NOT NULL,
	"quote_updated_at" varchar(8) NOT NULL,
	"source" varchar(32) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "basis_date" varchar(10);