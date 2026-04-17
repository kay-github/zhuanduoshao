# HANDOFF

## Current Status

Project name:
- `赚多少`

Current state:
- Frontend scaffolded with `TypeScript + Vue 3 + Vite`
- UI is in a refined MVP stage with mobile web as the priority
- Backend foundation has been added for `Vercel Functions + PostgreSQL + Drizzle`
- Real public quote integration is connected behind `lib/server/quote-service.ts`
- Frontend is wired to quotes/auth/positions APIs
- Auth and positions flows depend on real environment variables and database availability
- Runtime hardening has been added for Vercel Functions deployment
- Runtime database access now uses `pg + drizzle-orm/node-postgres` for Vercel Postgres compatibility
- Production register/login/session/position persistence path has been smoke-tested successfully

## What Is Already Done

### Frontend

- Main page implemented in `src/App.vue`
- Visual direction is a concise tool-style dark UI
- Mobile-first layout is in place
- Product name corrected to `赚多少`
- Stock area shows the 2 fixed stocks directly instead of a dropdown
- Current selected stock can be switched by clicking stock cards
- Market-cap display and input are unified to `亿元`
- Quote update time is shown once in the stock section header
- Explanatory copy was reduced and moved to a bottom notes card
- Frontend now loads quotes from `/api/quotes`
- Frontend restores session with `/api/auth/me`
- Frontend supports inline login/register in the header
- Frontend loads saved positions from `/api/positions`
- Logged-in users can save the current stock position with `PUT /api/positions`
- Logged-in users can save both fixed-stock positions in one action
- Unauthenticated position drafts, selected stock, and custom target market cap are persisted in browser local storage

### Calculation Logic In UI

- Current cost amount = `quantity * costPrice`
- Current holding value = `quantity * latestPrice`
- Current profit = `current holding value - cost amount`
- Current profit rate = `current profit / cost amount`
- Future target price = `latestPrice * targetMarketCap / currentTotalMarketCap`
- Future target holding value = `quantity * targetPrice`
- Total future profit = `target holding value - cost amount`
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

### Quote Integration

- `lib/server/quote-service.ts` now fetches real quotes from the Eastmoney public quote API
- The quote service falls back to built-in demo quote data if the public request fails
- Quote fetches use a short timeout and in-memory cache to reduce repeated third-party calls

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

Current positions rule:
- One current position per user per stock

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

## Current Constraints And Gaps

- Auth and positions endpoints require `POSTGRES_URL` and `AUTH_SECRET`; without them those flows cannot run end-to-end
- Database config now also accepts Vercel Storage-style prefixed variables such as `zhuan_POSTGRES_URL` or `zhuan_DATABASE_URL`
- `drizzle.config.ts` now also reads `.env.local`, so `vercel env pull .env.local` can be used directly before `npm run db:push`
- Local API development should now use `vercel dev`, because the frontend actively calls `/api/*`
- No automated end-to-end coverage exists yet for auth and position persistence
- Quote refresh depends on a public third-party interface and does not guarantee long-term SLA
- The project currently relies on a manually linked Vercel project in `.vercel/`, which remains gitignored and should not be committed

## Environment Variables Needed Later

Defined in `.env.example`:
- `POSTGRES_URL`
- `AUTH_SECRET`

Notes:
- Use a Neon-compatible PostgreSQL connection string
- Do not commit real secrets into the repository

## Important Files

Product rules:
- `AGENTS.md`

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

API routes:
- `api/auth/register.ts`
- `api/auth/login.ts`
- `api/auth/logout.ts`
- `api/auth/me.ts`
- `api/positions.ts`
- `api/quotes.ts`

Database files:
- `drizzle.config.ts`
- `drizzle/0000_pretty_malice.sql`

## Recommended Next Steps

### Priority 1

- Configure database locally and on Vercel
- Set `POSTGRES_URL`
- Set `AUTH_SECRET`
- Run `npm run db:push`

### Priority 2

- Recheck deployed `/api/quotes` and `/api/auth/me` after the latest patch is deployed
- Run end-to-end verification through `vercel dev`
- Register a user
- Log in and out
- Save both stock positions
- Reload the page and confirm saved positions are restored

### Priority 3

- Decide whether to keep Eastmoney as the long-term MVP provider or add a second provider later

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
