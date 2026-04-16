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

Out of scope for MVP unless explicitly added:
- Complex profile system
- Roles/permissions beyond basic per-user isolation
- Password recovery
- Email verification

## Market Data Strategy

Confirmed decisions:
- Use public market data interface in MVP
- Data source should be wrapped behind a project-side quote service interface so it can be replaced later
- Current MVP quote provider: Eastmoney public quote API via `lib/server/quote-service.ts`

Target data fields:
- latest price
- total market cap
- updated time

Important note:
- Free public APIs may be usable for MVP, but they do not guarantee exchange-grade SLA or long-term stability.
- The code should keep data-source coupling low.

## Calculation Rules

Current valuation basis:
- Use `total market cap`, not float market cap

Current UI display/input unit:
- Use `亿元` for market cap display and target market cap input in MVP UI

Current position:
- cost amount = `quantity * costPrice`
- current holding value = `quantity * latestPrice`
- current profit = `current holding value - cost amount`
- current profit rate = `current profit / cost amount`

Future scenario projection:
- target price = `latestPrice * targetMarketCap / currentTotalMarketCap`
- target holding value = `quantity * targetPrice`
- total future profit = `target holding value - cost amount`
- additional profit from now = `target holding value - current holding value`

Assumption:
- Share count remains unchanged during projection.

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
