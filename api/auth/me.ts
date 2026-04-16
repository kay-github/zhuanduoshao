import type { VercelRequest, VercelResponse } from '@vercel/node'
import { eq } from 'drizzle-orm'

import { clearSessionCookie, readSession } from '../../lib/server/auth'
import { db } from '../../lib/server/db'
import { json, methodNotAllowed } from '../../lib/server/http'
import { users } from '../../lib/server/schema'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET'])
  }

  const session = await readSession(req)

  if (!session) {
    clearSessionCookie(res)
    return json(res, 401, { error: '未登录' })
  }

  const [user] = await db
    .select({
      id: users.id,
      username: users.username,
    })
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1)

  if (!user) {
    clearSessionCookie(res)
    return json(res, 401, { error: '登录状态已失效' })
  }

  return json(res, 200, { user })
}
