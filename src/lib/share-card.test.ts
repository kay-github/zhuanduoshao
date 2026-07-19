import { describe, expect, it } from 'vitest'

import { buildShareCardData, type ShareCardInput } from './share-card'

const BASE_INPUT: ShareCardInput = {
  stockName: '新易盛',
  stockCode: '300502',
  latestPrice: 482.88,
  targetMarketCapYi: 12_000,
  targetPrice: 860.63,
  distancePct: 0.7823,
  adjustedQuantity: 1_400,
  targetValue: 1_204_882,
  totalProfit: 1_086_582,
  totalProfitPct: 9.1849,
  generatedDate: '2026-07-19',
}

describe('buildShareCardData', () => {
  it('builds a profit headline with 万亿 market cap and 万元-scale profit', () => {
    const card = buildShareCardData(BASE_INPUT)

    expect(card.headline).toBe('若市值到 1.20 万亿，我赚 108.66 万元')
    expect(card.headlineTone).toBe('profit')
    expect(card.subtitle).toBe('新易盛 300502 · 2026-07-19')
    expect(card.lines).toHaveLength(5)
    expect(card.lines[2]).toEqual({ label: '距离现价', value: '+78.23%', tone: 'profit' })
    expect(card.disclaimer).toContain('不构成投资建议')
  })

  it('uses 亏 wording and loss tone for a negative total profit', () => {
    const card = buildShareCardData({
      ...BASE_INPUT,
      targetMarketCapYi: 3_000,
      targetPrice: 215.16,
      distancePct: -0.5544,
      targetValue: 301_224,
      totalProfit: -50_000,
      totalProfitPct: -0.1423,
    })

    expect(card.headline).toBe('若市值到 3000 亿，我亏 5.00 万元')
    expect(card.headlineTone).toBe('loss')
    expect(card.lines[2].tone).toBe('loss')
  })

  it('switches to a price-focused headline without holding-specific lines when quantity is zero', () => {
    const card = buildShareCardData({
      ...BASE_INPUT,
      adjustedQuantity: 0,
      targetValue: 0,
      totalProfit: 0,
      totalProfitPct: 0,
    })

    expect(card.headline).toBe('若市值到 1.20 万亿，股价将到 860.63 元')
    expect(card.lines).toHaveLength(3)
    expect(card.lines.map((line) => line.label)).toEqual(['当前股价', '目标股价', '距离现价'])
  })

  it('scales profit units from 元 through 万元 to 亿元', () => {
    const yuan = buildShareCardData({ ...BASE_INPUT, totalProfit: 999 })
    const wan = buildShareCardData({ ...BASE_INPUT, totalProfit: 25_000 })
    const yi = buildShareCardData({ ...BASE_INPUT, totalProfit: 123_000_000 })

    expect(yuan.headline).toContain('999.00 元')
    expect(wan.headline).toContain('2.50 万元')
    expect(yi.headline).toContain('1.23 亿元')
  })
})
