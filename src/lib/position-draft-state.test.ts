import { describe, expect, it } from 'vitest'
import {
  MAX_POSITION_COST_PRICE,
  MAX_POSITION_QUANTITY,
  getChinaDateString,
  hasAtMostDecimalPlaces,
  isValidBasisDate,
  mergeAnonymousDraftsWithSavedPositions,
  validatePositionDraft,
  type PositionDraft,
} from './position-draft-state'

const stockCodes = ['300502', '300308'] as const
type TestStockCode = (typeof stockCodes)[number]

function draft(quantity: number, costPrice: number, basisDate = '2026-07-20'): PositionDraft {
  return { quantity, costPrice, basisDate }
}

describe('mergeAnonymousDraftsWithSavedPositions', () => {
  it('keeps a nonzero anonymous draft when the saved position for the same stock is zero', () => {
    const result = mergeAnonymousDraftsWithSavedPositions<TestStockCode>(
      stockCodes,
      {
        '300502': draft(1000, 120),
        '300308': draft(0, 0),
      },
      {
        '300502': draft(0, 0),
        '300308': draft(200, 88),
      },
    )

    expect(result.drafts['300502']).toEqual(draft(1000, 120))
    expect(result.drafts['300308']).toEqual(draft(200, 88))
    expect(result.pendingStockCodes).toEqual(['300502'])
  })

  it('keeps differing meaningful anonymous input and marks it for explicit saving', () => {
    const result = mergeAnonymousDraftsWithSavedPositions<TestStockCode>(
      stockCodes,
      {
        '300502': draft(1000, 120),
        '300308': draft(0, 0),
      },
      {
        '300502': draft(800, 100),
      },
    )

    expect(result.drafts['300502']).toEqual(draft(1000, 120))
    expect(result.pendingStockCodes).toEqual(['300502'])
  })

  it('uses saved positions when anonymous drafts are empty or already match', () => {
    const result = mergeAnonymousDraftsWithSavedPositions<TestStockCode>(
      stockCodes,
      {
        '300502': draft(500, 90),
        '300308': draft(0, 0),
      },
      {
        '300502': draft(500, 90),
        '300308': draft(600, 95),
      },
    )

    expect(result.drafts['300308']).toEqual(draft(600, 95))
    expect(result.pendingStockCodes).toEqual([])
    expect(result.matchedStockCodes).toEqual(['300502'])
  })
})

describe('position draft validation', () => {
  it('uses the current China calendar date around the UTC day boundary', () => {
    expect(getChinaDateString(new Date('2026-07-21T15:59:59.000Z'))).toBe('2026-07-21')
    expect(getChinaDateString(new Date('2026-07-21T16:00:00.000Z'))).toBe('2026-07-22')
  })

  it('requires a positive cost price for a nonzero holding', () => {
    expect(validatePositionDraft(draft(100, 0), '2026-07-21')).toContain('原始成本价')
    expect(validatePositionDraft(draft(0, 0), '2026-07-21')).toBeNull()
  })

  it('rejects impossible and future basis dates', () => {
    expect(isValidBasisDate('2026-02-29', '2026-07-21')).toBe(false)
    expect(isValidBasisDate('2026-07-22', '2026-07-21')).toBe(false)
    expect(isValidBasisDate('2026-07-21', '2026-07-21')).toBe(true)
  })

  it('rejects values outside the API storage bounds and excessive decimal scale', () => {
    expect(validatePositionDraft(draft(MAX_POSITION_QUANTITY + 1, 1), '2026-07-21')).toContain('持仓数量不能超过')
    expect(validatePositionDraft(draft(1, MAX_POSITION_COST_PRICE * 2), '2026-07-21')).toContain('成本价不能超过')
    expect(validatePositionDraft(draft(1, 1.23456), '2026-07-21')).toContain('4 位小数')
    expect(validatePositionDraft(draft(MAX_POSITION_QUANTITY, MAX_POSITION_COST_PRICE), '2026-07-21')).toBeNull()
  })

  it('accepts valid four-decimal prices despite binary floating-point representation', () => {
    expect(84.5002 * 10_000).not.toBe(845_002)
    expect(hasAtMostDecimalPlaces(84.5002, 4)).toBe(true)
    expect(validatePositionDraft(draft(100, 84.5002), '2026-07-21')).toBeNull()
  })

  it('handles scientific notation when checking decimal places', () => {
    expect(hasAtMostDecimalPlaces(1e-4, 4)).toBe(true)
    expect(hasAtMostDecimalPlaces(1e-5, 4)).toBe(false)
  })
})
