import { Pool } from 'pg'

import { getProjectDatabaseUrl, loadProjectEnv } from './runtime-env.js'

loadProjectEnv()

const databaseUrl = getProjectDatabaseUrl()

if (!databaseUrl) {
  throw new Error('Database URL is not configured. Load the target environment before auditing quote history.')
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 })

try {
  const { rows } = await pool.query<{
    stock_code: string
    trade_date: string
    quote_date_cn: string | null
    quote_as_of: Date | null
  }>(`
    select
      stock_code,
      trade_date::text,
      case
        when quote_as_of is null then null
        else (quote_as_of at time zone 'Asia/Shanghai')::date::text
      end as quote_date_cn,
      quote_as_of
    from quote_history
    where extract(isodow from trade_date) in (6, 7)
       or quote_as_of is null
       or trade_date <> (quote_as_of at time zone 'Asia/Shanghai')::date
    order by trade_date, stock_code
  `)

  if (rows.length === 0) {
    console.log('Quote history audit passed: no weekend or quote-date mismatches found.')
  } else {
    console.table(rows)
    throw new Error(`Quote history audit found ${rows.length} invalid row(s). Review them before any cleanup.`)
  }
} finally {
  await pool.end()
}
