import { describe, expect, it } from 'vitest'

import {
  buildQuoteFeed,
  buildValidatedProviderQuote,
  getChinaTradeDate,
  validateLiveQuoteFields,
  validateSnapshotQuoteFields,
  type LiveQuoteFieldsInput,
  type ProviderQuote,
  type ProviderQuoteCandidate,
} from './quote-service.js'
import type { StockCode } from '../../shared/stocks.js'

const NOW_MS = Date.parse('2026-07-10T08:00:00.000Z')
const VALID_FIELDS: LiveQuoteFieldsInput = {
  latestPrice: 523.05,
  totalMarketCap: 729_266_000_000,
  priceChangePct: -4.12,
  asOf: '2026-07-10T07:58:54.000Z',
}

function providerCandidate(
  source: ProviderQuoteCandidate['source'],
  overrides: Partial<ProviderQuoteCandidate> = {},
): ProviderQuoteCandidate {
  return {
    code: '300502',
    source,
    latestPrice: 500,
    totalMarketCap: 700_000_000_000,
    priceChangePct: 1.5,
    asOf: '2026-07-10T07:58:00.000Z',
    ...overrides,
  }
}

function storedQuote(latestPrice: number, asOf: string, source: string): ProviderQuote {
  return {
    source,
    quote: {
      code: '300502',
      name: '新易盛',
      label: '',
      latestPrice,
      totalMarketCap: 700_000_000_000,
      priceChangePct: 1.5,
      updatedAt: '15:00:00',
      asOf,
      fetchedAt: '2026-07-10T08:00:00.000Z',
    },
  }
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

describe('validateSnapshotQuoteFields', () => {
  it('accepts an old but structurally valid last-good snapshot', () => {
    expect(
      validateSnapshotQuoteFields({
        ...VALID_FIELDS,
        asOf: '2026-01-02T07:00:00.000Z',
        fetchedAt: '2026-01-02T07:00:05.000Z',
      }),
    ).toMatchObject({
      latestPrice: VALID_FIELDS.latestPrice,
      asOf: '2026-01-02T07:00:00.000Z',
    })
  })

  it.each([
    ['missing quote timestamp', { asOf: null }],
    ['invalid fetched timestamp', { fetchedAt: 'invalid' }],
    ['out-of-range price change', { priceChangePct: 1_001 }],
  ])('rejects a malformed snapshot: %s', (_reason, overrides) => {
    expect(
      validateSnapshotQuoteFields({
        ...VALID_FIELDS,
        fetchedAt: '2026-07-10T08:00:00.000Z',
        ...overrides,
      }),
    ).toBeNull()
  })
})

describe('buildQuoteFeed', () => {
  it('uses a newer last-good snapshot instead of an older live provider response', () => {
    const liveQuotes = new Map<StockCode, ProviderQuote>([
      ['300502', storedQuote(490, '2026-07-09T07:00:00.000Z', '腾讯行情')],
    ])
    const snapshotQuotes = new Map<StockCode, ProviderQuote>([
      ['300502', storedQuote(510, '2026-07-10T07:00:00.000Z', '历史快照')],
    ])

    const result = buildQuoteFeed(liveQuotes, snapshotQuotes)
    const quote = result.quotes.find((item) => item.code === '300502')

    expect(quote?.latestPrice).toBe(510)
    expect(result.freshnessByCode['300502']).toBe('snapshot')
  })

  it('keeps live data when its timestamp is equal to or newer than the snapshot', () => {
    const liveQuotes = new Map<StockCode, ProviderQuote>([
      ['300502', storedQuote(520, '2026-07-10T07:01:00.000Z', '腾讯行情')],
    ])
    const snapshotQuotes = new Map<StockCode, ProviderQuote>([
      ['300502', storedQuote(510, '2026-07-10T07:00:00.000Z', '历史快照')],
    ])

    const result = buildQuoteFeed(liveQuotes, snapshotQuotes)

    expect(result.quotes.find((item) => item.code === '300502')?.latestPrice).toBe(520)
    expect(result.freshnessByCode['300502']).toBe('live')
  })
})

describe('buildValidatedProviderQuote', () => {
  it('selects the freshest complete price candidate regardless of provider order', () => {
    const result = buildValidatedProviderQuote(
      '300502',
      [
        providerCandidate('东方财富', {
          latestPrice: 490,
          asOf: '2026-07-10T07:50:00.000Z',
        }),
        providerCandidate('腾讯行情', {
          latestPrice: 510,
          totalMarketCap: 710_000_000_000,
          asOf: '2026-07-10T07:59:00.000Z',
        }),
      ],
      NOW_MS,
    )

    expect(result?.quote.latestPrice).toBe(510)
    expect(result?.quote.totalMarketCap).toBe(710_000_000_000)
    expect(result?.quote.asOf).toBe('2026-07-10T07:59:00.000Z')
    expect(result?.source).toBe('腾讯行情')
  })

  it('combines a fresh price with a market cap from the same provider time window', () => {
    const result = buildValidatedProviderQuote(
      '300502',
      [
        providerCandidate('腾讯行情', {
          totalMarketCap: 715_000_000_000,
          asOf: '2026-07-10T07:58:30.000Z',
        }),
        providerCandidate('新浪行情', {
          latestPrice: 512,
          totalMarketCap: null,
          priceChangePct: 2.1,
          asOf: '2026-07-10T07:59:00.000Z',
        }),
      ],
      NOW_MS,
    )

    expect(result?.quote.latestPrice).toBe(512)
    expect(result?.quote.totalMarketCap).toBe(715_000_000_000)
    expect(result?.source).toBe('新浪行情 + 腾讯行情')
  })

  it('rejects a market cap outside the provider clock-skew window', () => {
    const result = buildValidatedProviderQuote(
      '300502',
      [
        providerCandidate('新浪行情', {
          totalMarketCap: null,
          asOf: '2026-07-10T07:59:00.000Z',
        }),
        providerCandidate('东方财富', {
          latestPrice: null,
          priceChangePct: null,
          asOf: '2026-07-10T07:48:59.000Z',
        }),
      ],
      NOW_MS,
    )

    expect(result).toBeNull()
  })

  it('does not label an old complete quote live when a materially fresher price exists', () => {
    const result = buildValidatedProviderQuote(
      '300502',
      [
        providerCandidate('东方财富', {
          asOf: '2026-07-08T07:59:00.000Z',
        }),
        providerCandidate('新浪行情', {
          latestPrice: 515,
          totalMarketCap: null,
          asOf: '2026-07-10T07:59:00.000Z',
        }),
      ],
      NOW_MS,
    )

    expect(result).toBeNull()
  })
})

describe('getChinaTradeDate', () => {
  it('uses the Asia/Shanghai calendar date instead of the server UTC date', () => {
    expect(getChinaTradeDate('2026-07-09T16:30:00.000Z')).toBe('2026-07-10')
  })

  it.each([
    '2026-07-10T16:00:00.000Z',
    '2026-07-11T08:00:00.000Z',
  ])('does not produce a history date for a Shanghai weekend: %s', (asOf) => {
    expect(getChinaTradeDate(asOf)).toBeNull()
  })

  it('returns null for an invalid provider timestamp', () => {
    expect(getChinaTradeDate('invalid')).toBeNull()
  })
})
