import type { VercelRequest, VercelResponse } from '@vercel/node'
import { and, asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { readSession } from '../lib/server/auth.js'
import { getDb } from '../lib/server/db.js'
import { json, methodNotAllowed, readJsonBody, handleApiError } from '../lib/server/http.js'
import { positions } from '../lib/server/schema.js'
import { isStockCode } from '../shared/stocks.js'

const savePositionSchema = z.object({
  stockCode: z.string(),
  quantity: z.coerce.number().int().min(0),
  costPrice: z.coerce.number().min(0),
  basisDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

function serializePosition(position: {
  id: string
  userId: string
  stockCode: string
  quantity: string
  costPrice: string
  basisDate: string | null
  updatedAt: Date | string
}) {
  const updatedAt = normalizeTimestamp(position.updatedAt)

  return {
    id: position.id,
    userId: position.userId,
    stockCode: position.stockCode,
    quantity: Number(position.quantity),
    costPrice: Number(position.costPrice),
    basisDate: position.basisDate ?? updatedAt.slice(0, 10),
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
  try {
    const session = await readSession(req)

    if (!session) {
      return json(res, 401, { error: '请先登录' })
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
      const [returnedPosition] = await db
        .insert(positions)
        .values({
          userId: session.userId,
          stockCode: parsedBody.data.stockCode,
          quantity: String(parsedBody.data.quantity),
          costPrice: String(parsedBody.data.costPrice),
          basisDate: parsedBody.data.basisDate ?? now.toISOString().slice(0, 10),
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [positions.userId, positions.stockCode],
          set: {
            quantity: String(parsedBody.data.quantity),
            costPrice: String(parsedBody.data.costPrice),
            basisDate: parsedBody.data.basisDate ?? now.toISOString().slice(0, 10),
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

      const savedPosition =
        returnedPosition ??
        (
          await db
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
            .limit(1)
        )[0]

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
