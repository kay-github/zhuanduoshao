# HANDOFF

Last updated: 2026-07-09

## Key Progress Memory

- Corporate-action automation for existing holdings is implemented end-to-end in the codebase: provider service, `/api/dividends`, persisted snapshots, `basisDate` on positions, frontend loading, and UI-side adjusted profit/projection calculations.
- Provider strategy is settled for MVP: prefer Tushare Pro when `TUSHARE_TOKEN` is configured, fall back to Eastmoney public `RPT_SHAREBONUS_DET`, treat malformed/empty provider payloads as source failures, then reuse the latest `dividend_snapshots`, then fall back to empty corporate-action records.
- Quote strategy is also hardened: Eastmoney + Tencent + Sina public quote providers, persisted `quote_snapshots`, and built-in fallback quote data only as the final fallback.
- Mobile UI has been refined for the quote cards and market-cap scenarios: quote title is now shorter, quote cards are single-column, latest price follows gain/loss color, market cap display switches between `亿` and `万亿`, target input uses `万亿`, scenario cards use a less crowded mobile layout, and each scenario shows distance from current price.
- Position save responses are hardened: `PUT /api/positions` no longer depends solely on Drizzle `.returning()` and tolerates string/Date timestamp values, avoiding a false "service unavailable" response after a successful write.
- Default/new-user position quantity is now `0`; the frontend migrates the old implicit `2000` share demo default back to `0` when it appears in local browser drafts.
- Calculation rule now treats `quantity * costPrice` as original cost; applies implemented cash dividend, bonus share, and transfer records where `exDate > basisDate` and `exDate <= today`; adjusts effective quantity by share ratios; adds cash dividends to total return; excludes rights issues by default because they require user subscription/payment.
- Latest verification passed: `npm run typecheck:server`, `npm run build`, `git diff --check`, live `listDividends()` and live `listQuotes()` smoke tests.
- Live dividend smoke details: `300502` returned 10 records, latest implemented action was `2026-06-11` with `10转4股派10.00元`; `300308` returned 18 records, with the latest pre-disclosure lacking `exDate`, so it is not applied.
- Tushare account/token cannot be created or configured automatically without user-owned credentials, but the app is already token-ready through `TUSHARE_TOKEN`.
- Remaining work is mainly environment/deployment verification: configure `POSTGRES_URL`, `AUTH_SECRET`, optionally `TUSHARE_TOKEN`, run DB migration/push against the real database, then verify `/api/quotes`, `/api/dividends`, auth, and position save/restore through `vercel dev` or production.

## Current Status

Project name:
- `赚多少`

Current state:
- Frontend scaffolded with `TypeScript + Vue 3 + Vite`
- UI is in a refined MVP stage with mobile web as the priority
- Backend foundation has been added for `Vercel Functions + PostgreSQL + Drizzle`
- Real public quote integration is connected behind `lib/server/quote-service.ts`, with Sina added as a backup public source after local testing showed Eastmoney can fail while Tencent remains live
- Frontend is wired to quotes/auth/positions APIs
- Auth and positions flows depend on real environment variables and database availability
- Runtime hardening has been added for Vercel Functions deployment
- Runtime database access now uses `pg + drizzle-orm/node-postgres` for Vercel Postgres compatibility
- Production register/login/session/position persistence path has been smoke-tested successfully
- Quote runtime now uses multi-provider fetch plus persisted quote snapshots in PostgreSQL
- Corporate action runtime now fetches dividend/bonus/transfer data and uses persisted dividend snapshots as fallback

## What Is Already Done

### Frontend

- Main page implemented in `src/App.vue`
- Visual direction is a concise tool-style dark UI
- Mobile-first layout is in place
- Product name corrected to `赚多少`
- Stock area shows the 2 fixed stocks directly instead of a dropdown
- Current selected stock can be switched by clicking stock cards
- Target market-cap input uses `万亿元`; display now switches automatically between `亿元` and `万亿元`
- Quote card title is shortened to `行情`, and the old top-left stock kicker was removed
- Quote cards now stack one per row instead of two side by side
- Latest price and gain/loss percentage now both use gain/loss color
- Mobile scenario cards were redesigned to emphasize target market cap, target price, distance from current price, total return rate, holding value, and total return without crowding the card
- Quote update time is shown once in the stock section header
- Explanatory copy was reduced and moved to a bottom notes card
- Frontend now loads quotes from `/api/quotes`
- Frontend now loads dividend/bonus/transfer data from `/api/dividends`
- Frontend restores session with `/api/auth/me`
- Frontend supports inline login/register in the header
- Frontend loads saved positions from `/api/positions`
- Logged-in users can save the current stock position with `PUT /api/positions`
- Logged-in users can save both fixed-stock positions in one action
- `PUT /api/positions` falls back to a post-write lookup if the database driver does not return the saved row from `.returning()`
- Position drafts now include `basisDate`, used as the starting date for automatic corporate-action adjustment
- Default position drafts start with `0` shares; users must enter a quantity before the app treats them as holding shares
- Unauthenticated position drafts, selected stock, and custom target market cap are persisted in browser local storage

### Calculation Logic In UI

- Original cost amount = `quantity * costPrice`
- Implemented dividends/bonus shares/transfers with `exDate > basisDate` and `exDate <= today` are automatically applied
- Effective quantity is adjusted by bonus/transfer ratios
- Cash dividend amount is added to total return
- Current holding value = `effective quantity * latestPrice`
- Current profit = `current holding value + cash dividend amount - original cost amount`
- Current profit rate = `current profit / original cost amount`
- Future target price = `latestPrice * targetMarketCap / currentTotalMarketCap`
- Future target holding value = `effective quantity * targetPrice`
- Total future profit = `target holding value + cash dividend amount - original cost amount`
- Additional profit from now = `target holding value - current holding value`

Default target market caps:
- `10000 亿`
- `12000 亿`
- `13000 亿`
- `15000 亿`
- `18000 亿`
- `20000 亿`
- plus one custom target

### Shared Data

- Fixed stock list extracted to `shared/stocks.ts`
- `shared/stocks.ts` now stores stock metadata plus fallback quote data

### Backend Foundation

- `api/auth/register.ts`
- `api/auth/login.ts`
- `api/auth/logout.ts`
- `api/auth/me.ts`
- `api/positions.ts`
- `api/quotes.ts`
- `api/dividends.ts`

### Quote Integration

- `lib/server/quote-service.ts` now fetches real quotes from Eastmoney, Tencent, and Sina public quote sources
- The quote service merges providers per stock and uses provider order to fill missing fields/stocks
- Successful live quotes are persisted into `quote_snapshots` in PostgreSQL
- If live sources fail, quote service falls back to the latest successful snapshot before using built-in demo quote data
- Quote fetches use a short timeout and in-memory cache to reduce repeated third-party calls

### Corporate Action Integration

- `lib/server/dividend-service.ts` fetches dividend/bonus/transfer records
- If `TUSHARE_TOKEN` is configured, Tushare Pro is tried first
- Without a Tushare token, or if Tushare fails, the service falls back to Eastmoney public `RPT_SHAREBONUS_DET`
- Successful live corporate-action records are persisted into `dividend_snapshots`
- If live sources fail, the service falls back to the latest successful dividend snapshot before using empty corporate-action data
- Rights issues are not automatically assumed as subscribed because they require user action/payment

### Runtime Hardening

- Server-side local imports were switched to explicit `.js` specifiers for more reliable Vercel ESM runtime resolution
- API responses now use plain `res.end()` JSON output instead of framework helper chaining
- API handlers now catch unexpected runtime/config errors and return JSON error payloads instead of generic crashes
- Database initialization is lazy so quote-only endpoints do not fail just because DB env vars are missing

### Auth Design Implemented

- Username + password
- HttpOnly cookie session
- JWT session token via `jose`
- Password hashing via `bcryptjs`

### Database Foundation

- Drizzle config added in `drizzle.config.ts`
- Schema added in `lib/server/schema.ts`
- DB client added in `lib/server/db.ts`
- Initial migration generated in `drizzle/0000_pretty_malice.sql`
- `.env.example` added

Tables currently designed:
- `users`
- `positions`
- `quote_snapshots`
- `dividend_snapshots`

Current positions rule:
- One current position per user per stock
- Each position has a `basisDate` for automatic corporate-action adjustment

## Verified So Far

Commands that passed:
- `npm run build`
- `npm run typecheck:server`
- `npm run db:generate`
- `npm run db:push -- --force`

Additional runtime smoke check that passed:
- `npx tsx -e "import { listQuotes } from './lib/server/quote-service.ts'; (async () => { const quotes = await listQuotes(); console.log(JSON.stringify(quotes, null, 2)); })();"`
- `npm run build`
- `npm run typecheck:server`
- Production smoke test passed for `POST /api/auth/register`, `GET /api/auth/me`, `PUT /api/positions`, `GET /api/positions`
- Production `GET /api/quotes` now returns `freshness` and `source`, and was verified to return live quote data
- `npx tsx -e "import { listDividends } from './lib/server/dividend-service.ts'; (async () => { const feed = await listDividends(); console.log(JSON.stringify({ freshness: feed.freshness, source: feed.source, counts: feed.dividends.map((item) => ({ code: item.code, records: item.records.length, latest: item.records[0] })) }, null, 2)); })().catch((error) => { console.error(error); process.exit(1); });"`
- Latest dividend smoke check returned live Eastmoney records for both fixed stocks
- 2026-07-09 verification passed: `npm run typecheck:server`, `npm run build`, `git diff --check`, live `listQuotes()` smoke test, and mobile browser visual check at 390px width
- 2026-07-09 quote smoke returned live Tencent data for both fixed stocks; Eastmoney failed locally, so Sina was added as an extra backup provider while keeping Eastmoney in the provider chain
- 2026-07-09 follow-up verification passed: `npm run typecheck:server`, `npm run build`, `git diff --check`, live `listQuotes()` smoke test, and 390px mobile browser checks for stacked quote cards, stock switching, `万亿` target input, custom target auto-inclusion, and `距离现价`.
- 2026-07-09 position-save hardening verification passed: `npm run typecheck:server`, `npm run build`, `git diff --check`; read-only DB check confirmed local `updatedAt` currently returns as `Date`, while the API is now defensive for string timestamps and empty `.returning()` results.
- 2026-07-09 default-position verification passed: `npm run typecheck:server`, `npm run build`, `git diff --check`; new drafts now start at `0` shares and old local demo defaults are migrated away.

## Lessons And Pitfalls

- Public quote providers are unstable by nature. Eastmoney failed from the local environment while Tencent still returned live data, so quote changes should be checked with a real `listQuotes()` smoke test and should keep multiple providers plus snapshot fallback.
- Do not treat a public provider's empty or malformed payload as valid data. It should count as provider failure so the service can try the next source or use the last successful snapshot.
- The UI target market-cap input is in `万亿`, but the scenario model still stores and calculates target market cap in `亿元`. Use the computed conversion layer in `src/App.vue`; do not mix units directly inside projection formulas.
- New and anonymous users must not get nonzero demo holdings. Default quantity is `0`, and old local browser drafts that exactly match the former implicit `2000 股 / 84.5 成本` demo default are migrated back to `0`.
- Corporate actions should only apply to actual holdings. The `basisDate` gate is important because it prevents historical dividends/bonus shares from being applied to a newly entered position.
- Only implemented dividend/bonus/transfer records should change quantity or cash return. Pre-disclosure records without an `exDate`, or actions before/equal to `basisDate`, should not affect calculations.
- Rights issues are intentionally excluded from automatic adjustments because they require user subscription/payment; assuming participation would overstate returns.
- `PUT /api/positions` can write successfully and still fail while building the response if the database driver returns no row from `.returning()` or a timestamp shape changes. Keep the post-write lookup and `Date|string` timestamp normalization.
- When debugging a "save failed but data appears saved" report, inspect the server response phase separately from the database write. A subsequent page reload showing saved data usually means the write succeeded and response serialization failed.
- Mobile layout bugs often show up as horizontal overflow, not obvious visual breakage. After layout changes, check a 390px viewport and verify `document.documentElement.scrollWidth` does not exceed the viewport width.
- Grid/flex children that contain stock names, money values, or long badges should usually have `min-width: 0`, stable card dimensions, and overflow handling before adding more visual styling.
- Local Vite is useful for frontend layout, but full auth/positions API verification should use `vercel dev` or production because the frontend calls `/api/*`.
- The user's GitHub token must never be written into repo files, logs, remotes, or docs. Prefer SSH or existing HTTPS credentials; if HTTPS is needed, avoid embedding tokens in remote URLs.
- The machine-level Git proxy can be stale (`127.0.0.1:10808` was unavailable). For one-off GitHub operations, `git -c http.proxy= -c https.proxy= ...` can bypass that config without changing global settings.

## Current Constraints And Gaps

- Auth and positions endpoints require `POSTGRES_URL` and `AUTH_SECRET`; without them those flows cannot run end-to-end
- Tushare Pro is optional; configure `TUSHARE_TOKEN` to use it as the preferred corporate-action source
- Database config now also accepts Vercel Storage-style prefixed variables such as `zhuan_POSTGRES_URL` or `zhuan_DATABASE_URL`
- `drizzle.config.ts` now also reads `.env.local`, so `vercel env pull .env.local` can be used directly before `npm run db:push`
- Local API development should now use `vercel dev`, because the frontend actively calls `/api/*`
- No automated end-to-end coverage exists yet for auth and position persistence
- Quote refresh depends on a public third-party interface and does not guarantee long-term SLA
- Eastmoney corporate-action refresh depends on public page-backed endpoints and does not guarantee long-term SLA
- The project currently relies on a manually linked Vercel project in `.vercel/`, which remains gitignored and should not be committed

## Environment Variables Needed Later

Defined in `.env.example`:
- `POSTGRES_URL`
- `AUTH_SECRET`
- `TUSHARE_TOKEN` optional; leave empty to use Eastmoney-only corporate-action data

Notes:
- Use a Neon-compatible PostgreSQL connection string
- Do not commit real secrets into the repository

## Important Files

Product rules:
- `AGENTS.md`

Reusable notes:
- `CORPORATE_ACTIONS_REUSE_GUIDE.md`

Current UI:
- `src/App.vue`
- `src/style.css`

Shared stock definitions:
- `shared/stocks.ts`

Server helpers:
- `lib/server/db.ts`
- `lib/server/schema.ts`
- `lib/server/auth.ts`
- `lib/server/http.ts`
- `lib/server/quote-service.ts`
- `lib/server/dividend-service.ts`

API routes:
- `api/auth/register.ts`
- `api/auth/login.ts`
- `api/auth/logout.ts`
- `api/auth/me.ts`
- `api/positions.ts`
- `api/quotes.ts`
- `api/dividends.ts`

Database files:
- `drizzle.config.ts`
- `drizzle/0000_pretty_malice.sql`
- `drizzle/0001_plain_chronomancer.sql`

## Recommended Next Steps

### Priority 1

- Configure database locally and on Vercel
- Set `POSTGRES_URL`
- Set `AUTH_SECRET`
- Optionally set `TUSHARE_TOKEN`
- Run `npm run db:push`

### Priority 2

- Recheck deployed `/api/quotes` and `/api/auth/me` after the latest patch is deployed
- Recheck deployed `/api/dividends`
- Run end-to-end verification through `vercel dev`
- Register a user
- Log in and out
- Save both stock positions
- Reload the page and confirm saved positions are restored
- Set a historical `basisDate` before 300502's 2026-06-11 ex-date and confirm effective quantity/cash dividend adjustment appears

### Priority 3

- Decide whether to configure Tushare Pro as the long-term preferred corporate-action provider

## Suggested Workflow For The Next AI

1. Read `AGENTS.md`
2. Read this `HANDOFF.md`
3. Check `src/App.vue` and `shared/stocks.ts`
4. Check `lib/server/*` and `api/*`
5. Confirm whether the next task is environment setup, end-to-end verification, or further UX polish

## Maintenance Rule

After any meaningful product, architecture, or implementation change:
- Update `AGENTS.md` if product rules or architecture changed
- Update this `HANDOFF.md` with current status and next steps
