import { disableDatabaseForCurrentProcess, loadProjectEnv } from './runtime-env.js'
import { STOCKS } from '../shared/stocks.js'

loadProjectEnv()

const noPersist = process.argv.includes('--no-persist')

if (noPersist) {
  disableDatabaseForCurrentProcess()
}

const [{ listQuotes, validateLiveQuoteFields }, { listDividends }] = await Promise.all([
  import('../lib/server/quote-service.js'),
  import('../lib/server/dividend-service.js'),
])
const [quoteFeed, dividendFeed] = await Promise.all([listQuotes(), listDividends()])
const validationErrors: string[] = []
const expectedCodes = new Set<string>(STOCKS.map((stock) => stock.code))

function validateStockCoverage(label: string, items: Array<{ code: string }>) {
  const actualCodes = items.map((item) => item.code)
  const uniqueCodes = new Set(actualCodes)

  if (items.length !== STOCKS.length || uniqueCodes.size !== items.length) {
    validationErrors.push(`${label} must contain exactly one item for each configured stock`)
  }

  for (const code of expectedCodes) {
    if (!uniqueCodes.has(code)) {
      validationErrors.push(`${label} is missing stock ${code}`)
    }
  }

  for (const code of uniqueCodes) {
    if (!expectedCodes.has(code)) {
      validationErrors.push(`${label} contains unexpected stock ${code}`)
    }
  }
}

validateStockCoverage('quotes', quoteFeed.quotes)
validateStockCoverage('dividends', dividendFeed.dividends)

if (quoteFeed.freshness === 'fallback') {
  validationErrors.push('quotes resolved to built-in fallback data')
}

for (const quote of quoteFeed.quotes) {
  if (!validateLiveQuoteFields(quote)) {
    validationErrors.push(`quote ${quote.code} has invalid fields or an abnormal market timestamp`)
  }
}

const hasDividendRecords = dividendFeed.dividends.some(
  (item) => Array.isArray(item.records) && item.records.length > 0,
)

if (!hasDividendRecords) {
  validationErrors.push('dividends resolved entirely to empty fallback data')
}

if (noPersist && dividendFeed.freshness !== 'live') {
  validationErrors.push(`no-persist dividend smoke requires live provider data, received ${dividendFeed.freshness}`)
}

if (noPersist) {
  for (const item of dividendFeed.dividends) {
    if (!Array.isArray(item.records) || item.records.length === 0) {
      validationErrors.push(`no-persist dividend smoke received no provider records for ${item.code}`)
    }
  }
}

const summary = {
  quotes: {
    freshness: quoteFeed.freshness,
    source: quoteFeed.source,
    items: quoteFeed.quotes.map((quote) => ({
      code: quote.code,
      latestPrice: quote.latestPrice,
      totalMarketCap: quote.totalMarketCap,
      asOf: quote.asOf,
    })),
  },
  dividends: {
    freshness: dividendFeed.freshness,
    source: dividendFeed.source,
    items: dividendFeed.dividends.map((item) => ({
      code: item.code,
      records: item.records.length,
      latestImplementedExDate:
        item.records
          .filter((record) => record.exDate && record.planProgress.includes('实施'))
          .map((record) => record.exDate)
          .sort()
          .at(-1) ?? null,
    })),
  },
  persistence: noPersist ? 'disabled' : 'enabled-when-database-is-configured',
  validation: validationErrors.length === 0 ? 'passed' : validationErrors,
}

console.log(JSON.stringify(summary, null, 2))

if (validationErrors.length > 0) {
  throw new Error(`Market data smoke check failed:\n- ${validationErrors.join('\n- ')}`)
}
