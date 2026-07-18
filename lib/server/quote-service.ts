import { asc } from 'drizzle-orm'

import { getDb } from './db.js'
import { quoteHistory, quoteSnapshots } from './schema.js'
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
const MAX_LIVE_QUOTE_AGE_MS = 14 * 24 * 60 * 60 * 1000
const MAX_PROVIDER_CLOCK_SKEW_MS = 10 * 60 * 1000
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000

export type QuoteFreshness = 'live' | 'snapshot' | 'fallback'
type QuoteSource = '东方财富' | '腾讯行情' | '新浪行情'

interface EastmoneyQuoteRow {
  f2?: unknown
  f3?: unknown
  f12?: unknown
  f20?: unknown
  f124?: unknown
}

interface EastmoneyQuoteResponse {
  data?: {
    diff?: EastmoneyQuoteRow[]
  }
}

interface ProviderQuoteCandidate {
  code: StockCode
  source: QuoteSource
  latestPrice: number | null
  totalMarketCap: number | null
  priceChangePct: number | null
  asOf: string | null
}

interface ProviderQuote {
  quote: StockQuote
  source: string
}

interface QuoteFeed {
  quotes: StockQuote[]
  freshness: QuoteFreshness
  /** Origin of each individual quote; the feed-level freshness is the worst of these. */
  freshnessByCode: Partial<Record<StockCode, QuoteFreshness>>
  source: string
  fetchedAt: string | null
  asOf: string | null
}

export interface LiveQuoteFieldsInput {
  latestPrice: unknown
  totalMarketCap: unknown
  priceChangePct: unknown
  asOf: unknown
}

export interface ValidatedLiveQuoteFields {
  latestPrice: number
  totalMarketCap: number
  priceChangePct: number
  asOf: string
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
    freshnessByCode: { ...feed.freshnessByCode },
    source: feed.source,
    fetchedAt: feed.fetchedAt,
    asOf: feed.asOf,
  }
}

function toFiniteNumber(value: unknown) {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) {
    return null
  }

  try {
    const numberValue = typeof value === 'number' ? value : Number(value)
    return Number.isFinite(numberValue) ? numberValue : null
  } catch {
    return null
  }
}

function toPositiveFiniteNumber(value: unknown) {
  const numberValue = toFiniteNumber(value)
  return numberValue !== null && numberValue > 0 ? numberValue : null
}

function normalizeTimestamp(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  try {
    const date = value instanceof Date ? value : new Date(value as string | number)
    return Number.isFinite(date.getTime()) ? date.toISOString() : null
  } catch {
    return null
  }
}

function normalizeLiveAsOf(value: unknown, nowMs: number) {
  const asOf = normalizeTimestamp(value)

  if (!asOf) {
    return null
  }

  const timestampMs = Date.parse(asOf)

  if (timestampMs < nowMs - MAX_LIVE_QUOTE_AGE_MS || timestampMs > nowMs + MAX_PROVIDER_CLOCK_SKEW_MS) {
    return null
  }

  return asOf
}

export function validateLiveQuoteFields(
  input: LiveQuoteFieldsInput,
  nowMs = Date.now(),
): ValidatedLiveQuoteFields | null {
  const latestPrice = toPositiveFiniteNumber(input.latestPrice)
  const totalMarketCap = toPositiveFiniteNumber(input.totalMarketCap)
  const priceChangePct = toFiniteNumber(input.priceChangePct)
  const asOf = normalizeLiveAsOf(input.asOf, nowMs)

  if (
    latestPrice === null ||
    totalMarketCap === null ||
    priceChangePct === null ||
    priceChangePct < -100 ||
    priceChangePct > 1_000 ||
    !asOf
  ) {
    return null
  }

  return {
    latestPrice,
    totalMarketCap: Math.round(totalMarketCap),
    priceChangePct,
    asOf,
  }
}

function chinaDateTimeToIso(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  seconds: number,
) {
  const localDateAsUtcMs = Date.UTC(year, month - 1, day, hours, minutes, seconds)
  const localDate = new Date(localDateAsUtcMs)

  if (
    localDate.getUTCFullYear() !== year ||
    localDate.getUTCMonth() !== month - 1 ||
    localDate.getUTCDate() !== day ||
    localDate.getUTCHours() !== hours ||
    localDate.getUTCMinutes() !== minutes ||
    localDate.getUTCSeconds() !== seconds
  ) {
    return null
  }

  return new Date(localDateAsUtcMs - CHINA_TIME_OFFSET_MS).toISOString()
}

function parseTencentAsOf(rawValue: string | undefined) {
  const match = rawValue?.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/)

  if (!match) {
    return null
  }

  return chinaDateTimeToIso(...match.slice(1).map(Number) as [number, number, number, number, number, number])
}

function parseSinaAsOf(rawDate: string | undefined, rawTime: string | undefined) {
  const match = `${rawDate ?? ''} ${rawTime ?? ''}`.match(
    /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/,
  )

  if (!match) {
    return null
  }

  return chinaDateTimeToIso(...match.slice(1).map(Number) as [number, number, number, number, number, number])
}

function parseEpochSeconds(value: unknown) {
  const timestampSeconds = toPositiveFiniteNumber(value)
  return timestampSeconds === null ? null : normalizeTimestamp(timestampSeconds * 1000)
}

function formatUpdatedAt(asOf: string | null) {
  if (!asOf) {
    return '--:--:--'
  }

  const chinaTime = new Date(Date.parse(asOf) + CHINA_TIME_OFFSET_MS)
  const hours = String(chinaTime.getUTCHours()).padStart(2, '0')
  const minutes = String(chinaTime.getUTCMinutes()).padStart(2, '0')
  const seconds = String(chinaTime.getUTCSeconds()).padStart(2, '0')

  return `${hours}:${minutes}:${seconds}`
}

function summarizeSources(sources: Iterable<string>) {
  const uniqueSources = [...new Set(sources)].filter(Boolean)
  return uniqueSources.length > 0 ? uniqueSources.join(' + ') : '未知来源'
}

function mapEastmoneyQuote(row: EastmoneyQuoteRow): ProviderQuoteCandidate | null {
  const code = typeof row.f12 === 'string' ? row.f12 : null

  if (!code || !isStockCode(code)) {
    return null
  }

  return {
    code,
    source: '东方财富',
    latestPrice: toPositiveFiniteNumber(row.f2),
    totalMarketCap: toPositiveFiniteNumber(row.f20),
    priceChangePct: toFiniteNumber(row.f3),
    asOf: parseEpochSeconds(row.f124),
  }
}

function mapTencentQuote(fields: string[]): ProviderQuoteCandidate | null {
  const code = fields[2]

  if (!code || !isStockCode(code)) {
    return null
  }

  const totalMarketCapYi = toPositiveFiniteNumber(fields[45])

  return {
    code,
    source: '腾讯行情',
    latestPrice: toPositiveFiniteNumber(fields[3]),
    totalMarketCap: totalMarketCapYi === null ? null : totalMarketCapYi * 100_000_000,
    priceChangePct: toFiniteNumber(fields[32]),
    asOf: parseTencentAsOf(fields[30]),
  }
}

function mapSinaQuote(code: StockCode, fields: string[]): ProviderQuoteCandidate {
  const previousClose = toPositiveFiniteNumber(fields[2])
  const latestPrice = toPositiveFiniteNumber(fields[3])
  const priceChangePct =
    previousClose !== null && latestPrice !== null ? ((latestPrice - previousClose) / previousClose) * 100 : null

  return {
    code,
    source: '新浪行情',
    latestPrice,
    // Sina does not return total market cap. Never synthesize it from built-in fallback data.
    totalMarketCap: null,
    priceChangePct,
    asOf: parseSinaAsOf(fields[30], fields[31]),
  }
}

function buildValidatedProviderQuote(
  code: StockCode,
  candidates: ProviderQuoteCandidate[],
  nowMs: number,
): ProviderQuote | null {
  const stock = getStockByCode(code)

  // Price fields and total market cap may come from two different providers
  // (e.g. Sina price + Tencent market cap). Their asOf timestamps can then
  // differ by seconds; that skew is accepted, and the reported asOf is the one
  // from the price provider since price is the primary display field.
  for (const marketCandidate of candidates) {
    for (const marketCapCandidate of candidates) {
      if (!normalizeLiveAsOf(marketCapCandidate.asOf, nowMs)) {
        continue
      }

      const validatedFields = validateLiveQuoteFields(
        {
          latestPrice: marketCandidate.latestPrice,
          totalMarketCap: marketCapCandidate.totalMarketCap,
          priceChangePct: marketCandidate.priceChangePct,
          asOf: marketCandidate.asOf,
        },
        nowMs,
      )

      if (!validatedFields) {
        continue
      }

      return {
        source: summarizeSources([marketCandidate.source, marketCapCandidate.source]),
        quote: {
          code: stock.code,
          name: stock.name,
          label: stock.label,
          latestPrice: validatedFields.latestPrice,
          totalMarketCap: validatedFields.totalMarketCap,
          priceChangePct: validatedFields.priceChangePct,
          updatedAt: formatUpdatedAt(validatedFields.asOf),
          asOf: validatedFields.asOf,
          fetchedAt: new Date(nowMs).toISOString(),
        },
      }
    }
  }

  return null
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
  const quotesByCode = new Map<StockCode, ProviderQuoteCandidate>()

  for (const row of Array.isArray(payload.data?.diff) ? payload.data.diff : []) {
    const providerQuote = mapEastmoneyQuote(row)

    if (providerQuote) {
      quotesByCode.set(providerQuote.code, providerQuote)
    }
  }

  return quotesByCode
}

async function fetchTencentQuotes() {
  const symbols = STOCKS.map((stock) => `sz${stock.code}`).join(',')
  const body = await fetchTextWithTimeout(`${TENCENT_QUOTE_API_URL}${symbols}`)
  const quotesByCode = new Map<StockCode, ProviderQuoteCandidate>()
  const quoteMatches = body.matchAll(/v_(?:sz|sh)\d+="([^"]*)"/g)

  for (const match of quoteMatches) {
    const providerQuote = mapTencentQuote(match[1].split('~'))

    if (providerQuote) {
      quotesByCode.set(providerQuote.code, providerQuote)
    }
  }

  return quotesByCode
}

async function fetchSinaQuotes() {
  const symbols = STOCKS.map((stock) => `sz${stock.code}`).join(',')
  const body = await fetchTextWithTimeout(`${SINA_QUOTE_API_URL}${symbols}`)
  const quotesByCode = new Map<StockCode, ProviderQuoteCandidate>()
  const quoteMatches = body.matchAll(/var hq_str_(?:sz|sh)(\d+)="([^"]*)"/g)

  for (const match of quoteMatches) {
    const code = match[1]

    if (!isStockCode(code)) {
      continue
    }

    const providerQuote = mapSinaQuote(code, match[2].split(','))
    quotesByCode.set(providerQuote.code, providerQuote)
  }

  return quotesByCode
}

async function fetchLiveProviderQuotes() {
  const providerResults = await Promise.allSettled([fetchEastmoneyQuotes(), fetchTencentQuotes(), fetchSinaQuotes()])
  const mergedQuotes = new Map<StockCode, ProviderQuote>()
  const fetchedAtMs = Date.now()

  for (const stock of STOCKS) {
    const candidates: ProviderQuoteCandidate[] = []

    for (const result of providerResults) {
      if (result.status !== 'fulfilled') {
        continue
      }

      const candidate = result.value.get(stock.code)

      if (candidate) {
        candidates.push(candidate)
      }
    }

    const providerQuote = buildValidatedProviderQuote(stock.code, candidates, fetchedAtMs)

    if (providerQuote) {
      mergedQuotes.set(stock.code, providerQuote)
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
    const validationNowMs = Date.now()
    const todayDate = new Date(validationNowMs).toISOString().split('T')[0]

    for (const { quote, source } of providerQuotes) {
      const validatedFields = validateLiveQuoteFields(quote, validationNowMs)
      const fetchedAt = normalizeTimestamp(quote.fetchedAt)

      // Revalidate at the persistence boundary so malformed or fallback-completed data can never become last-good data.
      if (!validatedFields || !fetchedAt) {
        continue
      }

      const quoteAsOfDate = new Date(validatedFields.asOf)
      const fetchedAtDate = new Date(fetchedAt)

      await db
        .insert(quoteSnapshots)
        .values({
          stockCode: quote.code,
          latestPrice: String(validatedFields.latestPrice),
          totalMarketCap: String(validatedFields.totalMarketCap),
          priceChangePct: String(validatedFields.priceChangePct),
          quoteUpdatedAt: formatUpdatedAt(validatedFields.asOf),
          quoteAsOf: quoteAsOfDate,
          source,
          fetchedAt: fetchedAtDate,
        })
        .onConflictDoUpdate({
          target: quoteSnapshots.stockCode,
          set: {
            latestPrice: String(validatedFields.latestPrice),
            totalMarketCap: String(validatedFields.totalMarketCap),
            priceChangePct: String(validatedFields.priceChangePct),
            quoteUpdatedAt: formatUpdatedAt(validatedFields.asOf),
            quoteAsOf: quoteAsOfDate,
            source,
            fetchedAt: fetchedAtDate,
          },
        })

      // Append to history table: one row per stock per trade date. During the
      // trading day, repeated fetches overwrite today's row; after market close,
      // the last upsert captures the closing values for charting / analysis.
      await db
        .insert(quoteHistory)
        .values({
          stockCode: quote.code,
          tradeDate: todayDate,
          latestPrice: String(validatedFields.latestPrice),
          totalMarketCap: String(validatedFields.totalMarketCap),
          priceChangePct: String(validatedFields.priceChangePct),
          source,
          fetchedAt: fetchedAtDate,
          quoteAsOf: quoteAsOfDate,
        })
        .onConflictDoUpdate({
          target: [quoteHistory.stockCode, quoteHistory.tradeDate],
          set: {
            latestPrice: String(validatedFields.latestPrice),
            totalMarketCap: String(validatedFields.totalMarketCap),
            priceChangePct: String(validatedFields.priceChangePct),
            source,
            fetchedAt: fetchedAtDate,
            quoteAsOf: quoteAsOfDate,
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

      const latestPrice = toPositiveFiniteNumber(row.latestPrice)
      const totalMarketCap = toPositiveFiniteNumber(row.totalMarketCap)
      const priceChangePct = toFiniteNumber(row.priceChangePct)
      const fetchedAt = normalizeTimestamp(row.fetchedAt)

      if (latestPrice === null || totalMarketCap === null || priceChangePct === null || !fetchedAt) {
        continue
      }

      const stock = getStockByCode(row.stockCode)
      const asOf = normalizeTimestamp(row.quoteAsOf)

      quotesByCode.set(row.stockCode, {
        source: row.source || '历史快照',
        quote: {
          code: stock.code,
          name: stock.name,
          label: stock.label,
          latestPrice,
          totalMarketCap: Math.round(totalMarketCap),
          priceChangePct,
          updatedAt: asOf ? formatUpdatedAt(asOf) : row.quoteUpdatedAt || '--:--:--',
          asOf,
          fetchedAt,
        },
      })
    }

    return quotesByCode
  } catch {
    return new Map<StockCode, ProviderQuote>()
  }
}

function getConservativeTimestamp(quotes: StockQuote[], field: 'fetchedAt' | 'asOf') {
  const timestamps = quotes.map((quote) => quote[field])

  if (timestamps.some((timestamp) => !timestamp)) {
    return null
  }

  const timestampValues = timestamps.map((timestamp) => Date.parse(timestamp as string))

  if (timestampValues.some((timestamp) => !Number.isFinite(timestamp))) {
    return null
  }

  return new Date(Math.min(...timestampValues)).toISOString()
}

function buildQuoteFeed(
  liveQuotes: Map<StockCode, ProviderQuote>,
  snapshotQuotes: Map<StockCode, ProviderQuote>,
): QuoteFeed {
  const quotes: StockQuote[] = []
  const sources: string[] = []
  const freshnessByCode: Partial<Record<StockCode, QuoteFreshness>> = {}
  let usedSnapshot = false
  let usedFallback = false

  for (const stock of STOCKS) {
    const liveQuote = liveQuotes.get(stock.code)

    if (liveQuote) {
      quotes.push(liveQuote.quote)
      sources.push(liveQuote.source)
      freshnessByCode[stock.code] = 'live'
      continue
    }

    const snapshotQuote = snapshotQuotes.get(stock.code)

    if (snapshotQuote) {
      quotes.push(snapshotQuote.quote)
      sources.push(snapshotQuote.source)
      freshnessByCode[stock.code] = 'snapshot'
      usedSnapshot = true
      continue
    }

    quotes.push(getFallbackQuote(stock.code))
    sources.push('内置回退数据')
    freshnessByCode[stock.code] = 'fallback'
    usedFallback = true
  }

  return {
    quotes,
    freshness: usedFallback ? 'fallback' : usedSnapshot ? 'snapshot' : 'live',
    freshnessByCode,
    source: summarizeSources(sources),
    fetchedAt: getConservativeTimestamp(quotes, 'fetchedAt'),
    asOf: getConservativeTimestamp(quotes, 'asOf'),
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
  const quote = feed.quotes.find((item) => item.code === code) ?? getFallbackQuote(code)

  return {
    quote,
    // Report this stock's own origin, not the feed-wide worst case.
    freshness: feed.freshnessByCode[code] ?? 'fallback',
    source: feed.source,
    fetchedAt: quote.fetchedAt,
    asOf: quote.asOf,
  }
}
