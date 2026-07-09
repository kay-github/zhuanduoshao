# AGENTS

## Project Purpose

Product name:
- `赚多少`

Build a small stock holding scenario tool for Chinese A-share users.

Current confirmed scope:
- User inputs holding quantity and cost price.
- System shows latest price, latest holding value, current profit, and current profit rate.
- System projects future profit under target total market cap scenarios.
- Initial stock universe is fixed to 2 stocks: `300502 新易盛`, `300308 中际旭创`.

## Current Phase

UI has entered refinement and backend foundation can start in parallel.

UI priority:
- Mobile web first
- PC web secondary

## Tech Stack

- Frontend: `TypeScript + Vue 3 + Vite`
- API runtime: `Vercel Functions`
- Database: `PostgreSQL`
- ORM: `Drizzle`

Important deployment note:
- Preferred deployment shape: Vercel for frontend and serverless API, with Neon-compatible PostgreSQL attached through Vercel-supported integration.

## Auth Scope

Keep auth minimal.

Confirmed decisions:
- Registration method: `username + password`
- Support self-registration and login
- Different accounts must only see their own holdings
- Each user stores one current position per stock in MVP
- Use HttpOnly cookie session in MVP
- Unauthenticated users may keep temporary position drafts in local browser storage

Out of scope for MVP unless explicitly added:
- Complex profile system
- Roles/permissions beyond basic per-user isolation
- Password recovery
- Email verification

## Market Data Strategy

Confirmed decisions:
- Use public market data interface in MVP
- Data source should be wrapped behind a project-side quote service interface so it can be replaced later
- Current MVP quote providers: Eastmoney, Tencent, and Sina public quote APIs via `lib/server/quote-service.ts`
- Quote service now uses multiple public providers and should prefer persisted last-good data over hardcoded fallback data when live sources fail
- Corporate action data is wrapped behind `lib/server/dividend-service.ts`; it prefers `TUSHARE_TOKEN`/Tushare Pro when configured, then falls back to Eastmoney public dividend/bonus data
- Corporate action snapshots should be persisted and reused before falling back to empty action data

Target data fields:
- latest price
- total market cap
- updated time
- dividend/bonus/transfer records with record date and ex-dividend/ex-rights date

Important note:
- Free public APIs may be usable for MVP, but they do not guarantee exchange-grade SLA or long-term stability.
- The code should keep data-source coupling low.

## Calculation Rules

Current valuation basis:
- Use `total market cap`, not float market cap

Current UI display/input unit:
- Target market cap input uses `万亿元`; market cap display switches automatically between `亿元` and `万亿元`

Current position:
- each position stores `quantity`, `costPrice`, and `basisDate`
- original cost amount = `quantity * costPrice`
- automatically apply implemented cash dividends, bonus shares, and capital reserve transfers with `exDate > basisDate` and `exDate <= today`
- effective quantity is adjusted by bonus/transfer ratios
- cash dividend amount is added to total return
- current holding value = `effective quantity * latestPrice`
- current profit = `current holding value + cash dividend amount - original cost amount`
- current profit rate = `current profit / original cost amount`

Future scenario projection:
- target price = `latestPrice * targetMarketCap / currentTotalMarketCap`
- target holding value = `effective quantity * targetPrice`
- total future profit = `target holding value + cash dividend amount - original cost amount`
- additional profit from now = `target holding value - current holding value`

Assumption:
- Projection assumes no future unannounced corporate actions beyond already implemented records.
- Rights issues are not automatically assumed as subscribed because they require user action/payment.

## Default Scenario Targets

Default target total market cap list in MVP:
- `10000 亿`
- `12000 亿`
- `13000 亿`
- `15000 亿`
- `18000 亿`
- `20000 亿`
- plus `one custom target`

## Product Rules

- Keep changes minimal and pragmatic.
- Keep the UI concise and tool-first; avoid unnecessary marketing copy in primary screens.
- Update this `AGENTS.md` whenever product rules, architecture choices, or major decisions change.
- Maintain `HANDOFF.md` with current implementation status and next-step guidance for future handoff.
- Do not commit or store secrets such as GitHub tokens in the repository.
