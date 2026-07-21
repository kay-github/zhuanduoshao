import { hasAtMostDecimalPlaces } from '../../shared/numeric'

export interface PositionDraft {
  quantity: number
  costPrice: number
  basisDate: string
}

export const MAX_POSITION_QUANTITY = Number.MAX_SAFE_INTEGER
export const MAX_POSITION_COST_PRICE = Number.MAX_SAFE_INTEGER / 10_000

export { hasAtMostDecimalPlaces }

export function getChinaDateString(now = new Date()) {
  const chinaTimestamp = now.getTime() + 8 * 60 * 60 * 1000
  return new Date(chinaTimestamp).toISOString().slice(0, 10)
}

export function clonePositionDrafts<T extends string>(
  stockCodes: readonly T[],
  drafts: Record<T, PositionDraft>,
): Record<T, PositionDraft> {
  return stockCodes.reduce(
    (all, stockCode) => {
      all[stockCode] = { ...drafts[stockCode] }
      return all
    },
    {} as Record<T, PositionDraft>,
  )
}

export function hasMeaningfulPositionDraft(draft: PositionDraft) {
  return draft.quantity > 0 || draft.costPrice > 0
}

export function mergeAnonymousDraftsWithSavedPositions<T extends string>(
  stockCodes: readonly T[],
  anonymousDrafts: Record<T, PositionDraft>,
  savedPositions: Partial<Record<T, PositionDraft>>,
) {
  const drafts = clonePositionDrafts(stockCodes, anonymousDrafts)
  const pendingStockCodes: T[] = []
  const matchedStockCodes: T[] = []

  for (const stockCode of stockCodes) {
    const anonymousDraft = anonymousDrafts[stockCode]
    const savedPosition = savedPositions[stockCode]

    if (!savedPosition) {
      if (hasMeaningfulPositionDraft(anonymousDraft)) {
        pendingStockCodes.push(stockCode)
      }
      continue
    }

    const matchesSavedPosition =
      anonymousDraft.quantity === savedPosition.quantity &&
      anonymousDraft.costPrice === savedPosition.costPrice &&
      anonymousDraft.basisDate === savedPosition.basisDate

    if (hasMeaningfulPositionDraft(anonymousDraft) && !matchesSavedPosition) {
      pendingStockCodes.push(stockCode)
      continue
    }

    drafts[stockCode] = { ...savedPosition }

    if (hasMeaningfulPositionDraft(anonymousDraft) && matchesSavedPosition) {
      matchedStockCodes.push(stockCode)
    }
  }

  return { drafts, pendingStockCodes, matchedStockCodes }
}

export function isValidBasisDate(value: string, today: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)

  if (!match || value > today) {
    return false
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])

  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false
  }

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const daysInMonth = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

  return day <= daysInMonth[month - 1]
}

export function validatePositionDraft(draft: PositionDraft, today: string) {
  if (!Number.isFinite(draft.quantity) || draft.quantity < 0 || !Number.isInteger(draft.quantity)) {
    return '持仓数量必须是大于或等于 0 的整数'
  }

  if (draft.quantity > MAX_POSITION_QUANTITY) {
    return `持仓数量不能超过 ${MAX_POSITION_QUANTITY}`
  }

  if (!Number.isFinite(draft.costPrice) || draft.costPrice < 0) {
    return '成本价必须是大于或等于 0 的数字'
  }

  if (draft.costPrice > MAX_POSITION_COST_PRICE) {
    return `成本价不能超过 ${MAX_POSITION_COST_PRICE}`
  }

  if (!hasAtMostDecimalPlaces(draft.costPrice, 4)) {
    return '成本价最多保留 4 位小数'
  }

  if (draft.quantity > 0 && draft.costPrice <= 0) {
    return '持仓数量大于 0 时，请填写大于 0 的基准日原始成本价'
  }

  if (!isValidBasisDate(draft.basisDate, today)) {
    return '持仓基准日必须是真实且不晚于今天的日期'
  }

  return null
}
