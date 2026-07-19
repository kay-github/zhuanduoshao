export interface ShareCardInput {
  stockName: string
  stockCode: string
  latestPrice: number
  /** Target total market cap in 亿元. */
  targetMarketCapYi: number
  targetPrice: number
  distancePct: number
  /** Effective quantity after corporate actions; 0 means no holding. */
  adjustedQuantity: number
  targetValue: number
  totalProfit: number
  totalProfitPct: number
  /** ISO date (YYYY-MM-DD) shown as the generation date. */
  generatedDate: string
}

export interface ShareCardLine {
  label: string
  value: string
  tone: 'default' | 'profit' | 'loss'
}

export interface ShareCardData {
  title: string
  subtitle: string
  headline: string
  headlineTone: 'profit' | 'loss'
  lines: ShareCardLine[]
  footer: string
  disclaimer: string
}

function formatCardCurrency(value: number) {
  const absolute = Math.abs(value)

  if (absolute >= 100_000_000) {
    return `${(value / 100_000_000).toFixed(2)} 亿元`
  }

  if (absolute >= 10_000) {
    return `${(value / 10_000).toFixed(2)} 万元`
  }

  return `${value.toFixed(2)} 元`
}

function formatCardMarketCap(valueYi: number) {
  return valueYi >= 10_000 ? `${(valueYi / 10_000).toFixed(2)} 万亿` : `${valueYi.toFixed(0)} 亿`
}

function formatCardPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${(value * 100).toFixed(2)}%`
}

function toneOf(value: number): 'profit' | 'loss' {
  return value >= 0 ? 'profit' : 'loss'
}

/**
 * Builds the text content of a share card from a projection scenario.
 * Pure data in, pure data out — rendering happens separately so this stays
 * unit-testable without a canvas.
 */
export function buildShareCardData(input: ShareCardInput): ShareCardData {
  const hasHolding = input.adjustedQuantity > 0

  return {
    title: '赚多少 · 市值推演',
    subtitle: `${input.stockName} ${input.stockCode} · ${input.generatedDate}`,
    headline: hasHolding
      ? `若市值到 ${formatCardMarketCap(input.targetMarketCapYi)}，我${input.totalProfit >= 0 ? '赚' : '亏'} ${formatCardCurrency(Math.abs(input.totalProfit))}`
      : `若市值到 ${formatCardMarketCap(input.targetMarketCapYi)}，股价将到 ${input.targetPrice.toFixed(2)} 元`,
    headlineTone: hasHolding ? toneOf(input.totalProfit) : 'profit',
    lines: [
      { label: '当前股价', value: `${input.latestPrice.toFixed(2)} 元`, tone: 'default' },
      { label: '目标股价', value: `${input.targetPrice.toFixed(2)} 元`, tone: 'default' },
      { label: '距离现价', value: formatCardPercent(input.distancePct), tone: toneOf(input.distancePct) },
      ...(hasHolding
        ? ([
            { label: '持仓市值', value: formatCardCurrency(input.targetValue), tone: 'default' },
            { label: '总收益率', value: formatCardPercent(input.totalProfitPct), tone: toneOf(input.totalProfitPct) },
          ] satisfies ShareCardLine[])
        : []),
    ],
    footer: '来自「赚多少」持仓收益推演',
    disclaimer: '数据仅供估算参考，不构成投资建议',
  }
}
