import { describe, expect, it } from 'vitest'

import { validateLiveQuoteFields, type LiveQuoteFieldsInput } from './quote-service.js'

const NOW_MS = Date.parse('2026-07-10T08:00:00.000Z')
const VALID_FIELDS: LiveQuoteFieldsInput = {
  latestPrice: 523.05,
  totalMarketCap: 729_266_000_000,
  priceChangePct: -4.12,
  asOf: '2026-07-10T07:58:54.000Z',
}

describe('validateLiveQuoteFields', () => {
  it('accepts a complete provider quote with a recent market timestamp', () => {
    expect(validateLiveQuoteFields(VALID_FIELDS, NOW_MS)).toEqual({
      latestPrice: 523.05,
      totalMarketCap: 729_266_000_000,
      priceChangePct: -4.12,
      asOf: '2026-07-10T07:58:54.000Z',
    })
  })

  it.each([
    ['latestPrice', undefined],
    ['totalMarketCap', undefined],
    ['priceChangePct', undefined],
    ['priceChangePct', ''],
  ] as const)('rejects a provider quote missing %s', (field, value) => {
    expect(validateLiveQuoteFields({ ...VALID_FIELDS, [field]: value }, NOW_MS)).toBeNull()
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects a non-positive or invalid price: %s', (latestPrice) => {
    expect(validateLiveQuoteFields({ ...VALID_FIELDS, latestPrice }, NOW_MS)).toBeNull()
  })

  it.each([
    ['malformed', 'not-a-timestamp'],
    ['too old', '2026-06-01T08:00:00.000Z'],
    ['too far in the future', '2026-07-10T08:11:00.000Z'],
  ])('rejects an abnormal provider timestamp: %s', (_reason, asOf) => {
    expect(validateLiveQuoteFields({ ...VALID_FIELDS, asOf }, NOW_MS)).toBeNull()
  })
})
