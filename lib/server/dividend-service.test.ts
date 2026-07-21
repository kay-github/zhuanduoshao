import { describe, expect, it } from 'vitest'

import {
  getValidDividendRecords,
  isValidDividendRecord,
  normalizeTushareDividendRow,
} from './dividend-service.js'

const BASE_ROW: Record<string, unknown> = {
  ts_code: '300502.SZ',
  end_date: '20251231',
  ann_date: '20260320',
  div_proc: '实施',
  record_date: '20260601',
  ex_date: '20260602',
}

describe('normalizeTushareDividendRow', () => {
  it('maps the send and transfer components without adding stk_div twice', () => {
    const record = normalizeTushareDividendRow({
      ...BASE_ROW,
      stk_div: 0.3,
      stk_bo_rate: 0.1,
      stk_co_rate: 0.2,
      cash_div_tax: 0.1,
      cash_div: 0.08,
    })

    expect(record).toMatchObject({
      totalRatio: 3,
      sendRatio: 1,
      transferRatio: 2,
      cashDividendRatio: 1,
      recordDate: '2026-06-01',
      exDate: '2026-06-02',
    })
  })

  it('derives a missing send component from stk_div without duplicating stk_co_rate', () => {
    const record = normalizeTushareDividendRow({
      ...BASE_ROW,
      stk_div: 0.3,
      stk_bo_rate: null,
      stk_co_rate: 0.2,
      cash_div_tax: 0,
    })

    expect(record).toMatchObject({
      totalRatio: 3,
      sendRatio: 1,
      transferRatio: 2,
    })
  })

  it('uses stk_div as the total share action when component fields are absent', () => {
    const record = normalizeTushareDividendRow({
      ...BASE_ROW,
      stk_div: 0.3,
      cash_div_tax: 0,
    })

    expect(record).toMatchObject({
      totalRatio: 3,
      sendRatio: 3,
      transferRatio: 0,
    })
  })

  it('does not substitute the after-tax cash_div when cash_div_tax is missing', () => {
    const record = normalizeTushareDividendRow({
      ...BASE_ROW,
      stk_div: 0,
      cash_div: 0.08,
    })

    expect(record?.cashDividendRatio).toBeNull()
    expect(record?.cashDividendDescription).toContain('税前金额缺失')
    expect(record?.cashDividendDescription).not.toContain('0.8')
  })

  it('retains a valid future pre-disclosure record without an ex-date or finalized ratios', () => {
    const record = normalizeTushareDividendRow({
      ...BASE_ROW,
      end_date: '20271231',
      ann_date: '20260720',
      div_proc: '预案',
      record_date: null,
      ex_date: null,
    })

    expect(record).toMatchObject({
      reportDate: '2027-12-31',
      performanceDisclosureDate: '2026-07-20',
      exDate: '',
      planProgress: '预案',
      totalRatio: null,
      sendRatio: null,
      transferRatio: null,
    })
  })

  it.each([
    [{ ts_code: '300502.SZ' }, 'missing required fields'],
    [{ ...BASE_ROW, end_date: '20261340' }, 'invalid report date'],
    [{ ...BASE_ROW, div_proc: '' }, 'missing progress'],
    [{ ...BASE_ROW, stk_div: -0.1 }, 'negative action ratio'],
  ])('rejects a malformed provider row: %s', (overrides, _reason) => {
    expect(normalizeTushareDividendRow(overrides)).toBeNull()
  })

  it('rejects rows outside the configured stock universe', () => {
    expect(normalizeTushareDividendRow({ ...BASE_ROW, ts_code: '000001.SZ' })).toBeNull()
  })
})

describe('dividend snapshot validation', () => {
  it('rejects an empty or structurally incomplete snapshot payload', () => {
    expect(getValidDividendRecords([])).toBeNull()
    expect(getValidDividendRecords([{ exDate: '2026-06-02' }])).toBeNull()
  })

  it('keeps valid records while dropping malformed snapshot entries', () => {
    const validRecord = normalizeTushareDividendRow({
      ...BASE_ROW,
      stk_div: 0,
      cash_div_tax: 0.1,
    })

    expect(validRecord).not.toBeNull()
    expect(isValidDividendRecord(validRecord)).toBe(true)
    expect(getValidDividendRecords([{ exDate: 'bad' }, validRecord])).toEqual([validRecord])
  })
})
