import { describe, expect, it } from 'vitest'
import {
  adjustPositionForCorporateActions,
  calculateCurrentPositionMetrics,
  calculateRequiredPriceForProfit,
  calculateTargetMarketCapScenario,
  getDividendTaxRate,
  isDividendTaxBracketKey,
  roundCalculatedValue,
  type CorporateActionCalculationInput,
} from './portfolio-calculations'

interface TestCorporateAction extends CorporateActionCalculationInput {
  id: string
}

function action(
  id: string,
  overrides: Partial<CorporateActionCalculationInput> = {},
): TestCorporateAction {
  return {
    id,
    exDate: '2024-03-01',
    planProgress: '已实施',
    sendRatio: 0,
    transferRatio: 0,
    cashDividendRatio: 0,
    ...overrides,
  }
}

describe('adjustPositionForCorporateActions', () => {
  it('applies share and cash actions chronologically without mutating the inputs', () => {
    const position = { quantity: 100, costPrice: 10, basisDate: '2024-01-01' }
    const records = [
      action('later', {
        exDate: '2024-06-01',
        sendRatio: 1,
        transferRatio: 1,
        cashDividendRatio: 2,
      }),
      action('earlier', {
        exDate: '2024-03-01',
        sendRatio: 1,
        cashDividendRatio: 1,
      }),
    ]

    const result = adjustPositionForCorporateActions(position, records, '2024-12-31')

    expect(result.quantity).toBe(132)
    expect(result.originalCostAmount).toBe(1_000)
    expect(result.cashDividendAmount).toBe(32)
    expect(result.preTaxCashDividendAmount).toBe(32)
    expect(result.dividendTaxAmount).toBe(0)
    expect(result.adjustedCostAmount).toBe(968)
    expect(result.adjustedCostPrice).toBeCloseTo(968 / 132)
    expect(result.appliedActions.map(({ id }) => id)).toEqual(['earlier', 'later'])
    expect(records.map(({ id }) => id)).toEqual(['later', 'earlier'])
    expect(position).toEqual({ quantity: 100, costPrice: 10, basisDate: '2024-01-01' })
  })

  it('only applies effective actions after the basis date and through the calculation date', () => {
    const records = [
      action('on-basis-date', { exDate: '2024-01-01', cashDividendRatio: 10 }),
      action('future', { exDate: '2025-01-01', cashDividendRatio: 10 }),
      action('missing-date', { exDate: '', cashDividendRatio: 10 }),
      action('not-implemented', {
        exDate: '2024-02-01',
        planProgress: '董事会预案',
        cashDividendRatio: 10,
      }),
      {
        ...action('rights-only', { exDate: '2024-02-02' }),
        rightsIssueRatio: 10,
      },
      action('missing-progress', {
        exDate: '2024-02-03',
        planProgress: '',
        cashDividendRatio: 10,
      }),
    ]

    const result = adjustPositionForCorporateActions(
      { quantity: 100, costPrice: 10, basisDate: '2024-01-01' },
      records,
      '2024-12-31',
    )

    expect(result.quantity).toBe(100)
    expect(result.cashDividendAmount).toBe(0)
    expect(result.appliedActions).toEqual([])
  })

  it('rounds each sequential adjustment and never returns a negative adjusted cost', () => {
    const result = adjustPositionForCorporateActions(
      { quantity: 1, costPrice: 1, basisDate: '2024-01-01' },
      [
        action('fractional-share', { sendRatio: 1.23456789 }),
        action('large-dividend', { exDate: '2024-04-01', cashDividendRatio: 20 }),
      ],
      '2024-12-31',
    )

    expect(result.quantity).toBe(roundCalculatedValue(1 * (1 + 1.23456789 / 10)))
    expect(result.cashDividendAmount).toBe(roundCalculatedValue(result.quantity * 2))
    expect(result.adjustedCostAmount).toBe(0)
    expect(result.adjustedCostPrice).toBe(0)
  })

  it('does not apply corporate actions when there is no actual holding', () => {
    const result = adjustPositionForCorporateActions(
      { quantity: 0, costPrice: 84.5, basisDate: '2024-01-01' },
      [action('valid', { sendRatio: 10, cashDividendRatio: 10 })],
      '2024-12-31',
    )

    expect(result.quantity).toBe(0)
    expect(result.originalCostAmount).toBe(0)
    expect(result.cashDividendAmount).toBe(0)
    expect(result.adjustedCostPrice).toBe(0)
    expect(result.appliedActions).toEqual([])
  })

  it('deducts dividend tax from cash dividends without touching share adjustments', () => {
    const result = adjustPositionForCorporateActions(
      { quantity: 100, costPrice: 10, basisDate: '2024-01-01' },
      [action('cash-and-shares', { sendRatio: 2, cashDividendRatio: 10 })],
      '2024-12-31',
      0.2,
    )

    expect(result.quantity).toBe(120)
    expect(result.preTaxCashDividendAmount).toBe(100)
    expect(result.dividendTaxAmount).toBe(20)
    expect(result.cashDividendAmount).toBe(80)
    expect(result.adjustedCostAmount).toBe(920)
  })
})

describe('dividend tax brackets', () => {
  it('maps holding-period keys to A-share dividend tax rates', () => {
    expect(getDividendTaxRate('over-1y')).toBe(0)
    expect(getDividendTaxRate('1m-1y')).toBe(0.1)
    expect(getDividendTaxRate('under-1m')).toBe(0.2)
  })

  it('validates bracket keys from untrusted storage', () => {
    expect(isDividendTaxBracketKey('over-1y')).toBe(true)
    expect(isDividendTaxBracketKey('unknown')).toBe(false)
    expect(isDividendTaxBracketKey(undefined)).toBe(false)
  })
})

describe('calculateCurrentPositionMetrics', () => {
  it('includes accumulated cash dividends in current total return', () => {
    const result = calculateCurrentPositionMetrics(
      {
        quantity: 132,
        originalCostAmount: 1_000,
        cashDividendAmount: 32,
      },
      12,
    )

    expect(result).toEqual({
      costAmount: 1_000,
      currentValue: 1_584,
      currentProfit: 616,
      currentProfitPct: 0.616,
    })
  })

  it('returns a zero profit rate when original cost is zero', () => {
    const result = calculateCurrentPositionMetrics(
      { quantity: 0, originalCostAmount: 0, cashDividendAmount: 0 },
      100,
    )

    expect(result.currentProfit).toBe(0)
    expect(result.currentProfitPct).toBe(0)
  })
})

describe('calculateTargetMarketCapScenario', () => {
  it('projects target price, total return, and additional return from market-cap ratio', () => {
    const result = calculateTargetMarketCapScenario({
      targetMarketCapYi: 300,
      latestPrice: 10,
      currentTotalMarketCap: 20_000_000_000,
      adjustedQuantity: 120,
      cashDividendAmount: 50,
      originalCostAmount: 1_000,
      currentValue: 1_200,
    })

    expect(result).toEqual({
      targetMarketCapYi: 300,
      targetMarketCap: 30_000_000_000,
      targetPrice: 15,
      targetValue: 1_800,
      totalProfit: 850,
      additionalProfit: 600,
      totalProfitPct: 0.85,
      distancePct: 0.5,
    })
  })

  it('uses a zero target price when current market cap is unavailable', () => {
    const result = calculateTargetMarketCapScenario({
      targetMarketCapYi: 300,
      latestPrice: 10,
      currentTotalMarketCap: 0,
      adjustedQuantity: 120,
      cashDividendAmount: 50,
      originalCostAmount: 1_000,
      currentValue: 1_200,
    })

    expect(result.targetPrice).toBe(0)
    expect(result.targetValue).toBe(0)
    expect(result.totalProfit).toBe(-950)
    expect(result.additionalProfit).toBe(-1_200)
    expect(result.totalProfitPct).toBe(-0.95)
    expect(result.distancePct).toBe(-1)
  })

  it('avoids division by zero for a zero original cost and zero latest price', () => {
    const result = calculateTargetMarketCapScenario({
      targetMarketCapYi: 300,
      latestPrice: 0,
      currentTotalMarketCap: 20_000_000_000,
      adjustedQuantity: 0,
      cashDividendAmount: 0,
      originalCostAmount: 0,
      currentValue: 0,
    })

    expect(result.targetPrice).toBe(0)
    expect(result.totalProfitPct).toBe(0)
    expect(result.distancePct).toBe(0)
  })
})

describe('calculateRequiredPriceForProfit', () => {
  it('solves the price and implied market cap for a desired total profit', () => {
    const result = calculateRequiredPriceForProfit({
      targetTotalProfit: 850,
      latestPrice: 10,
      currentTotalMarketCap: 20_000_000_000,
      adjustedQuantity: 120,
      cashDividendAmount: 50,
      originalCostAmount: 1_000,
    })

    expect(result.achievable).toBe(true)
    expect(result.requiredPrice).toBe(15)
    expect(result.requiredMarketCap).toBe(30_000_000_000)
    expect(result.requiredMarketCapYi).toBe(300)
    expect(result.distancePct).toBe(0.5)
  })

  it('round-trips with the forward market-cap projection', () => {
    const forward = calculateTargetMarketCapScenario({
      targetMarketCapYi: 12_000,
      latestPrice: 118.36,
      currentTotalMarketCap: 842_000_000_000,
      adjustedQuantity: 1_400,
      cashDividendAmount: 1_000,
      originalCostAmount: 118_300,
      currentValue: 165_704,
    })

    const inverse = calculateRequiredPriceForProfit({
      targetTotalProfit: forward.totalProfit,
      latestPrice: 118.36,
      currentTotalMarketCap: 842_000_000_000,
      adjustedQuantity: 1_400,
      cashDividendAmount: 1_000,
      originalCostAmount: 118_300,
    })

    expect(inverse.requiredPrice).toBeCloseTo(forward.targetPrice, 8)
    expect(inverse.requiredMarketCapYi).toBeCloseTo(12_000, 6)
  })

  it('is unachievable without any effective holding', () => {
    const result = calculateRequiredPriceForProfit({
      targetTotalProfit: 10_000,
      latestPrice: 10,
      currentTotalMarketCap: 20_000_000_000,
      adjustedQuantity: 0,
      cashDividendAmount: 0,
      originalCostAmount: 0,
    })

    expect(result.achievable).toBe(false)
    expect(result.requiredPrice).toBe(0)
    expect(result.requiredMarketCap).toBe(0)
  })

  it('is unachievable when dividends alone already exceed the target', () => {
    const result = calculateRequiredPriceForProfit({
      targetTotalProfit: 100,
      latestPrice: 10,
      currentTotalMarketCap: 20_000_000_000,
      adjustedQuantity: 120,
      cashDividendAmount: 2_000,
      originalCostAmount: 1_000,
    })

    expect(result.achievable).toBe(false)
  })
})
