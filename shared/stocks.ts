// Fallback quotes are the last-ditch estimate when both live providers and DB
// snapshots fail. Refresh them from live data after large market moves (see
// AGENTS.md); keep priceChangePct at 0 because a stale daily move is noise.
export const STOCKS = [
  {
    code: '300502',
    name: '新易盛',
    label: '',
    secid: '0.300502',
    fallbackQuote: {
      // Refreshed 2026-07-18 from live Eastmoney data.
      latestPrice: 482.88,
      totalMarketCap: 673_300_000_000,
      priceChangePct: 0,
      updatedAt: '--:--:--',
    },
  },
  {
    code: '300308',
    name: '中际旭创',
    label: '',
    secid: '0.300308',
    fallbackQuote: {
      // Refreshed 2026-07-18 from live Eastmoney data.
      latestPrice: 979.46,
      totalMarketCap: 1_092_300_000_000,
      priceChangePct: 0,
      updatedAt: '--:--:--',
    },
  },
] as const

export type StockCode = (typeof STOCKS)[number]['code']
export type StockQuote = {
  code: StockCode
  name: string
  label: string
  latestPrice: number
  totalMarketCap: number
  priceChangePct: number
  updatedAt: string
  asOf: string | null
  fetchedAt: string | null
}

export function isStockCode(value: string): value is StockCode {
  return STOCKS.some((stock) => stock.code === value)
}

export function getStockByCode(code: StockCode) {
  return STOCKS.find((stock) => stock.code === code) ?? STOCKS[0]
}

export function getFallbackQuote(code: StockCode): StockQuote {
  const stock = getStockByCode(code)

  return {
    code: stock.code,
    name: stock.name,
    label: stock.label,
    latestPrice: stock.fallbackQuote.latestPrice,
    totalMarketCap: stock.fallbackQuote.totalMarketCap,
    priceChangePct: stock.fallbackQuote.priceChangePct,
    updatedAt: stock.fallbackQuote.updatedAt,
    asOf: null,
    fetchedAt: null,
  }
}

export function listFallbackQuotes(): StockQuote[] {
  return STOCKS.map((stock) => getFallbackQuote(stock.code))
}
