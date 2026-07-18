CREATE TABLE "quote_history" (
	"stock_code" varchar(6) NOT NULL,
	"trade_date" date NOT NULL,
	"latest_price" numeric(18, 4) NOT NULL,
	"total_market_cap" numeric(20, 0) NOT NULL,
	"price_change_pct" numeric(10, 4) NOT NULL,
	"source" varchar(32) NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"quote_as_of" timestamp with time zone,
	CONSTRAINT "quote_history_stock_code_trade_date_pk" PRIMARY KEY("stock_code","trade_date")
);
