export const STOCKS = [
  {
    code: '300502',
    name: '新易盛',
    label: 'AI 光模块龙头 / 创业板',
    secid: '0.300502',
    fallbackQuote: {
      latestPrice: 118.36,
      totalMarketCap: 842_000_000_000,
      priceChangePct: 3.82,
      updatedAt: '14:57:20',
    },
  },
  {
    code: '300308',
    name: '中际旭创',
    label: '800G/1.6T 核心标的 / 创业板',
    secid: '0.300308',
    fallbackQuote: {
      latestPrice: 143.88,
      totalMarketCap: 1_012_000_000_000,
      priceChangePct: 2.41,
      updatedAt: '14:57:20',
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
  }
}

export function listFallbackQuotes(): StockQuote[] {
  return STOCKS.map((stock) => getFallbackQuote(stock.code))
}
