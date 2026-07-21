import { getDb } from './db.js'
import { forEachBestEffort, isMarketDataPersistenceDisabled } from './market-data-persistence.js'
import { dividendSnapshots } from './schema.js'
import { STOCKS, getStockByCode, isStockCode, type StockCode } from '../../shared/stocks.js'

const EASTMONEY_DIVIDEND_API_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get'
const TUSHARE_API_URL = 'https://api.tushare.pro'
const TUSHARE_DIVIDEND_FIELDS =
  'ts_code,end_date,ann_date,div_proc,stk_div,stk_bo_rate,stk_co_rate,cash_div,cash_div_tax,record_date,ex_date'
const DIVIDEND_CACHE_TTL_MS = 60 * 60 * 1000
const DIVIDEND_DEGRADED_CACHE_TTL_MS = 5 * 60 * 1000
const DIVIDEND_TIMEOUT_MS = 7_000

type DividendFreshness = 'live' | 'partial' | 'cached' | 'fallback'

interface EastmoneyDividendResponse {
  result?: {
    pages?: number
    data?: Record<string, unknown>[]
  }
}

interface TushareResponse {
  code?: number
  msg?: string
  data?: {
    fields?: string[]
    items?: unknown[][]
  }
}

export interface DividendRecord {
  reportDate: string
  performanceDisclosureDate: string
  totalRatio: number | null
  sendRatio: number | null
  transferRatio: number | null
  cashDividendRatio: number | null
  cashDividendDescription: string
  dividendYield: number | null
  earningsPerShare: number | null
  netAssetPerShare: number | null
  capitalReservePerShare: number | null
  retainedEarningsPerShare: number | null
  netProfitGrowthPct: number | null
  totalShares: number | null
  proposalDate: string
  recordDate: string
  exDate: string
  planProgress: string
  latestAnnouncementDate: string
}

export interface DividendFeedItem {
  code: StockCode
  name: string
  label: string
  records: DividendRecord[]
  source?: string
}

interface DividendFeed {
  dividends: DividendFeedItem[]
  freshness: DividendFreshness
  source: string
}

interface DividendPage {
  pages: number
  rows: Record<string, unknown>[]
}

let cachedDividendFeed: DividendFeed | null = null
let cacheExpiresAt = 0
let pendingDividendRequest: Promise<DividendFeed> | null = null

function cloneDividendRecords(records: DividendRecord[]) {
  return records.map((record) => ({ ...record }))
}

function cloneDividendFeed(feed: DividendFeed): DividendFeed {
  return {
    dividends: feed.dividends.map((item) => ({
      ...item,
      records: cloneDividendRecords(item.records),
    })),
    freshness: feed.freshness,
    source: feed.source,
  }
}

function toFiniteNumber(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value === 'string' && value.trim() === '') {
    return null
  }

  const numberValue = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(numberValue) ? numberValue : null
}

function toNonNegativeFiniteNumber(value: unknown) {
  const numberValue = toFiniteNumber(value)
  return numberValue !== null && numberValue >= 0 ? numberValue : null
}

function isMissingProviderValue(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    (typeof value === 'string' && ['', '-', '--'].includes(value.trim()))
  )
}

function isInvalidNonNegativeProviderValue(value: unknown) {
  return !isMissingProviderValue(value) && toNonNegativeFiniteNumber(value) === null
}

function toPerTenRatio(perShareRatio: number) {
  return Math.round(perShareRatio * 10 * 1_000_000_000) / 1_000_000_000
}

function toDateText(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return ''
  }

  const text = String(value).trim()
  if (!text) {
    return ''
  }

  if (/^\d{8}$/.test(text)) {
    return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`
  }

  return text.slice(0, 10)
}

function isValidDateText(value: unknown, required = false) {
  if (typeof value !== 'string') {
    return false
  }

  if (!value) {
    return !required
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)

  if (!match) {
    return false
  }

  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function isNullableFiniteNumber(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value))
}

function isNullableNonNegativeFiniteNumber(value: unknown) {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0)
}

export function isValidDividendRecord(value: unknown): value is DividendRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  const optionalDateFields = [
    'performanceDisclosureDate',
    'proposalDate',
    'recordDate',
    'exDate',
    'latestAnnouncementDate',
  ]
  const numericFields = [
    'totalRatio',
    'sendRatio',
    'transferRatio',
    'cashDividendRatio',
    'dividendYield',
    'earningsPerShare',
    'netAssetPerShare',
    'capitalReservePerShare',
    'retainedEarningsPerShare',
    'netProfitGrowthPct',
    'totalShares',
  ]
  const nonNegativeFields = [
    'totalRatio',
    'sendRatio',
    'transferRatio',
    'cashDividendRatio',
    'dividendYield',
    'totalShares',
  ]

  if (!isValidDateText(record.reportDate, true)) {
    return false
  }

  if (optionalDateFields.some((field) => !isValidDateText(record[field]))) {
    return false
  }

  if (
    typeof record.cashDividendDescription !== 'string' ||
    typeof record.planProgress !== 'string' ||
    !record.planProgress.trim()
  ) {
    return false
  }

  if (numericFields.some((field) => !isNullableFiniteNumber(record[field]))) {
    return false
  }

  if (nonNegativeFields.some((field) => !isNullableNonNegativeFiniteNumber(record[field]))) {
    return false
  }

  const hasEventEvidence =
    optionalDateFields.some((field) => Boolean(record[field])) ||
    ['totalRatio', 'sendRatio', 'transferRatio', 'cashDividendRatio'].some(
      (field) => record[field] !== null,
    )

  return hasEventEvidence
}

export function getValidDividendRecords(value: unknown) {
  if (!Array.isArray(value)) {
    return null
  }

  const records = value.filter(isValidDividendRecord)
  return records.length > 0 ? records : null
}

function summarizeSources(sources: Iterable<string>) {
  const uniqueSources = [...new Set(sources)].filter(Boolean)
  return uniqueSources.length > 0 ? uniqueSources.join(' + ') : '未知来源'
}

function warnSnapshotFailure(operation: string, error: unknown, stockCode?: string) {
  const errorType = error instanceof Error ? error.name : 'UnknownError'
  const stockContext = stockCode ? ` for stock ${stockCode}` : ''
  console.warn(`[dividend-service] ${operation}${stockContext} failed (${errorType})`)
}

function normalizeDividendRow(row: Record<string, unknown>): DividendRecord | null {
  const stockCode = typeof row.SECURITY_CODE === 'string' ? row.SECURITY_CODE : ''

  if (!isStockCode(stockCode)) {
    return null
  }

  if (
    [row.BONUS_IT_RATIO, row.BONUS_RATIO, row.IT_RATIO, row.PRETAX_BONUS_RMB].some(
      isInvalidNonNegativeProviderValue,
    )
  ) {
    return null
  }

  const record: DividendRecord = {
    reportDate: toDateText(row.REPORT_DATE),
    performanceDisclosureDate: toDateText(row.PUBLISH_DATE),
    totalRatio: toFiniteNumber(row.BONUS_IT_RATIO),
    sendRatio: toFiniteNumber(row.BONUS_RATIO),
    transferRatio: toFiniteNumber(row.IT_RATIO),
    cashDividendRatio: toFiniteNumber(row.PRETAX_BONUS_RMB),
    cashDividendDescription: typeof row.IMPL_PLAN_PROFILE === 'string' ? row.IMPL_PLAN_PROFILE.trim() : '',
    dividendYield: toFiniteNumber(row.DIVIDENT_RATIO),
    earningsPerShare: toFiniteNumber(row.BASIC_EPS),
    netAssetPerShare: toFiniteNumber(row.BVPS),
    capitalReservePerShare: toFiniteNumber(row.PER_CAPITAL_RESERVE),
    retainedEarningsPerShare: toFiniteNumber(row.PER_UNASSIGN_PROFIT),
    netProfitGrowthPct: toFiniteNumber(row.PNP_YOY_RATIO),
    totalShares: toFiniteNumber(row.TOTAL_SHARES),
    proposalDate: toDateText(row.PLAN_NOTICE_DATE),
    recordDate: toDateText(row.EQUITY_RECORD_DATE),
    exDate: toDateText(row.EX_DIVIDEND_DATE),
    planProgress: typeof row.ASSIGN_PROGRESS === 'string' ? row.ASSIGN_PROGRESS.trim() : '',
    latestAnnouncementDate: toDateText(row.NOTICE_DATE),
  }

  return isValidDividendRecord(record) ? record : null
}

export function normalizeTushareDividendRow(row: Record<string, unknown>): DividendRecord | null {
  const tsCode = typeof row.ts_code === 'string' ? row.ts_code : ''
  const stockCode = tsCode.slice(0, 6)

  if (!isStockCode(stockCode)) {
    return null
  }

  if (
    [row.stk_div, row.stk_bo_rate, row.stk_co_rate, row.cash_div_tax].some(
      isInvalidNonNegativeProviderValue,
    )
  ) {
    return null
  }

  const totalStockRatioPerShare = toNonNegativeFiniteNumber(row.stk_div)
  const sendRatioPerShare = toNonNegativeFiniteNumber(row.stk_bo_rate)
  const transferRatioPerShare = toNonNegativeFiniteNumber(row.stk_co_rate)

  let normalizedSendRatioPerShare: number | null
  let normalizedTransferRatioPerShare: number | null

  if (
    totalStockRatioPerShare === null &&
    sendRatioPerShare === null &&
    transferRatioPerShare === null
  ) {
    normalizedSendRatioPerShare = null
    normalizedTransferRatioPerShare = null
  } else if (sendRatioPerShare === null && transferRatioPerShare === null) {
    normalizedSendRatioPerShare = totalStockRatioPerShare ?? 0
    normalizedTransferRatioPerShare = 0
  } else {
    normalizedSendRatioPerShare =
      sendRatioPerShare ??
      Math.max(
        0,
        (totalStockRatioPerShare ?? transferRatioPerShare ?? 0) - (transferRatioPerShare ?? 0),
      )
    normalizedTransferRatioPerShare =
      transferRatioPerShare ??
      Math.max(0, (totalStockRatioPerShare ?? sendRatioPerShare ?? 0) - (sendRatioPerShare ?? 0))
  }

  const sendRatio =
    normalizedSendRatioPerShare === null ? null : toPerTenRatio(normalizedSendRatioPerShare)
  const transferRatio =
    normalizedTransferRatioPerShare === null ? null : toPerTenRatio(normalizedTransferRatioPerShare)
  const cashDividendPerShareBeforeTax = toNonNegativeFiniteNumber(row.cash_div_tax)
  const cashDividendRatio =
    cashDividendPerShareBeforeTax === null ? null : toPerTenRatio(cashDividendPerShareBeforeTax)
  const stockDividendText =
    sendRatio === null && transferRatio === null
      ? ''
      : `10股送${sendRatio ?? 0}股转${transferRatio ?? 0}股`
  const cashDividendText =
    cashDividendRatio === null ? '派--元（税前金额缺失）' : `派${cashDividendRatio}元`

  const record: DividendRecord = {
    reportDate: toDateText(row.end_date),
    performanceDisclosureDate: toDateText(row.ann_date),
    totalRatio: sendRatio === null && transferRatio === null ? null : (sendRatio ?? 0) + (transferRatio ?? 0),
    sendRatio,
    transferRatio,
    cashDividendRatio,
    cashDividendDescription: `${stockDividendText}${cashDividendText}`,
    dividendYield: null,
    earningsPerShare: null,
    netAssetPerShare: null,
    capitalReservePerShare: null,
    retainedEarningsPerShare: null,
    netProfitGrowthPct: null,
    totalShares: null,
    proposalDate: toDateText(row.ann_date),
    recordDate: toDateText(row.record_date),
    exDate: toDateText(row.ex_date),
    planProgress: typeof row.div_proc === 'string' ? row.div_proc.trim() : '',
    latestAnnouncementDate: toDateText(row.ann_date),
  }

  return isValidDividendRecord(record) ? record : null
}

function buildEmptyDividendItem(code: StockCode): DividendFeedItem {
  const stock = getStockByCode(code)

  return {
    code: stock.code,
    name: stock.name,
    label: stock.label,
    records: [],
  }
}

function buildDividendFeed(
  liveItems: Map<StockCode, DividendFeedItem>,
  cachedItems: Map<StockCode, DividendFeedItem>,
): DividendFeed {
  const dividends: DividendFeedItem[] = []
  const sourceParts: string[] = []
  let usedLive = false
  let usedCached = false
  let usedFallback = false

  for (const stock of STOCKS) {
    const liveItem = liveItems.get(stock.code)

    if (liveItem) {
      dividends.push({
        ...liveItem,
        records: cloneDividendRecords(liveItem.records),
      })
      sourceParts.push(liveItem.source ?? '未知来源')
      usedLive = true
      continue
    }

    const cachedItem = cachedItems.get(stock.code)

    if (cachedItem) {
      dividends.push({
        ...cachedItem,
        records: cloneDividendRecords(cachedItem.records),
      })
      sourceParts.push('本地缓存')
      usedCached = true
      continue
    }

    dividends.push(buildEmptyDividendItem(stock.code))
    sourceParts.push('内置空值')
    usedFallback = true
  }

  let freshness: DividendFreshness = 'fallback'

  if (usedLive && !usedCached && !usedFallback && liveItems.size === STOCKS.length) {
    freshness = 'live'
  } else if (usedLive && (usedCached || usedFallback)) {
    freshness = 'partial'
  } else if (usedCached && !usedLive && !usedFallback) {
    freshness = 'cached'
  }

  return {
    dividends,
    freshness,
    source: summarizeSources(sourceParts),
  }
}

async function fetchJsonWithTimeout<T>(url: string) {
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), DIVIDEND_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
      signal: abortController.signal,
    })

    if (!response.ok) {
      throw new Error(`dividend provider request failed: ${response.status}`)
    }

    return (await response.json()) as T
  } finally {
    clearTimeout(timeout)
  }
}

async function postJsonWithTimeout<T>(url: string, body: unknown) {
  const abortController = new AbortController()
  const timeout = setTimeout(() => abortController.abort(), DIVIDEND_TIMEOUT_MS)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
    })

    if (!response.ok) {
      throw new Error(`dividend provider request failed: ${response.status}`)
    }

    return (await response.json()) as T
  } finally {
    clearTimeout(timeout)
  }
}

function getTushareToken() {
  const token = process.env.TUSHARE_TOKEN?.trim()
  return token ? token : null
}

function toTushareCode(code: StockCode) {
  return `${code}.SZ`
}

async function fetchDividendPage(code: StockCode, pageNumber: number) {
  const url = new URL(EASTMONEY_DIVIDEND_API_URL)
  url.searchParams.set('sortColumns', 'REPORT_DATE')
  url.searchParams.set('sortTypes', '-1')
  url.searchParams.set('pageSize', '500')
  url.searchParams.set('pageNumber', String(pageNumber))
  url.searchParams.set('reportName', 'RPT_SHAREBONUS_DET')
  url.searchParams.set('columns', 'ALL')
  url.searchParams.set('quoteColumns', '')
  url.searchParams.set('js', '{"data":(x),"pages":(tp)}')
  url.searchParams.set('source', 'WEB')
  url.searchParams.set('client', 'WEB')
  url.searchParams.set('filter', `(SECURITY_CODE="${code}")`)

  const payload = await fetchJsonWithTimeout<EastmoneyDividendResponse>(url.toString())
  const rows = payload.result?.data

  if (!Array.isArray(rows)) {
    throw new Error('Eastmoney dividend payload is invalid')
  }

  return {
    pages: Math.max(1, Number(payload.result?.pages ?? 1)),
    rows,
  } satisfies DividendPage
}

async function fetchTushareDividendHistory(code: StockCode) {
  const token = getTushareToken()

  if (!token) {
    throw new Error('TUSHARE_TOKEN is not configured')
  }

  const stock = getStockByCode(code)
  const payload = await postJsonWithTimeout<TushareResponse>(TUSHARE_API_URL, {
    api_name: 'dividend',
    token,
    params: {
      ts_code: toTushareCode(code),
    },
    fields: TUSHARE_DIVIDEND_FIELDS,
  })

  if (payload.code && payload.code !== 0) {
    throw new Error(payload.msg || 'Tushare dividend request failed')
  }

  const fields = payload.data?.fields ?? []
  const rows = (payload.data?.items ?? []).map((item) =>
    Object.fromEntries(fields.map((field, index) => [field, item[index]])),
  )

  const records = rows
    .map((row) => normalizeTushareDividendRow(row))
    .filter((record): record is DividendRecord => record !== null)

  if (records.length === 0) {
    throw new Error(`Tushare dividend provider returned no records for ${code}`)
  }

  return {
    code: stock.code,
    name: stock.name,
    label: stock.label,
    source: 'Tushare Pro',
    records,
  } satisfies DividendFeedItem
}

async function fetchDividendHistory(code: StockCode) {
  const stock = getStockByCode(code)
  const firstPage = await fetchDividendPage(code, 1)
  const rows = [...firstPage.rows]

  if (firstPage.pages > 1) {
    const extraPages = await Promise.all(
      Array.from({ length: firstPage.pages - 1 }, async (_, index) => {
        const page = await fetchDividendPage(code, index + 2)
        return page.rows
      }),
    )

    for (const pageRows of extraPages) {
      rows.push(...pageRows)
    }
  }

  const records = rows
    .map((row) => normalizeDividendRow(row))
    .filter((record): record is DividendRecord => record !== null)

  if (records.length === 0) {
    throw new Error(`Eastmoney dividend provider returned no records for ${code}`)
  }

  return {
    code: stock.code,
    name: stock.name,
    label: stock.label,
    source: '东方财富',
    records,
  } satisfies DividendFeedItem
}

async function fetchLiveDividendItems() {
  const results = await Promise.allSettled(
    STOCKS.map(async (stock) => {
      try {
        return await fetchTushareDividendHistory(stock.code)
      } catch {
        return fetchDividendHistory(stock.code)
      }
    }),
  )
  const items = new Map<StockCode, DividendFeedItem>()

  for (const result of results) {
    if (result.status !== 'fulfilled') {
      continue
    }

    items.set(result.value.code, result.value)
  }

  return items
}

async function persistDividendSnapshots(items: DividendFeedItem[]) {
  if (items.length === 0 || isMarketDataPersistenceDisabled()) {
    return
  }

  const validItems = items.flatMap((item) => {
    const records = getValidDividendRecords(item.records)
    return records ? [{ ...item, records }] : []
  })

  if (validItems.length === 0) {
    return
  }

  let db: ReturnType<typeof getDb>

  try {
    db = getDb()
  } catch (error) {
    warnSnapshotFailure('initialize dividend snapshot persistence', error)
    return
  }

  const fetchedAt = new Date()

  await forEachBestEffort(
    validItems,
    async (item) => {
      await db
        .insert(dividendSnapshots)
        .values({
          stockCode: item.code,
          payload: JSON.stringify(item.records),
          source: item.source ?? '未知来源',
          fetchedAt,
        })
        .onConflictDoUpdate({
          target: dividendSnapshots.stockCode,
          set: {
            payload: JSON.stringify(item.records),
            source: item.source ?? '未知来源',
            fetchedAt,
          },
        })
    },
    (error, item) => warnSnapshotFailure('persist dividend snapshot', error, item.code),
  )
}

async function readSnapshotDividendItems() {
  if (isMarketDataPersistenceDisabled()) {
    return new Map<StockCode, DividendFeedItem>()
  }

  try {
    const db = getDb()
    const rows = await db.select().from(dividendSnapshots)
    const items = new Map<StockCode, DividendFeedItem>()

    for (const row of rows) {
      if (!isStockCode(row.stockCode)) {
        continue
      }

      let parsedPayload: unknown

      try {
        parsedPayload = JSON.parse(row.payload) as unknown
      } catch (error) {
        warnSnapshotFailure('parse dividend snapshot', error, row.stockCode)
        continue
      }

      const records = getValidDividendRecords(parsedPayload)

      if (!records) {
        warnSnapshotFailure(
          'validate dividend snapshot',
          new TypeError('snapshot has no valid dividend records'),
          row.stockCode,
        )
        continue
      }

      const stock = getStockByCode(row.stockCode)

      items.set(row.stockCode, {
        code: stock.code,
        name: stock.name,
        label: stock.label,
        source: row.source,
        records,
      })
    }

    return items
  } catch (error) {
    warnSnapshotFailure('read dividend snapshots', error)
    return new Map<StockCode, DividendFeedItem>()
  }
}

async function fetchFreshDividendFeed() {
  const liveItems = await fetchLiveDividendItems()
  const snapshotItems =
    liveItems.size === STOCKS.length
      ? new Map<StockCode, DividendFeedItem>()
      : await readSnapshotDividendItems()
  const feed = buildDividendFeed(liveItems, snapshotItems)

  if (liveItems.size > 0) {
    await persistDividendSnapshots([...liveItems.values()])
  }

  cachedDividendFeed = cloneDividendFeed(feed)
  cacheExpiresAt =
    Date.now() + (feed.freshness === 'live' ? DIVIDEND_CACHE_TTL_MS : DIVIDEND_DEGRADED_CACHE_TTL_MS)

  return feed
}

export async function listDividends() {
  if (cachedDividendFeed && Date.now() < cacheExpiresAt) {
    return cloneDividendFeed(cachedDividendFeed)
  }

  if (pendingDividendRequest) {
    return cloneDividendFeed(await pendingDividendRequest)
  }

  try {
    pendingDividendRequest = fetchFreshDividendFeed()
    return cloneDividendFeed(await pendingDividendRequest)
  } catch {
    const snapshotItems = await readSnapshotDividendItems()
    let emergencyFeed: DividendFeed

    if (snapshotItems.size > 0) {
      emergencyFeed = buildDividendFeed(new Map<StockCode, DividendFeedItem>(), snapshotItems)
    } else if (cachedDividendFeed) {
      emergencyFeed = cloneDividendFeed(cachedDividendFeed)
    } else {
      emergencyFeed = buildDividendFeed(
        new Map<StockCode, DividendFeedItem>(),
        new Map<StockCode, DividendFeedItem>(),
      )
    }

    cachedDividendFeed = cloneDividendFeed(emergencyFeed)
    cacheExpiresAt = Date.now() + DIVIDEND_DEGRADED_CACHE_TTL_MS
    return cloneDividendFeed(emergencyFeed)
  } finally {
    pendingDividendRequest = null
  }
}

export async function getDividend(code: StockCode) {
  const feed = await listDividends()

  return {
    dividend: feed.dividends.find((item) => item.code === code) ?? buildEmptyDividendItem(code),
    freshness: feed.freshness,
    source: feed.source,
  }
}
