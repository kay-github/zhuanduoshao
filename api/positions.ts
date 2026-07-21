import type { VercelRequest, VercelResponse } from '@vercel/node'
import { and, asc, eq } from 'drizzle-orm'

import { readSession } from '../lib/server/auth.js'
import { getDb } from '../lib/server/db.js'
import { json, methodNotAllowed, readJsonBody, handleApiError, setNoStore } from '../lib/server/http.js'
import { createSavePositionSchema, getChinaDateString } from '../lib/server/position-input.js'
import { positions } from '../lib/server/schema.js'
import { resolveWrittenRow } from '../lib/server/write-result.js'
import { isStockCode } from '../shared/stocks.js'

const savePositionSchema = createSavePositionSchema()
const EXPECTED_USER_ID_HEADER = 'x-expected-user-id'

interface SavedPosition {
  id: string
  userId: string
  stockCode: string
  quantity: string
  costPrice: string
  basisDate: string | null
  updatedAt: Date | string
}

function normalizeNumericField(value: unknown, integerOnly = false) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    return null
  }

  const normalizedValue = String(value)

  if (!normalizedValue.trim()) {
    return null
  }

  const numericValue = Number(normalizedValue)
  return Number.isFinite(numericValue) && numericValue >= 0 && (!integerOnly || Number.isInteger(numericValue))
    ? normalizedValue
    : null
}

function parseSavedPosition(value: unknown, expectedUserId: string, expectedStockCode: string): SavedPosition | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>
  const quantity = normalizeNumericField(candidate.quantity, true)
  const costPrice = normalizeNumericField(candidate.costPrice)
  const basisDate = candidate.basisDate
  const updatedAt = candidate.updatedAt
  const normalizedUpdatedAt =
    updatedAt instanceof Date
      ? Number.isFinite(updatedAt.getTime())
        ? updatedAt
        : null
      : typeof updatedAt === 'string' && Number.isFinite(new Date(updatedAt).getTime())
        ? updatedAt
        : null

  if (
    typeof candidate.id !== 'string' ||
    candidate.userId !== expectedUserId ||
    candidate.stockCode !== expectedStockCode ||
    quantity === null ||
    costPrice === null ||
    (basisDate !== null && typeof basisDate !== 'string') ||
    normalizedUpdatedAt === null
  ) {
    return null
  }

  return {
    id: candidate.id,
    userId: expectedUserId,
    stockCode: expectedStockCode,
    quantity,
    costPrice,
    basisDate,
    updatedAt: normalizedUpdatedAt,
  }
}

function serializePosition(position: SavedPosition) {
  const updatedAt = normalizeTimestamp(position.updatedAt)

  return {
    id: position.id,
    userId: position.userId,
    stockCode: position.stockCode,
    quantity: Number(position.quantity),
    costPrice: Number(position.costPrice),
    basisDate: position.basisDate ?? getChinaDateString(new Date(updatedAt)),
    updatedAt,
  }
}

function normalizeTimestamp(value: Date | string) {
  if (value instanceof Date) {
    return value.toISOString()
  }

  const parsedDate = new Date(value)
  return Number.isNaN(parsedDate.getTime()) ? new Date().toISOString() : parsedDate.toISOString()
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setNoStore(res)

  try {
    const session = await readSession(req)

    if (!session) {
      return json(res, 401, { error: '请先登录' })
    }

    const expectedUserIdHeader = req.headers[EXPECTED_USER_ID_HEADER]
    const expectedUserId = Array.isArray(expectedUserIdHeader) ? expectedUserIdHeader[0] : expectedUserIdHeader

    // HttpOnly cookies are shared across tabs. Refuse a request from a tab
    // whose displayed account no longer matches the browser's active session.
    if (expectedUserId !== session.userId) {
      return json(res, 409, { error: '登录账号已在其他页面变更，请刷新后重试' })
    }

    const db = getDb()

    if (req.method === 'GET') {
      const savedPositions = await db
        .select({
          id: positions.id,
          userId: positions.userId,
          stockCode: positions.stockCode,
          quantity: positions.quantity,
          costPrice: positions.costPrice,
          basisDate: positions.basisDate,
          updatedAt: positions.updatedAt,
        })
        .from(positions)
        .where(eq(positions.userId, session.userId))
        .orderBy(asc(positions.stockCode))

      return json(res, 200, {
        positions: savedPositions.map(serializePosition),
      })
    }

    if (req.method === 'PUT') {
      const parsedBody = savePositionSchema.safeParse(readJsonBody(req))

      if (!parsedBody.success || !isStockCode(parsedBody.data.stockCode)) {
        return json(res, 400, { error: '持仓数据不合法' })
      }

      const now = new Date()
      const basisDate = parsedBody.data.basisDate ?? getChinaDateString(now)
      const returnedPositions: unknown = await db
        .insert(positions)
        .values({
          userId: session.userId,
          stockCode: parsedBody.data.stockCode,
          quantity: String(parsedBody.data.quantity),
          costPrice: String(parsedBody.data.costPrice),
          basisDate,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [positions.userId, positions.stockCode],
          set: {
            quantity: String(parsedBody.data.quantity),
            costPrice: String(parsedBody.data.costPrice),
            basisDate,
            updatedAt: now,
          },
        })
        .returning({
          id: positions.id,
          userId: positions.userId,
          stockCode: positions.stockCode,
          quantity: positions.quantity,
          costPrice: positions.costPrice,
          basisDate: positions.basisDate,
          updatedAt: positions.updatedAt,
        })

      const savedPosition = await resolveWrittenRow(
        returnedPositions,
        (candidate) => parseSavedPosition(candidate, session.userId, parsedBody.data.stockCode),
        () =>
          db
            .select({
              id: positions.id,
              userId: positions.userId,
              stockCode: positions.stockCode,
              quantity: positions.quantity,
              costPrice: positions.costPrice,
              basisDate: positions.basisDate,
              updatedAt: positions.updatedAt,
            })
            .from(positions)
            .where(and(eq(positions.userId, session.userId), eq(positions.stockCode, parsedBody.data.stockCode)))
            .limit(1),
      )

      if (!savedPosition) {
        return json(res, 500, { error: '持仓已提交，但服务暂时无法确认保存结果，请刷新后查看' })
      }

      return json(res, 200, {
        position: serializePosition(savedPosition),
      })
    }

    return methodNotAllowed(res, ['GET', 'PUT'])
  } catch (error) {
    return handleApiError(res, error)
  }
}
