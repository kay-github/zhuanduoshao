import { describe, expect, it } from 'vitest'
import {
  formatCurrency,
  formatPercent,
  formatPlainNumber,
  formatShareQuantity,
  formatYiUnit,
  profitClass,
} from './financial-formatters'

describe('profitClass', () => {
  it('uses A-share direction classes and keeps zero neutral', () => {
    expect(profitClass(1)).toBe('is-up')
    expect(profitClass(-1)).toBe('is-down')
    expect(profitClass(0)).toBe('is-flat')
    expect(profitClass(Number.NaN)).toBe('is-flat')
  })
})

describe('non-finite display values', () => {
  it('shows a stable placeholder instead of NaN or Infinity', () => {
    expect(formatCurrency(Number.NaN)).toBe('--')
    expect(formatPercent(Number.POSITIVE_INFINITY)).toBe('--')
    expect(formatShareQuantity(Number.NEGATIVE_INFINITY)).toBe('--')
    expect(formatYiUnit(Number.NaN)).toBe('--')
    expect(formatPlainNumber(Number.NaN, 2)).toBe('')
  })
})
