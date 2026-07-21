export const YUAN_PER_YI = 100_000_000

/**
 * A-share dividend tax brackets by holding period. Providers report pre-tax
 * cash dividends, so the applicable rate converts them to received amounts.
 */
export const DIVIDEND_TAX_BRACKETS = [
  { key: 'over-1y', label: '持股超1年', rate: 0 },
  { key: '1m-1y', label: '1个月-1年', rate: 0.1 },
  { key: 'under-1m', label: '不足1个月', rate: 0.2 },
] as const

export type DividendTaxBracketKey = (typeof DIVIDEND_TAX_BRACKETS)[number]['key']

export function getDividendTaxRate(key: DividendTaxBracketKey) {
  return DIVIDEND_TAX_BRACKETS.find((bracket) => bracket.key === key)?.rate ?? 0
}

export function isDividendTaxBracketKey(value: unknown): value is DividendTaxBracketKey {
  return DIVIDEND_TAX_BRACKETS.some((bracket) => bracket.key === value)
}

export interface PositionCalculationInput {
  quantity: number
  costPrice: number
  basisDate: string
}

export interface CorporateActionCalculationInput {
  exDate: string
  planProgress: string
  sendRatio: number | null
  transferRatio: number | null
  cashDividendRatio: number | null
}

export interface AdjustedPosition<TAction extends CorporateActionCalculationInput> {
  quantity: number
  originalCostAmount: number
  /** Cash dividends after the applied dividend tax rate. */
  cashDividendAmount: number
  /** Cash dividends as reported by providers (pre-tax). */
  preTaxCashDividendAmount: number
  dividendTaxAmount: number
  adjustedCostAmount: number
  adjustedCostPrice: number
  appliedActions: TAction[]
}

export interface CurrentPositionMetrics {
  costAmount: number
  currentValue: number
  currentProfit: number
  currentProfitPct: number
}

export interface TargetMarketCapScenarioInput {
  targetMarketCapYi: number
  latestPrice: number
  currentTotalMarketCap: number
  adjustedQuantity: number
  cashDividendAmount: number
  originalCostAmount: number
  currentValue: number
}

export interface TargetMarketCapScenario {
  targetMarketCapYi: number
  targetMarketCap: number
  targetPrice: number
  targetValue: number
  totalProfit: number
  additionalProfit: number
  totalProfitPct: number
  distancePct: number
}

export function roundCalculatedValue(value: number, precision = 6) {
  const scale = 10 ** precision
  return Math.round((value + Number.EPSILON) * scale) / scale
}

/**
 * Applies implemented corporate actions in chronological order.
 *
 * Ratios are provider values per 10 shares. The explicit calculation date keeps
 * the result deterministic and prevents announced-but-not-yet-effective actions
 * from being included. Provider cash dividends are pre-tax; `dividendTaxRate`
 * converts them to the received amount used in all return calculations.
 */
export function adjustPositionForCorporateActions<TAction extends CorporateActionCalculationInput>(
  position: PositionCalculationInput,
  records: readonly TAction[],
  calculationDate: string,
  dividendTaxRate = 0,
): AdjustedPosition<TAction> {
  const originalCostAmount = position.quantity * position.costPrice
  let quantity = position.quantity
  let preTaxCashDividendAmount = 0
  const appliedActions: TAction[] = []

  if (quantity <= 0) {
    return {
      quantity,
      originalCostAmount,
      cashDividendAmount: 0,
      preTaxCashDividendAmount,
      dividendTaxAmount: 0,
      adjustedCostAmount: Math.max(originalCostAmount, 0),
      adjustedCostPrice: 0,
      appliedActions,
    }
  }

  for (const record of [...records].sort((a, b) => a.exDate.localeCompare(b.exDate))) {
    if (!record.exDate || record.exDate > calculationDate || record.exDate <= position.basisDate) {
      continue
    }

    if (typeof record.planProgress !== 'string' || !record.planProgress.includes('实施')) {
      continue
    }

    const beforeQuantity = quantity
    const shareRatio = ((record.sendRatio ?? 0) + (record.transferRatio ?? 0)) / 10
    const cashRatio = (record.cashDividendRatio ?? 0) / 10

    if (shareRatio <= 0 && cashRatio <= 0) {
      continue
    }

    preTaxCashDividendAmount = roundCalculatedValue(preTaxCashDividendAmount + beforeQuantity * cashRatio)
    quantity = roundCalculatedValue(beforeQuantity * (1 + shareRatio))
    appliedActions.push(record)
  }

  const dividendTaxAmount = roundCalculatedValue(preTaxCashDividendAmount * dividendTaxRate)
  const cashDividendAmount = roundCalculatedValue(preTaxCashDividendAmount - dividendTaxAmount)
  const adjustedCostAmount = Math.max(originalCostAmount - cashDividendAmount, 0)

  return {
    quantity,
    originalCostAmount,
    cashDividendAmount,
    preTaxCashDividendAmount,
    dividendTaxAmount,
    adjustedCostAmount,
    adjustedCostPrice: quantity > 0 ? adjustedCostAmount / quantity : 0,
    appliedActions,
  }
}

export function calculateCurrentPositionMetrics(
  adjustedPosition: Pick<
    AdjustedPosition<CorporateActionCalculationInput>,
    'quantity' | 'originalCostAmount' | 'cashDividendAmount'
  >,
  latestPrice: number,
): CurrentPositionMetrics {
  const currentValue = adjustedPosition.quantity * latestPrice
  const currentProfit =
    currentValue + adjustedPosition.cashDividendAmount - adjustedPosition.originalCostAmount

  return {
    costAmount: adjustedPosition.originalCostAmount,
    currentValue,
    currentProfit,
    currentProfitPct:
      adjustedPosition.originalCostAmount > 0
        ? currentProfit / adjustedPosition.originalCostAmount
        : 0,
  }
}

export function calculateTargetMarketCapScenario({
  targetMarketCapYi,
  latestPrice,
  currentTotalMarketCap,
  adjustedQuantity,
  cashDividendAmount,
  originalCostAmount,
  currentValue,
}: TargetMarketCapScenarioInput): TargetMarketCapScenario {
  const targetMarketCap = targetMarketCapYi * YUAN_PER_YI
  const targetPrice =
    currentTotalMarketCap > 0
      ? latestPrice * (targetMarketCap / currentTotalMarketCap)
      : 0
  const targetValue = adjustedQuantity * targetPrice
  const totalProfit = targetValue + cashDividendAmount - originalCostAmount
  const additionalProfit = targetValue - currentValue

  return {
    targetMarketCapYi,
    targetMarketCap,
    targetPrice,
    targetValue,
    totalProfit,
    additionalProfit,
    totalProfitPct: originalCostAmount > 0 ? totalProfit / originalCostAmount : 0,
    distancePct: latestPrice > 0 ? targetPrice / latestPrice - 1 : 0,
  }
}

export interface RequiredPriceForProfitInput {
  /** Desired total profit relative to original cost, in yuan. */
  targetTotalProfit: number
  latestPrice: number
  currentTotalMarketCap: number
  adjustedQuantity: number
  cashDividendAmount: number
  originalCostAmount: number
}

export interface RequiredPriceForProfitResult {
  achievable: boolean
  requiredPrice: number
  requiredMarketCap: number
  requiredMarketCapYi: number
  distancePct: number
}

/**
 * Inverse of the target-market-cap projection: given a desired total profit,
 * solve for the price (and implied total market cap) that produces it.
 * Unachievable when there is no holding to appreciate.
 */
export function calculateRequiredPriceForProfit({
  targetTotalProfit,
  latestPrice,
  currentTotalMarketCap,
  adjustedQuantity,
  cashDividendAmount,
  originalCostAmount,
}: RequiredPriceForProfitInput): RequiredPriceForProfitResult {
  const requiredHoldingValue = targetTotalProfit + originalCostAmount - cashDividendAmount
  const requiredPrice = adjustedQuantity > 0 ? requiredHoldingValue / adjustedQuantity : 0
  const achievable = adjustedQuantity > 0 && requiredPrice > 0
  const requiredMarketCap =
    achievable && latestPrice > 0 ? currentTotalMarketCap * (requiredPrice / latestPrice) : 0

  return {
    achievable,
    requiredPrice: achievable ? requiredPrice : 0,
    requiredMarketCap,
    requiredMarketCapYi: requiredMarketCap / YUAN_PER_YI,
    distancePct: achievable && latestPrice > 0 ? requiredPrice / latestPrice - 1 : 0,
  }
}
