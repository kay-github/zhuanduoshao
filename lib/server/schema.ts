import { numeric, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core'

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    username: varchar('username', { length: 24 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('users_username_unique').on(table.username)],
)

export const positions = pgTable(
  'positions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    stockCode: varchar('stock_code', { length: 6 }).notNull(),
    quantity: numeric('quantity', { precision: 20, scale: 0 }).notNull(),
    costPrice: numeric('cost_price', { precision: 18, scale: 4 }).notNull(),
    basisDate: varchar('basis_date', { length: 10 }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex('positions_user_stock_unique').on(table.userId, table.stockCode)],
)

export const quoteSnapshots = pgTable('quote_snapshots', {
  stockCode: varchar('stock_code', { length: 6 }).primaryKey(),
  latestPrice: numeric('latest_price', { precision: 18, scale: 4 }).notNull(),
  totalMarketCap: numeric('total_market_cap', { precision: 20, scale: 0 }).notNull(),
  priceChangePct: numeric('price_change_pct', { precision: 10, scale: 4 }).notNull(),
  quoteUpdatedAt: varchar('quote_updated_at', { length: 8 }).notNull(),
  source: varchar('source', { length: 32 }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
})

export const dividendSnapshots = pgTable('dividend_snapshots', {
  stockCode: varchar('stock_code', { length: 6 }).primaryKey(),
  payload: text('payload').notNull(),
  source: varchar('source', { length: 32 }).notNull(),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
})

export type UserRecord = typeof users.$inferSelect
export type PositionRecord = typeof positions.$inferSelect
export type QuoteSnapshotRecord = typeof quoteSnapshots.$inferSelect
export type DividendSnapshotRecord = typeof dividendSnapshots.$inferSelect
