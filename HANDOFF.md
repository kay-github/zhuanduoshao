# HANDOFF

Last updated: 2026-07-21

## Key Progress Memory

- 2026-07-21 production release: hardening commits `8cf3486` and `7cbb05d` were pushed to `origin/main` and deployed to Vercel production at `https://xd.688680.xyz`. Public homepage/quote/dividend/auth checks passed, followed by a temporary-account register/session/save/read/mismatch/logout E2E; the temporary user and cascaded position were removed afterward.
- 2026-07-21 hardening round: auth configuration is validated before writes; bcrypt passwords are capped at 72 UTF-8 bytes; auth mutations require JSON; malformed cookies no longer cause 500s; stale `/api/auth/me` responses cannot clear a newer session; frontend session epochs and `X-Expected-User-Id` protect logout/account-switch and multi-tab races; save-all uses fixed draft snapshots; position payloads use shared strict numeric validation; save responses safely re-read missing or driver-shaped rows; anonymous drafts use a versioned local-storage scope and China-calendar dates; only explicitly implemented corporate actions affect returns; quote/dividend persistence is isolated per stock; quote snapshots/history update monotonically by `quote_as_of`; provider and snapshot validation is strict; smoke scripts now assert valid live data instead of only printing it. Full check: 20 files / 140 tests.
- 2026-07-19: share-card export shipped. `src/lib/share-card.ts` builds pure card data (unit-tested), `src/lib/share-card-renderer.ts` renders a 2x canvas PNG and prefers the Web Share API (mobile) with download fallback. Entry points: a share button on every mobile scenario card and a 分享 column in the desktop table. Verified with headless Chromium at 390px: no horizontal overflow, PNG renders correctly with profit headline, metric panel, and disclaimer.
- 2026-07-18 hardening round: fallback quotes refreshed to live values (AGENTS.md documents the ~30% drift refresh rule), auth rate limiting now failure-only for login (50/10min, testable factory + unit tests), `quote_history` table (migration 0003, pushed to production) captures one row per stock per trade date via upsert during trading hours.
- 2026-07-18 product round implemented on top of the quote-hardening refactor: draft-merge on login, dividend tax brackets, reverse projection (target profit → required price/market cap), custom target price-input mode, trading-session auto-refresh, auth rate limiting, disclaimer/tax notes, per-stock `getQuote` freshness, CI dedup.
- Migrations through `drizzle/0003_colossal_ronan.sql` were previously applied and the current database contract was re-verified on 2026-07-21 with `npm run db:verify`, including column types/precision/nullability/defaults, primary keys, unique indexes, and foreign keys for all five tables.
- Corporate-action automation for existing holdings is implemented end-to-end in the codebase: provider service, `/api/dividends`, persisted snapshots, `basisDate` on positions, frontend loading, and UI-side adjusted profit/projection calculations.
- Provider strategy is settled for MVP: prefer Tushare Pro when `TUSHARE_TOKEN` is configured, fall back to Eastmoney public `RPT_SHAREBONUS_DET`, treat malformed/empty provider payloads as source failures, then reuse the latest `dividend_snapshots`, then fall back to empty corporate-action records.
- Quote strategy is also hardened: Eastmoney + Tencent + Sina public quote providers, strict field validation with `validateLiveQuoteFields`, persisted `quote_snapshots` (with monotonic `quote_as_of` updates shared by snapshot/history persistence), and built-in fallback quote data only as the final fallback. A newer stored snapshot wins over an older live response.
- Calculation rule treats `quantity * costPrice` as original cost; applies implemented cash dividend, bonus share, and transfer records where `exDate > basisDate` and `exDate <= today`; adjusts effective quantity by share ratios; deducts dividend tax by the user-selected holding-period bracket; adds after-tax cash dividends to total return; excludes rights issues by default.
- Tushare account/token cannot be created or configured automatically without user-owned credentials, but the app is already token-ready through `TUSHARE_TOKEN`.

## Current Status

Project name:
- `赚多少`

Current state (2026-07-21):
- Frontend `TypeScript + Vue 3 + Vite`, split into `AppHeader` / `QuotePanel` / `ScenarioProjectionPanel` components with pure calculation logic in `src/lib/portfolio-calculations.ts` (vitest-covered)
- Backend `Vercel Functions + PostgreSQL + Drizzle`, quote/dividend services with multi-provider + snapshot fallback
- New this round (all implemented, verified by `npm run check`):
  - Login/register no longer wipes nonzero unauthenticated drafts; server positions merge over drafts and the UI prompts to save unsaved local input
  - `selectedScenarioTargets` restore falls back to defaults when the persisted list filters to empty
  - Dividend tax bracket selector (`>1y` free / `1m-1y` 10% / `<1m` 20%) applied to cash dividends across current and projected returns; summary shows pre-tax and tax amounts
  - Reverse projection: input a target total profit (`万元`) → required price, distance from current price, implied total market cap
  - Custom target supports market-cap (`万亿`) and price-per-share (`元`) input modes, converted through the live cap/price ratio
  - Quotes auto-refresh every 30s during A-share trading sessions while the page is visible; session state shown in the quote header
  - Login is rate limited by IP and username; registration is rate limited by IP (50 failures/attempts per 10 min depending on endpoint, instance memory)
  - Login/register/logout require JSON requests; `/api/auth/me` no longer clears the cookie on 401
  - Session epochs prevent stale authenticated loads/saves from mutating state after logout or account switching
  - Position GET/PUT send `X-Expected-User-Id`; missing or mismatched account context returns 409 before any database access
  - Save-all captures both stock drafts at start, disables position editing while pending, and rechecks the session before reporting success
  - Position decimal validation is shared by frontend/backend and accepts at most four cost-price decimals without exponent-rounding gaps
  - Quote snapshot/history persistence is monotonic by `quote_as_of`, and newer persisted data takes priority over an older live response
  - Notes card includes dividend-tax explanation and investment disclaimer; register dialog warns passwords cannot be recovered
  - `getQuote` reports per-stock freshness via `freshnessByCode`; CI no longer double-runs typechecks
- The 2026-07-21 hardening changes are committed, pushed, and deployed to production. Live no-persist market-data smoke, database contract verification, full build/tests, 390px overflow checks, and a temporary production-account API E2E have passed. A true two-tab browser account-switch E2E is still pending.

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
- Authenticated position loads and saves are bound to a session epoch and expected user ID, preventing stale requests from crossing account changes
- Saving both positions uses immutable start-of-save drafts and temporarily disables all position inputs
- `PUT /api/positions` falls back to a post-write lookup if the database driver does not return the saved row from `.returning()`
- Position drafts now include `basisDate`, used as the starting date for automatic corporate-action adjustment
- Default position drafts start with `0` shares; users must enter a quantity before the app treats them as holding shares
- Unauthenticated position drafts, selected stock, and custom target market cap are persisted in browser local storage

### Calculation Logic In UI

- Original cost amount = `quantity * costPrice`
- Implemented dividends/bonus shares/transfers with `exDate > basisDate` and `exDate <= today` are automatically applied
- Effective quantity is adjusted by bonus/transfer ratios
- After-tax cash dividend amount is added to total return
- Current holding value = `effective quantity * latestPrice`
- Current profit = `current holding value + after-tax cash dividend amount - original cost amount`
- Current profit rate = `current profit / original cost amount`
- Future target price = `latestPrice * targetMarketCap / currentTotalMarketCap`
- Future target holding value = `effective quantity * targetPrice`
- Total future profit = `target holding value + after-tax cash dividend amount - original cost amount`
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
- Snapshot and daily history rows only accept updates whose `quote_as_of` is at least as new as the stored row
- The service re-reads persisted snapshots after live persistence so a concurrent newer snapshot can supersede an older provider response
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
- Database verification checks the full five-table contract, including exact defaults and usable non-partial/non-expression primary and unique indexes plus foreign keys

### Auth Design Implemented

- Username + password
- HttpOnly cookie session
- JWT session token via `jose`
- Password hashing via `bcryptjs`
- Login, registration, and logout accept JSON requests only
- `/api/auth/me` treats 401 as an observation and does not clear a possibly newer session cookie
- Position access requires the client-declared expected user ID to match the cookie session

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
- `quote_history`

Current positions rule:
- One current position per user per stock
- Each position has a `basisDate` for automatic corporate-action adjustment

## Verified So Far

2026-07-21 working-tree checks:
- `npm run check` (20 test files / 140 tests, frontend and server typechecks, Vite production build, Drizzle migration check)
- `npm run smoke:data:no-persist` (both stocks live through Tencent quotes and Eastmoney corporate actions; persistence disabled)
- `npm run db:verify` (all 5 application tables match column type/precision/nullability/default, primary-key, unique-index, and foreign-key contracts)
- `npm audit --omit=dev` (0 vulnerabilities)
- `npm audit` (7 high + 7 moderate findings, all in the development toolchain; the suggested automatic fix requires inappropriate major-version changes)
- `git diff --check`

Additional 2026-07-21 UI verification:
- Chrome at a `390x844` viewport had no horizontal overflow; stock drafts/tax brackets stayed independent and custom price-target mode worked.

2026-07-21 production deployment verification:
- Commits `8cf3486` and `7cbb05d` were pushed to `origin/main`; Vercel production is aliased to `https://xd.688680.xyz`.
- Homepage returned 200; quotes and dividends returned both configured stocks with `live` freshness.
- A temporary production account completed JSON-only rejection, registration, session restore, empty position load, four-decimal position save, position restore, mismatched-account 409, logout, and post-logout 401 checks.
- The temporary production user and its cascaded position were deleted immediately after the smoke test.
- A true two-tab browser UI E2E has not been run; the underlying API mismatch behavior was verified in production.

Historical production/runtime checks (not rerun as part of the 2026-07-21 working-tree verification):
- `npx tsx -e "import { listQuotes } from './lib/server/quote-service.ts'; (async () => { const quotes = await listQuotes(); console.log(JSON.stringify(quotes, null, 2)); })();"`
- `npm run build`
- `npm run typecheck:server`
- `npm run db:generate`
- `npm run db:push -- --force`
- Production smoke test passed for `POST /api/auth/register`, `GET /api/auth/me`, `PUT /api/positions`, `GET /api/positions`
- Production `GET /api/quotes` now returns `freshness` and `source`, and was verified to return live quote data
- `npx tsx -e "import { listDividends } from './lib/server/dividend-service.ts'; (async () => { const feed = await listDividends(); console.log(JSON.stringify({ freshness: feed.freshness, source: feed.source, counts: feed.dividends.map((item) => ({ code: item.code, records: item.records.length, latest: item.records[0] })) }, null, 2)); })().catch((error) => { console.error(error); process.exit(1); });"`
- Latest dividend smoke check returned live Eastmoney records for both fixed stocks
- 2026-07-09 verification passed: `npm run typecheck:server`, `npm run build`, `git diff --check`, live `listQuotes()` smoke test, and mobile browser visual check at 390px width
- 2026-07-09 quote smoke returned live Tencent data for both fixed stocks; Eastmoney failed locally, so Sina was added as an extra backup provider while keeping Eastmoney in the provider chain
- 2026-07-09 follow-up verification passed: `npm run typecheck:server`, `npm run build`, `git diff --check`, live `listQuotes()` smoke test, and 390px mobile browser checks for stacked quote cards, stock switching, `万亿` target input, custom target auto-inclusion, and `距离现价`.
- 2026-07-09 position-save hardening verification passed: `npm run typecheck:server`, `npm run build`, `git diff --check`; read-only DB check confirmed local `updatedAt` currently returns as `Date`, while the API is now defensive for string timestamps and empty `.returning()` results.
- 2026-07-09 default-position verification passed: `npm run typecheck:server`, `npm run build`, `git diff --check`; new drafts now start at `0` shares and old local demo defaults are migrated away.
- 2026-07-10 production DB fix passed: Vercel logs confirmed `column "basis_date" does not exist`; `npm run db:push -- --force` applied the production schema change, then live `POST /api/auth/register`, `PUT /api/positions`, and `GET /api/positions` succeeded with a temporary test account that was deleted afterward.

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
- Also check production Vercel logs before assuming the bug is in frontend state. The 2026-07-10 save failure was caused by DB schema drift: deployed code expected `positions.basis_date`, but production DB had not run the migration yet.
- After adding Drizzle migrations or schema fields, run/push the migration against the real production database before relying on the deployed API.
- Mobile layout bugs often show up as horizontal overflow, not obvious visual breakage. After layout changes, check a 390px viewport and verify `document.documentElement.scrollWidth` does not exceed the viewport width.
- Grid/flex children that contain stock names, money values, or long badges should usually have `min-width: 0`, stable card dimensions, and overflow handling before adding more visual styling.
- Local Vite is useful for frontend layout, but full auth/positions API verification should use `vercel dev` or production because the frontend calls `/api/*`.
- The user's GitHub token must never be written into repo files, logs, remotes, or docs. Prefer SSH or existing HTTPS credentials; if HTTPS is needed, avoid embedding tokens in remote URLs.
- The machine-level Git proxy can be stale (`127.0.0.1:10808` was unavailable). For one-off GitHub operations, `git -c http.proxy= -c https.proxy= ...` can bypass that config without changing global settings.
- 2026-07-18 push friction: SSH to github.com port 22 is blocked in this environment and no SSH key exists locally, so `origin` was switched to HTTPS. The system credential.helper chain (`manager` + `store`) produced 401/403 on push even though the stored PATs are valid; pushing works reliably with `GIT_ASKPASS` pointing at a throwaway script that feeds a token read from `~/.git-credentials`, combined with `-c credential.helper=`. Never echo tokens into logs or commit them.
- Vercel builds resolve devDependency types themselves: `@types/pg` was only available transitively (via drizzle-orm) locally, and the first production build failed `typecheck:server` with TS7016 until it was declared explicitly in `devDependencies`.

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
- `shared/numeric.ts`

Frontend state helpers:
- `src/lib/position-draft-state.ts`
- `src/lib/session-epoch.ts`

Server helpers:
- `lib/server/db.ts`
- `lib/server/schema.ts`
- `lib/server/auth.ts`
- `lib/server/auth-input.ts`
- `lib/server/errors.ts`
- `lib/server/http.ts`
- `lib/server/rate-limit.ts`
- `lib/server/position-input.ts`
- `lib/server/write-result.ts`
- `lib/server/market-data-persistence.ts`
- `lib/server/quote-service.ts`
- `lib/server/dividend-service.ts`

Operational scripts:
- `scripts/runtime-env.ts`
- `scripts/smoke-market-data.ts`
- `scripts/verify-database-schema.ts`
- `scripts/audit-quote-history.ts`

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
- `drizzle/0002_cooing_joystick.sql`
- `drizzle/0003_colossal_ronan.sql`

## Recommended Next Steps

### Priority 1

- Monitor Vercel function logs and public-provider freshness after the 2026-07-21 release.
- Consider pinning the Vercel Node major instead of allowing future automatic major upgrades through the current `engines.node` range.

### Priority 2

- Run a browser E2E in an isolated/test database: preserve a nonzero anonymous draft across registration/login, explicitly save it, reload, and verify logout restores only the anonymous draft scope.
- Run a two-tab account-switch E2E and confirm the stale tab gets 409 without reading or writing the newly active account.
- Add Vue component-level coverage for stale session responses/save races, a matching expected-user success path, and compiled monotonic-upsert SQL.
- Exercise 429 behavior separately for login IP, login username, and registration IP namespaces. The limiter remains a per-instance serverless soft cap and concurrent requests can still race before failed attempts are recorded.
- Verify dividend tax interactively with a basis date before a known implemented ex-date and switch all three tax brackets.

### Priority 3

- Decide whether to configure Tushare Pro as the long-term preferred corporate-action provider
- P2 backlog from the 2026-07-18 product review (deliberately deferred): historical value curve (quote_history is accumulating daily rows since 2026-07-18), multi-lot positions, PWA manifest. Share-card image export shipped 2026-07-19.

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
