import { asc, sql } from 'drizzle-orm'

import { getDb } from './db.js'
import { forEachBestEffort, isMarketDataPersistenceDisabled } from './market-data-persistence.js'
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
const QUOTE_DEGRADED_CACHE_TTL_MS = 30_000
const QUOTE_TIMEOUT_MS = 5_000
const MAX_LIVE_QUOTE_AGE_MS = 14 * 24 * 60 * 60 * 1000
const MAX_PROVIDER_CLOCK_SKEW_MS = 10 * 60 * 1000
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000

export type QuoteFreshness = 'live' | 'snapshot' | 'fallback'
export type QuoteSource = '东方财富' | '腾讯行情' | '新浪行情'

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

export interface ProviderQuoteCandidate {
  code: StockCode
  source: QuoteSource
  latestPrice: number | null
  totalMarketCap: number | null
  priceChangePct: number | null
  asOf: string | null
}

export interface ProviderQuote {
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

export interface SnapshotQuoteFieldsInput extends LiveQuoteFieldsInput {
  fetchedAt: unknown
}

export interface ValidatedSnapshotQuoteFields extends ValidatedLiveQuoteFields {
  fetchedAt: string
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

export function validateSnapshotQuoteFields(
  input: SnapshotQuoteFieldsInput,
): ValidatedSnapshotQuoteFields | null {
  const latestPrice = toPositiveFiniteNumber(input.latestPrice)
  const totalMarketCap = toPositiveFiniteNumber(input.totalMarketCap)
  const priceChangePct = toFiniteNumber(input.priceChangePct)
  const asOf = normalizeTimestamp(input.asOf)
  const fetchedAt = normalizeTimestamp(input.fetchedAt)

  if (
    latestPrice === null ||
    totalMarketCap === null ||
    priceChangePct === null ||
    priceChangePct < -100 ||
    priceChangePct > 1_000 ||
    !asOf ||
    !fetchedAt
  ) {
    return null
  }

  return {
    latestPrice,
    totalMarketCap: Math.round(totalMarketCap),
    priceChangePct,
    asOf,
    fetchedAt,
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

function warnSnapshotFailure(operation: string, error: unknown, stockCode?: string) {
  const errorType = error instanceof Error ? error.name : 'UnknownError'
  const stockContext = stockCode ? ` for stock ${stockCode}` : ''
  console.warn(`[quote-service] ${operation}${stockContext} failed (${errorType})`)
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

export function buildValidatedProviderQuote(
  code: StockCode,
  candidates: ProviderQuoteCandidate[],
  nowMs: number,
): ProviderQuote | null {
  const stock = getStockByCode(code)

  const timestampedCandidates = candidates
    .filter((candidate) => candidate.code === code)
    .map((candidate) => {
      const asOf = normalizeLiveAsOf(candidate.asOf, nowMs)
      return asOf ? { candidate, asOf, timestampMs: Date.parse(asOf) } : null
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)

  const priceCandidates = timestampedCandidates
    .filter(({ candidate }) => {
      const latestPrice = toPositiveFiniteNumber(candidate.latestPrice)
      const priceChangePct = toFiniteNumber(candidate.priceChangePct)
      return (
        latestPrice !== null &&
        priceChangePct !== null &&
        priceChangePct >= -100 &&
        priceChangePct <= 1_000
      )
    })
    .sort((left, right) => right.timestampMs - left.timestampMs)

  const freshestPriceTimestamp = priceCandidates[0]?.timestampMs

  if (freshestPriceTimestamp === undefined) {
    return null
  }

  // A recent price must never be completed with a market cap from a different
  // trading window. Older complete quotes are also ignored when a materially
  // fresher price candidate proves that the provider set has moved on.
  for (const priceCandidate of priceCandidates) {
    if (freshestPriceTimestamp - priceCandidate.timestampMs > MAX_PROVIDER_CLOCK_SKEW_MS) {
      continue
    }

    const compatibleMarketCaps = timestampedCandidates
      .filter(
        ({ candidate, timestampMs }) =>
          toPositiveFiniteNumber(candidate.totalMarketCap) !== null &&
          Math.abs(timestampMs - priceCandidate.timestampMs) <= MAX_PROVIDER_CLOCK_SKEW_MS,
      )
      .sort((left, right) => {
        const leftSameSource = left.candidate.source === priceCandidate.candidate.source ? 1 : 0
        const rightSameSource = right.candidate.source === priceCandidate.candidate.source ? 1 : 0

        if (leftSameSource !== rightSameSource) {
          return rightSameSource - leftSameSource
        }

        return (
          Math.abs(left.timestampMs - priceCandidate.timestampMs) -
          Math.abs(right.timestampMs - priceCandidate.timestampMs)
        )
      })

    for (const marketCapCandidate of compatibleMarketCaps) {
      const validatedFields = validateLiveQuoteFields(
        {
          latestPrice: priceCandidate.candidate.latestPrice,
          totalMarketCap: marketCapCandidate.candidate.totalMarketCap,
          priceChangePct: priceCandidate.candidate.priceChangePct,
          asOf: priceCandidate.asOf,
        },
        nowMs,
      )

      if (!validatedFields) {
        continue
      }

      return {
        source: summarizeSources([priceCandidate.candidate.source, marketCapCandidate.candidate.source]),
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

export function getChinaTradeDate(asOf: unknown) {
  const normalizedAsOf = normalizeTimestamp(asOf)

  if (!normalizedAsOf) {
    return null
  }

  const chinaTime = new Date(Date.parse(normalizedAsOf) + CHINA_TIME_OFFSET_MS)
  const chinaWeekday = chinaTime.getUTCDay()

  if (chinaWeekday === 0 || chinaWeekday === 6) {
    return null
  }

  return chinaTime.toISOString().slice(0, 10)
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
  if (providerQuotes.length === 0 || isMarketDataPersistenceDisabled()) {
    return
  }

  const validationNowMs = Date.now()
  const persistableQuotes = providerQuotes.flatMap((providerQuote) => {
    const validatedFields = validateLiveQuoteFields(providerQuote.quote, validationNowMs)
    const fetchedAt = normalizeTimestamp(providerQuote.quote.fetchedAt)

    if (!validatedFields || !fetchedAt) {
      return []
    }

    return [
      {
        ...providerQuote,
        validatedFields,
        fetchedAtDate: new Date(fetchedAt),
        quoteAsOfDate: new Date(validatedFields.asOf),
        tradeDate: getChinaTradeDate(validatedFields.asOf),
      },
    ]
  })

  if (persistableQuotes.length === 0) {
    return
  }

  let db: ReturnType<typeof getDb>

  try {
    db = getDb()
  } catch (error) {
    warnSnapshotFailure('initialize quote snapshot persistence', error)
    return
  }

  await forEachBestEffort(
    persistableQuotes,
    async ({ quote, source, validatedFields, quoteAsOfDate, fetchedAtDate }) => {
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
          setWhere: sql`${quoteSnapshots.quoteAsOf} is null or ${quoteSnapshots.quoteAsOf} <= ${quoteAsOfDate}`,
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
    },
    (error, item) => warnSnapshotFailure('persist quote snapshot', error, item.quote.code),
  )

  const historyQuotes = persistableQuotes.filter(
    (item): item is typeof item & { tradeDate: string } => item.tradeDate !== null,
  )

  // History is secondary to the last-good snapshot. A missing history table
  // must not prevent snapshots for later stocks from being refreshed.
  await forEachBestEffort(
    historyQuotes,
    async ({ quote, source, validatedFields, quoteAsOfDate, fetchedAtDate, tradeDate }) => {
      await db
        .insert(quoteHistory)
        .values({
          stockCode: quote.code,
          tradeDate,
          latestPrice: String(validatedFields.latestPrice),
          totalMarketCap: String(validatedFields.totalMarketCap),
          priceChangePct: String(validatedFields.priceChangePct),
          source,
          fetchedAt: fetchedAtDate,
          quoteAsOf: quoteAsOfDate,
        })
        .onConflictDoUpdate({
          target: [quoteHistory.stockCode, quoteHistory.tradeDate],
          setWhere: sql`${quoteHistory.quoteAsOf} is null or ${quoteHistory.quoteAsOf} <= ${quoteAsOfDate}`,
          set: {
            latestPrice: String(validatedFields.latestPrice),
            totalMarketCap: String(validatedFields.totalMarketCap),
            priceChangePct: String(validatedFields.priceChangePct),
            source,
            fetchedAt: fetchedAtDate,
            quoteAsOf: quoteAsOfDate,
          },
        })
    },
    (error, item) => warnSnapshotFailure('persist quote history', error, item.quote.code),
  )
}

async function readSnapshotQuotes() {
  if (isMarketDataPersistenceDisabled()) {
    return new Map<StockCode, ProviderQuote>()
  }

  try {
    const db = getDb()
    const rows = await db.select().from(quoteSnapshots).orderBy(asc(quoteSnapshots.stockCode))
    const quotesByCode = new Map<StockCode, ProviderQuote>()

    for (const row of rows) {
      if (!isStockCode(row.stockCode)) {
        continue
      }

      const stock = getStockByCode(row.stockCode)
      const validatedFields = validateSnapshotQuoteFields({
        latestPrice: row.latestPrice,
        totalMarketCap: row.totalMarketCap,
        priceChangePct: row.priceChangePct,
        asOf: row.quoteAsOf,
        fetchedAt: row.fetchedAt,
      })

      if (!validatedFields) {
        continue
      }

      quotesByCode.set(row.stockCode, {
        source: row.source || '历史快照',
        quote: {
          code: stock.code,
          name: stock.name,
          label: stock.label,
          latestPrice: validatedFields.latestPrice,
          totalMarketCap: validatedFields.totalMarketCap,
          priceChangePct: validatedFields.priceChangePct,
          updatedAt: formatUpdatedAt(validatedFields.asOf),
          asOf: validatedFields.asOf,
          fetchedAt: validatedFields.fetchedAt,
        },
      })
    }

    return quotesByCode
  } catch (error) {
    warnSnapshotFailure('read quote snapshots', error)
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

function shouldPreferSnapshotQuote(liveQuote: ProviderQuote, snapshotQuote: ProviderQuote) {
  const liveAsOf = liveQuote.quote.asOf ? Date.parse(liveQuote.quote.asOf) : Number.NaN
  const snapshotAsOf = snapshotQuote.quote.asOf ? Date.parse(snapshotQuote.quote.asOf) : Number.NaN

  return Number.isFinite(snapshotAsOf) && (!Number.isFinite(liveAsOf) || snapshotAsOf > liveAsOf)
}

export function buildQuoteFeed(
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
    const snapshotQuote = snapshotQuotes.get(stock.code)

    if (liveQuote && (!snapshotQuote || !shouldPreferSnapshotQuote(liveQuote, snapshotQuote))) {
      quotes.push(liveQuote.quote)
      sources.push(liveQuote.source)
      freshnessByCode[stock.code] = 'live'
      continue
    }

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

  // Read after the monotonic upsert so a concurrently stored newer snapshot
  // can still win over an older provider response in this request.
  const snapshotQuotes = await readSnapshotQuotes()
  const nextFeed = buildQuoteFeed(liveQuotes, snapshotQuotes)

  cachedQuoteFeed = cloneQuoteFeed(nextFeed)
  cacheExpiresAt =
    Date.now() + (nextFeed.freshness === 'live' ? QUOTE_CACHE_TTL_MS : QUOTE_DEGRADED_CACHE_TTL_MS)
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

    cachedQuoteFeed = cloneQuoteFeed(emergencyFeed)
    cacheExpiresAt = Date.now() + QUOTE_DEGRADED_CACHE_TTL_MS
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
