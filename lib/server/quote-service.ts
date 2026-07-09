import { asc } from 'drizzle-orm'

import { getDb } from './db.js'
import { quoteSnapshots } from './schema.js'
import {
  STOCKS,
  getFallbackQuote,
  getStockByCode,
  isStockCode,
  type StockCode,
  type StockQuote,
} from '../../shared/stocks.js'

const EASTMONEY_QUOTE_API_URL = 'https://push2.eastmoney.com/api/qt/ulist.np/get'
const EASTMONEY_QUOTE_FIELDS = 'f2,f3,f12,f20,f124'
const TENCENT_QUOTE_API_URL = 'https://qt.gtimg.cn/q='
const SINA_QUOTE_API_URL = 'https://hq.sinajs.cn/list='
const QUOTE_CACHE_TTL_MS = 15_000
const QUOTE_TIMEOUT_MS = 5_000

type QuoteFreshness = 'live' | 'snapshot' | 'fallback'
type QuoteSource = '东方财富' | '腾讯行情' | '新浪行情'

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

interface ProviderQuote {
  quote: StockQuote
  source: QuoteSource
}

interface QuoteFeed {
  quotes: StockQuote[]
  freshness: QuoteFreshness
  source: string
}

let cachedQuoteFeed: QuoteFeed | null = null
let cacheExpiresAt = 0
let pendingQuotesRequest: Promise<QuoteFeed> | null = null

function cloneQuotes(quotes: StockQuote[]) {
  return quotes.map((quote) => ({ ...quote }))
}

function cloneQuoteFeed(feed: QuoteFeed): QuoteFeed {
  return {
    quotes: cloneQuotes(feed.quotes),
    freshness: feed.freshness,
    source: feed.source,
  }
}

function toFiniteNumber(value: unknown) {
  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
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

function formatTencentUpdatedAt(rawValue: string | undefined, fallbackValue: string) {
  if (!rawValue || rawValue.length < 14) {
    return fallbackValue
  }

  return `${rawValue.slice(8, 10)}:${rawValue.slice(10, 12)}:${rawValue.slice(12, 14)}`
}

function summarizeSources(sources: Iterable<string>) {
  const uniqueSources = [...new Set(sources)].filter(Boolean)
  return uniqueSources.length > 0 ? uniqueSources.join(' + ') : '未知来源'
}

function mapEastmoneyQuote(row: EastmoneyQuoteRow): ProviderQuote | null {
  const code = typeof row.f12 === 'string' ? row.f12 : null

  if (!code || !isStockCode(code)) {
    return null
  }

  const stock = getStockByCode(code)

  return {
    source: '东方财富',
    quote: {
      code: stock.code,
      name: stock.name,
      label: stock.label,
      latestPrice: toFiniteNumber(row.f2) ?? stock.fallbackQuote.latestPrice,
      totalMarketCap: Math.round(toFiniteNumber(row.f20) ?? stock.fallbackQuote.totalMarketCap),
      priceChangePct: toFiniteNumber(row.f3) ?? stock.fallbackQuote.priceChangePct,
      updatedAt: formatUpdatedAt(row.f124, stock.fallbackQuote.updatedAt),
    },
  }
}

function mapTencentQuote(fields: string[]): ProviderQuote | null {
  const code = fields[2]

  if (!code || !isStockCode(code)) {
    return null
  }

  const stock = getStockByCode(code)
  const totalMarketCapYi = Math.max(toFiniteNumber(fields[44]) ?? 0, toFiniteNumber(fields[45]) ?? 0)

  return {
    source: '腾讯行情',
    quote: {
      code: stock.code,
      name: stock.name,
      label: stock.label,
      latestPrice: toFiniteNumber(fields[3]) ?? stock.fallbackQuote.latestPrice,
      totalMarketCap:
        totalMarketCapYi > 0 ? Math.round(totalMarketCapYi * 100_000_000) : stock.fallbackQuote.totalMarketCap,
      priceChangePct: toFiniteNumber(fields[32]) ?? stock.fallbackQuote.priceChangePct,
      updatedAt: formatTencentUpdatedAt(fields[30], stock.fallbackQuote.updatedAt),
    },
  }
}

function inferMarketCapFromFallback(code: StockCode, latestPrice: number) {
  const stock = getStockByCode(code)

  if (latestPrice <= 0 || stock.fallbackQuote.latestPrice <= 0) {
    return stock.fallbackQuote.totalMarketCap
  }

  return Math.round(stock.fallbackQuote.totalMarketCap * (latestPrice / stock.fallbackQuote.latestPrice))
}

function mapSinaQuote(code: StockCode, fields: string[]): ProviderQuote | null {
  const stock = getStockByCode(code)
  const previousClose = toFiniteNumber(fields[2]) ?? stock.fallbackQuote.latestPrice
  const latestPrice = toFiniteNumber(fields[3]) ?? stock.fallbackQuote.latestPrice
  const updatedAt = fields[31]?.trim() || stock.fallbackQuote.updatedAt
  const priceChangePct = previousClose > 0 ? ((latestPrice - previousClose) / previousClose) * 100 : stock.fallbackQuote.priceChangePct

  return {
    source: '新浪行情',
    quote: {
      code: stock.code,
      name: stock.name,
      label: stock.label,
      latestPrice,
      totalMarketCap: inferMarketCapFromFallback(stock.code, latestPrice),
      priceChangePct,
      updatedAt,
    },
  }
}

async function fetchTextWithTimeout(url: string) {
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), QUOTE_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'text/plain,application/json;q=0.9,*/*;q=0.8',
        Referer: 'https://finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0',
      },
      signal: abortController.signal,
    })

    if (!response.ok) {
      throw new Error(`quote provider request failed: ${response.status}`)
    }

    return await response.text()
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchJsonWithTimeout<T>(url: string) {
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

    return (await response.json()) as T
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchEastmoneyQuotes() {
  const url = new URL(EASTMONEY_QUOTE_API_URL)
  url.searchParams.set('fltt', '2')
  url.searchParams.set('invt', '2')
  url.searchParams.set('fields', EASTMONEY_QUOTE_FIELDS)
  url.searchParams.set('secids', STOCKS.map((stock) => stock.secid).join(','))

  const payload = await fetchJsonWithTimeout<EastmoneyQuoteResponse>(url.toString())
  const quotesByCode = new Map<StockCode, ProviderQuote>()

  for (const providerQuote of (payload.data?.diff ?? [])
    .map((row) => mapEastmoneyQuote(row))
    .filter((quote): quote is ProviderQuote => quote !== null)) {
    quotesByCode.set(providerQuote.quote.code, providerQuote)
  }

  return quotesByCode
}

async function fetchTencentQuotes() {
  const symbols = STOCKS.map((stock) => `sz${stock.code}`).join(',')
  const body = await fetchTextWithTimeout(`${TENCENT_QUOTE_API_URL}${symbols}`)
  const quotesByCode = new Map<StockCode, ProviderQuote>()
  const quoteMatches = body.matchAll(/v_(?:sz|sh)\d+="([^"]*)"/g)

  for (const match of quoteMatches) {
    const providerQuote = mapTencentQuote(match[1].split('~'))

    if (providerQuote) {
      quotesByCode.set(providerQuote.quote.code, providerQuote)
    }
  }

  return quotesByCode
}

async function fetchSinaQuotes() {
  const symbols = STOCKS.map((stock) => `sz${stock.code}`).join(',')
  const body = await fetchTextWithTimeout(`${SINA_QUOTE_API_URL}${symbols}`)
  const quotesByCode = new Map<StockCode, ProviderQuote>()
  const quoteMatches = body.matchAll(/var hq_str_(?:sz|sh)(\d+)="([^"]*)"/g)

  for (const match of quoteMatches) {
    const code = match[1]

    if (!isStockCode(code)) {
      continue
    }

    const providerQuote = mapSinaQuote(code, match[2].split(','))

    if (providerQuote) {
      quotesByCode.set(providerQuote.quote.code, providerQuote)
    }
  }

  return quotesByCode
}

async function fetchLiveProviderQuotes() {
  const providerResults = await Promise.allSettled([fetchEastmoneyQuotes(), fetchTencentQuotes(), fetchSinaQuotes()])
  const mergedQuotes = new Map<StockCode, ProviderQuote>()

  for (const stock of STOCKS) {
    for (const result of providerResults) {
      if (result.status !== 'fulfilled') {
        continue
      }

      const providerQuote = result.value.get(stock.code)

      if (providerQuote) {
        mergedQuotes.set(stock.code, providerQuote)
        break
      }
    }
  }

  return mergedQuotes
}

async function persistQuoteSnapshots(providerQuotes: ProviderQuote[]) {
  if (providerQuotes.length === 0) {
    return
  }

  try {
    const db = getDb()
    const fetchedAt = new Date()

    for (const { quote, source } of providerQuotes) {
      await db
        .insert(quoteSnapshots)
        .values({
          stockCode: quote.code,
          latestPrice: String(quote.latestPrice),
          totalMarketCap: String(Math.round(quote.totalMarketCap)),
          priceChangePct: String(quote.priceChangePct),
          quoteUpdatedAt: quote.updatedAt,
          source,
          fetchedAt,
        })
        .onConflictDoUpdate({
          target: quoteSnapshots.stockCode,
          set: {
            latestPrice: String(quote.latestPrice),
            totalMarketCap: String(Math.round(quote.totalMarketCap)),
            priceChangePct: String(quote.priceChangePct),
            quoteUpdatedAt: quote.updatedAt,
            source,
            fetchedAt,
          },
        })
    }
  } catch {
    // Ignore snapshot persistence errors so live quote delivery is not blocked.
  }
}

async function readSnapshotQuotes() {
  try {
    const db = getDb()
    const rows = await db.select().from(quoteSnapshots).orderBy(asc(quoteSnapshots.stockCode))
    const quotesByCode = new Map<StockCode, ProviderQuote>()

    for (const row of rows) {
      if (!isStockCode(row.stockCode)) {
        continue
      }

      const stock = getStockByCode(row.stockCode)

      quotesByCode.set(row.stockCode, {
        source: row.source === '腾讯行情' || row.source === '新浪行情' ? row.source : '东方财富',
        quote: {
          code: stock.code,
          name: stock.name,
          label: stock.label,
          latestPrice: Number(row.latestPrice),
          totalMarketCap: Number(row.totalMarketCap),
          priceChangePct: Number(row.priceChangePct),
          updatedAt: row.quoteUpdatedAt,
        },
      })
    }

    return quotesByCode
  } catch {
    return new Map<StockCode, ProviderQuote>()
  }
}

function buildQuoteFeed(
  liveQuotes: Map<StockCode, ProviderQuote>,
  snapshotQuotes: Map<StockCode, ProviderQuote>,
): QuoteFeed {
  const quotes: StockQuote[] = []
  const liveSources: string[] = []
  const snapshotSources: string[] = []
  let usedSnapshot = false
  let usedFallback = false

  for (const stock of STOCKS) {
    const liveQuote = liveQuotes.get(stock.code)

    if (liveQuote) {
      quotes.push(liveQuote.quote)
      liveSources.push(liveQuote.source)
      continue
    }

    const snapshotQuote = snapshotQuotes.get(stock.code)

    if (snapshotQuote) {
      quotes.push(snapshotQuote.quote)
      snapshotSources.push(snapshotQuote.source)
      usedSnapshot = true
      continue
    }

    quotes.push(getFallbackQuote(stock.code))
    usedFallback = true
  }

  if (!usedSnapshot && !usedFallback && liveQuotes.size === STOCKS.length) {
    return {
      quotes,
      freshness: 'live',
      source: summarizeSources(liveSources),
    }
  }

  if (usedSnapshot) {
    return {
      quotes,
      freshness: 'snapshot',
      source: summarizeSources([...liveSources, ...snapshotSources]),
    }
  }

  return {
    quotes,
    freshness: 'fallback',
    source: summarizeSources(liveSources),
  }
}

async function fetchFreshQuoteFeed() {
  const liveQuotes = await fetchLiveProviderQuotes()

  if (liveQuotes.size > 0) {
    await persistQuoteSnapshots([...liveQuotes.values()])
  }

  const snapshotQuotes = liveQuotes.size === STOCKS.length ? new Map<StockCode, ProviderQuote>() : await readSnapshotQuotes()
  const nextFeed = buildQuoteFeed(liveQuotes, snapshotQuotes)

  cachedQuoteFeed = cloneQuoteFeed(nextFeed)
  cacheExpiresAt = Date.now() + QUOTE_CACHE_TTL_MS
  return nextFeed
}

export async function listQuotes() {
  if (cachedQuoteFeed && Date.now() < cacheExpiresAt) {
    return cloneQuoteFeed(cachedQuoteFeed)
  }

  if (pendingQuotesRequest) {
    return cloneQuoteFeed(await pendingQuotesRequest)
  }

  try {
    pendingQuotesRequest = fetchFreshQuoteFeed()
    return cloneQuoteFeed(await pendingQuotesRequest)
  } catch {
    const snapshotQuotes = await readSnapshotQuotes()
    const emergencyFeed = buildQuoteFeed(new Map<StockCode, ProviderQuote>(), snapshotQuotes)
    return cloneQuoteFeed(emergencyFeed)
  } finally {
    pendingQuotesRequest = null
  }
}

export async function getQuote(code: StockCode) {
  const feed = await listQuotes()

  return {
    quote: feed.quotes.find((quote) => quote.code === code) ?? getFallbackQuote(code),
    freshness: feed.freshness,
    source: feed.source,
  }
}
