import type { VercelRequest, VercelResponse } from '@vercel/node'
import { asc, eq } from 'drizzle-orm'
import { z } from 'zod'

import { readSession } from '../lib/server/auth'
import { db } from '../lib/server/db'
import { json, methodNotAllowed, readJsonBody } from '../lib/server/http'
import { positions } from '../lib/server/schema'
import { isStockCode } from '../shared/stocks'

const savePositionSchema = z.object({
  stockCode: z.string(),
  quantity: z.coerce.number().int().min(0),
  costPrice: z.coerce.number().min(0),
})

function serializePosition(position: {
  id: string
  userId: string
  stockCode: string
  quantity: string
  costPrice: string
  updatedAt: Date
}) {
  return {
    id: position.id,
    userId: position.userId,
    stockCode: position.stockCode,
    quantity: Number(position.quantity),
    costPrice: Number(position.costPrice),
    updatedAt: position.updatedAt.toISOString(),
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const session = await readSession(req)

  if (!session) {
    return json(res, 401, { error: '请先登录' })
  }

  if (req.method === 'GET') {
    const savedPositions = await db
      .select({
        id: positions.id,
        userId: positions.userId,
        stockCode: positions.stockCode,
        quantity: positions.quantity,
        costPrice: positions.costPrice,
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
    const [savedPosition] = await db
      .insert(positions)
      .values({
        userId: session.userId,
        stockCode: parsedBody.data.stockCode,
        quantity: String(parsedBody.data.quantity),
        costPrice: String(parsedBody.data.costPrice),
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [positions.userId, positions.stockCode],
        set: {
          quantity: String(parsedBody.data.quantity),
          costPrice: String(parsedBody.data.costPrice),
          updatedAt: now,
        },
      })
      .returning({
        id: positions.id,
        userId: positions.userId,
        stockCode: positions.stockCode,
        quantity: positions.quantity,
        costPrice: positions.costPrice,
        updatedAt: positions.updatedAt,
      })

    return json(res, 200, {
      position: serializePosition(savedPosition),
    })
  }

  return methodNotAllowed(res, ['GET', 'PUT'])
}
