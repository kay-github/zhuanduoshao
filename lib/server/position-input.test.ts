import { describe, expect, it } from 'vitest'

import {
  MAX_POSITION_COST_PRICE,
  MAX_POSITION_QUANTITY,
  createSavePositionSchema,
  getChinaDateString,
  isValidBasisDate,
} from './position-input.js'

describe('position input validation', () => {
  it('uses the current China calendar date around the UTC day boundary', () => {
    expect(getChinaDateString(new Date('2026-07-21T15:59:59.000Z'))).toBe('2026-07-21')
    expect(getChinaDateString(new Date('2026-07-21T16:00:00.000Z'))).toBe('2026-07-22')
  })

  it('accepts real calendar dates through today', () => {
    expect(isValidBasisDate('2024-02-29', '2024-02-29')).toBe(true)
    expect(isValidBasisDate('2024-01-01', '2024-02-29')).toBe(true)
  })

  it.each(['2023-02-29', '2024-04-31', '2024-00-10', '0000-01-01', '2024-2-01'])(
    'rejects an invalid calendar date: %s',
    (basisDate) => {
      expect(isValidBasisDate(basisDate, '2024-12-31')).toBe(false)
    },
  )

  it('rejects a date later than today in China', () => {
    const schema = createSavePositionSchema(() => '2026-07-21')

    expect(
      schema.safeParse({ stockCode: '300502', quantity: 0, costPrice: 0, basisDate: '2026-07-22' }).success,
    ).toBe(false)
  })

  it('accepts values at the safe database-compatible upper bounds', () => {
    const schema = createSavePositionSchema(() => '2026-07-21')

    expect(
      schema.safeParse({
        stockCode: '300502',
        quantity: MAX_POSITION_QUANTITY,
        costPrice: MAX_POSITION_COST_PRICE,
        basisDate: '2026-07-21',
      }).success,
    ).toBe(true)
  })

  it('rejects quantities, prices, and decimal scales outside storage bounds', () => {
    const schema = createSavePositionSchema(() => '2026-07-21')
    const baseInput = { stockCode: '300502', quantity: 1, costPrice: 1, basisDate: '2026-07-21' }

    expect(schema.safeParse({ ...baseInput, quantity: MAX_POSITION_QUANTITY + 1 }).success).toBe(false)
    expect(schema.safeParse({ ...baseInput, costPrice: MAX_POSITION_COST_PRICE * 2 }).success).toBe(false)
    expect(schema.safeParse({ ...baseInput, costPrice: 1.23456 }).success).toBe(false)
    expect(schema.safeParse({ ...baseInput, costPrice: 1e-5 }).success).toBe(false)
    expect(schema.safeParse({ ...baseInput, costPrice: 1e-8 }).success).toBe(false)
  })

  it('accepts a valid four-decimal price affected by binary floating-point representation', () => {
    const schema = createSavePositionSchema(() => '2026-07-21')

    expect(
      schema.safeParse({
        stockCode: '300502',
        quantity: 100,
        costPrice: 84.5002,
        basisDate: '2026-07-21',
      }).success,
    ).toBe(true)
  })

  it.each([null, '', false, [], {}, '100'])(
    'rejects a non-number quantity instead of coercing it: %j',
    (quantity) => {
      const schema = createSavePositionSchema(() => '2026-07-21')

      expect(
        schema.safeParse({ stockCode: '300502', quantity, costPrice: 1, basisDate: '2026-07-21' }).success,
      ).toBe(false)
    },
  )

  it.each([null, '', false, [], {}, '1'])(
    'rejects a non-number cost price instead of coercing it: %j',
    (costPrice) => {
      const schema = createSavePositionSchema(() => '2026-07-21')

      expect(
        schema.safeParse({ stockCode: '300502', quantity: 1, costPrice, basisDate: '2026-07-21' }).success,
      ).toBe(false)
    },
  )

  it('requires a positive cost price for a nonzero holding', () => {
    const schema = createSavePositionSchema(() => '2026-07-21')

    expect(
      schema.safeParse({ stockCode: '300502', quantity: 1, costPrice: 0, basisDate: '2026-07-21' }).success,
    ).toBe(false)
    expect(
      schema.safeParse({ stockCode: '300502', quantity: 0, costPrice: 0, basisDate: '2026-07-21' }).success,
    ).toBe(true)
  })
})
