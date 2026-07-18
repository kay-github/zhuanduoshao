import type { VercelRequest, VercelResponse } from '@vercel/node'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { createSessionToken, setSessionCookie, verifyPassword } from '../../lib/server/auth.js'
import { getDb } from '../../lib/server/db.js'
import { json, methodNotAllowed, readJsonBody, handleApiError } from '../../lib/server/http.js'
import { isAuthRateLimited } from '../../lib/server/rate-limit.js'
import { users } from '../../lib/server/schema.js'

const loginSchema = z.object({
  username: z.string().trim().min(3).max(24),
  password: z.string().min(6).max(72),
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return methodNotAllowed(res, ['POST'])
    }

    if (isAuthRateLimited(req)) {
      return json(res, 429, { error: '尝试过于频繁，请稍后再试' })
    }

    const db = getDb()

    const parsedBody = loginSchema.safeParse(readJsonBody(req))

    if (!parsedBody.success) {
      return json(res, 400, { error: '用户名或密码格式不正确' })
    }

    const username = parsedBody.data.username.toLowerCase()
    const [user] = await db
      .select({
        id: users.id,
        username: users.username,
        passwordHash: users.passwordHash,
      })
      .from(users)
      .where(eq(users.username, username))
      .limit(1)

    if (!user) {
      return json(res, 401, { error: '用户名或密码错误' })
    }

    const passwordMatched = await verifyPassword(parsedBody.data.password, user.passwordHash)

    if (!passwordMatched) {
      return json(res, 401, { error: '用户名或密码错误' })
    }

    const token = await createSessionToken({ userId: user.id, username: user.username })
    setSessionCookie(res, token)

    return json(res, 200, {
      user: {
        id: user.id,
        username: user.username,
      },
    })
  } catch (error) {
    return handleApiError(res, error)
  }
}
