import type { VercelRequest, VercelResponse } from '@vercel/node'
import { eq } from 'drizzle-orm'

import { readSession } from '../../lib/server/auth.js'
import { getDb } from '../../lib/server/db.js'
import { json, methodNotAllowed, handleApiError, setNoStore } from '../../lib/server/http.js'
import { users } from '../../lib/server/schema.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setNoStore(res)

  try {
    if (req.method !== 'GET') {
      return methodNotAllowed(res, ['GET'])
    }

    const session = await readSession(req)

    if (!session) {
      return json(res, 401, { error: '未登录' })
    }

    const db = getDb()

    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
      })
      .from(users)
      .where(eq(users.id, session.userId))
      .limit(1)

    if (!user) {
      return json(res, 401, { error: '登录状态已失效' })
    }

    return json(res, 200, { user })
  } catch (error) {
    return handleApiError(res, error)
  }
}
