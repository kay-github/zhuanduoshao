import { STOCKS, getFallbackQuote, listFallbackQuotes, type StockCode, type StockQuote } from '../../shared/stocks.js'

const QUOTE_API_URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get'
const QUOTE_FIELDS = 'f2,f3,f12,f20,f124'
const QUOTE_CACHE_TTL_MS = 15_000
const QUOTE_TIMEOUT_MS = 5_000

let cachedQuotes: StockQuote[] | null = null
let cacheExpiresAt = 0
let pendingQuotesRequest: Promise<StockQuote[]> | null = null

interface EastmoneyQuoteRow {
  f2?: number
  f3?: number
  f12?: string
  f20?: number
  f124?: number
}

interface EastmoneyQuoteResponse {
  data?: {
    diff?: EastmoneyQuoteRow[]
  }
}

function formatUpdatedAt(timestampSeconds: number | undefined, fallbackValue: string) {
  if (!timestampSeconds || !Number.isFinite(timestampSeconds)) {
    return fallbackValue
  }

  const chinaTime = new Date(timestampSeconds * 1000 + 8 * 60 * 60 * 1000)
  const hours = String(chinaTime.getUTCHours()).padStart(2, '0')
  const minutes = String(chinaTime.getUTCMinutes()).padStart(2, '0')
  const seconds = String(chinaTime.getUTCSeconds()).padStart(2, '0')

  return `${hours}:${minutes}:${seconds}`
}

function cloneQuotes(quotes: StockQuote[]) {
  return quotes.map((quote) => ({ ...quote }))
}

function mapProviderQuote(row: EastmoneyQuoteRow): StockQuote | null {
  const code = typeof row.f12 === 'string' ? row.f12 : null

  if (!code) {
    return null
  }

  const stock = STOCKS.find((candidate) => candidate.code === code)

  if (!stock) {
    return null
  }

  return {
    code: stock.code,
    name: stock.name,
    label: stock.label,
    latestPrice: Number.isFinite(row.f2) ? Number(row.f2) : stock.fallbackQuote.latestPrice,
    totalMarketCap: Number.isFinite(row.f20) ? Number(row.f20) : stock.fallbackQuote.totalMarketCap,
    priceChangePct: Number.isFinite(row.f3) ? Number(row.f3) : stock.fallbackQuote.priceChangePct,
    updatedAt: formatUpdatedAt(row.f124, stock.fallbackQuote.updatedAt),
  }
}

async function fetchQuotesFromProvider() {
  const url = new URL(QUOTE_API_URL)
  url.searchParams.set('fltt', '2')
  url.searchParams.set('invt', '2')
  url.searchParams.set('fields', QUOTE_FIELDS)
  url.searchParams.set('secids', STOCKS.map((stock) => stock.secid).join(','))

  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), QUOTE_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
      signal: abortController.signal,
    })

    if (!response.ok) {
      throw new Error(`quote provider request failed: ${response.status}`)
    }

    const payload = (await response.json()) as EastmoneyQuoteResponse

    return payload.data?.diff ?? []
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchFreshQuotes() {
  const providerQuotes = await fetchQuotesFromProvider()
  const quotesByCode = new Map(
    providerQuotes
      .map((quote) => mapProviderQuote(quote))
      .filter((quote): quote is StockQuote => quote !== null)
      .map((quote) => [quote.code, quote]),
  )

  const nextQuotes = STOCKS.map((stock) => quotesByCode.get(stock.code) ?? getFallbackQuote(stock.code))
  cachedQuotes = cloneQuotes(nextQuotes)
  cacheExpiresAt = Date.now() + QUOTE_CACHE_TTL_MS
  return nextQuotes
}

export async function listQuotes() {
  if (cachedQuotes && Date.now() < cacheExpiresAt) {
    return cloneQuotes(cachedQuotes)
  }

  if (pendingQuotesRequest) {
    return cloneQuotes(await pendingQuotesRequest)
  }

  try {
    pendingQuotesRequest = fetchFreshQuotes()
    return cloneQuotes(await pendingQuotesRequest)
  } catch {
    return listFallbackQuotes()
  } finally {
    pendingQuotesRequest = null
  }
}

export async function getQuote(code: StockCode) {
  const quotes = await listQuotes()

  return quotes.find((quote) => quote.code === code) ?? getFallbackQuote(code)
}
