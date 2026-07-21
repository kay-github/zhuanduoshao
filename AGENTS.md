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

UI and backend foundations are in place. The current focus is refinement, hardening, and deployment verification.

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
- Login, registration, and logout mutations must require `application/json`; do not accept form-compatible requests that can bypass the intended same-origin JSON flow
- A stale `/api/auth/me` 401 response must not clear the session cookie because it may race with a newer successful login
- `AUTH_SECRET` must be at least 32 characters, must not be an example/placeholder value, and must be validated before account creation writes
- Passwords must be at least 6 characters and no more than 72 UTF-8 bytes because bcrypt ignores bytes beyond that boundary

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
- Always smoke-test quote providers through `listQuotes()` after changing providers, fields, request headers, or fallback logic.
- Live quote/corporate-action rows and persisted snapshots must pass strict field validation before they are marked live or replace last-good data.
- Quote snapshot and history upserts must be monotonic by `quote_as_of`; an older live response must never overwrite or outrank a newer persisted quote.
- `npm run smoke:data:no-persist` must fail unless both configured stocks return valid live quotes and non-empty live corporate-action histories.
- Do not remove quote/dividend snapshot fallback just because a public source works locally once.
- Built-in fallback quotes in `shared/stocks.ts` must be refreshed from live data when the stock universe changes or after large market moves (rough rule: whenever the fallback price drifts more than ~30% from reality); keep fallback `priceChangePct` at `0`.

## Calculation Rules

Current valuation basis:
- Use `total market cap`, not float market cap

Current UI display/input unit:
- Target market cap input uses `万亿元`; market cap display switches automatically between `亿元` and `万亿元`

Current position:
- each position stores `quantity`, `costPrice`, and `basisDate`
- default/new-user `quantity` must be `0`; never use nonzero demo shares as the active default
- original cost amount = `quantity * costPrice`
- automatically apply implemented cash dividends, bonus shares, and capital reserve transfers with `exDate > basisDate` and `exDate <= today`
- effective quantity is adjusted by bonus/transfer ratios
- provider cash dividends are pre-tax; the UI applies a user-selected A-share dividend tax bracket by holding period (`>1y` 0%, `1m-1y` 10%, `<1m` 20%) and all return calculations use the after-tax cash amount
- cash dividend amount (after tax) is added to total return
- current holding value = `effective quantity * latestPrice`
- current profit = `current holding value + cash dividend amount - original cost amount`
- current profit rate = `current profit / original cost amount`

Future scenario projection:
- target price = `latestPrice * targetMarketCap / currentTotalMarketCap`
- target holding value = `effective quantity * targetPrice`
- total future profit = `target holding value + cash dividend amount - original cost amount`
- additional profit from now = `target holding value - current holding value`
- reverse projection: given a desired total profit, solve `requiredPrice = (targetProfit + originalCost - cashDividends) / effectiveQuantity` and the implied total market cap; unachievable without an effective holding
- custom target supports two input modes: total market cap (`万亿`) or price per share (`元`); price input is converted through the current cap/price ratio and the target is always stored in `亿`

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
- Treat mobile as the primary layout; after mobile UI changes, verify around 390px width and check that the document has no horizontal overflow.
- Keep target market-cap UI input in `万亿元`, but keep internal scenario calculations normalized to the existing `亿元` target values unless the whole calculation model is intentionally migrated.
- Quotes auto-refresh every 30s only during A-share trading sessions (09:30-11:30, 13:00-15:00 China time, weekdays) and only while the page is visible; holidays are not modeled.
- Dates used for A-share calculation boundaries and default position basis dates must use the China calendar date on both frontend and backend.
- Login/register must never wipe nonzero unauthenticated drafts: merge server positions over drafts and prompt the user to save unsaved local input, instead of resetting first.
- Frontend authenticated requests must be tied to the current session epoch so responses from a previous login, logout, or account switch cannot update current state.
- Authenticated position requests must send `X-Expected-User-Id`; the API must reject a missing or mismatched account context before accessing the database.
- A save-all operation must capture both drafts at the start, prevent position editing while it runs, and revalidate the session before reporting success.
- Auth endpoints are rate limited per IP in instance memory (soft cap, serverless-local); keep the limiter dependency-free.
- Position save payloads must use real JSON numbers, stay within the shared storage-safe bounds, use at most four cost-price decimals, and require a positive cost price for a nonzero holding.
- The notes card must keep the investment disclaimer and the dividend-tax explanation; the register dialog must mention that passwords cannot be recovered.
- For save endpoints, avoid reporting a generic failure after a successful write; if a write succeeds but the returned row is missing or driver-shaped differently, perform a safe post-write lookup before responding.
- Do not place test files under `api/`; Vercel treats source files there as deployable Functions. Keep handler tests under `tests/api/` and exclude generated `.vercel/` output from Vitest discovery.
- Update this `AGENTS.md` whenever product rules, architecture choices, or major decisions change.
- Maintain `HANDOFF.md` with current implementation status and next-step guidance for future handoff.
- Do not commit or store secrets such as GitHub tokens in the repository.
