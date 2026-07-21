import { z } from 'zod'

import { hasAtMostDecimalPlaces } from '../../shared/numeric.js'

// Keep values exactly representable by the number-based API while remaining
// comfortably inside PostgreSQL numeric(20, 0) and numeric(18, 4).
export const MAX_POSITION_QUANTITY = Number.MAX_SAFE_INTEGER
export const MAX_POSITION_COST_PRICE = Number.MAX_SAFE_INTEGER / 10_000

export function getChinaDateString(now = new Date()) {
  const chinaTimestamp = now.getTime() + 8 * 60 * 60 * 1000
  return new Date(chinaTimestamp).toISOString().slice(0, 10)
}

export function isValidBasisDate(value: string, today = getChinaDateString()) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)

  if (!match) {
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

  return day <= daysInMonth[month - 1] && value <= today
}

export function createSavePositionSchema(today: () => string = getChinaDateString) {
  return z
    .object({
      stockCode: z.string(),
      quantity: z.number().int().min(0).max(MAX_POSITION_QUANTITY),
      costPrice: z
        .number()
        .min(0)
        .max(MAX_POSITION_COST_PRICE)
        .refine((value) => hasAtMostDecimalPlaces(value, 4)),
      basisDate: z
        .string()
        .refine((value) => isValidBasisDate(value, today()))
        .optional(),
    })
    .refine((position) => position.quantity === 0 || position.costPrice > 0, {
      path: ['costPrice'],
    })
}
