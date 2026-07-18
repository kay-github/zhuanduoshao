import type { VercelRequest, VercelResponse } from '@vercel/node'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { clearSessionCookie, createSessionToken, hashPassword, setSessionCookie } from '../../lib/server/auth.js'
import { getDb } from '../../lib/server/db.js'
import { json, methodNotAllowed, readJsonBody, handleApiError } from '../../lib/server/http.js'
import { authRateLimiter, readClientIp } from '../../lib/server/rate-limit.js'
import { users } from '../../lib/server/schema.js'

const registerSchema = z.object({
  username: z.string().trim().min(3).max(24).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(6).max(72),
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return methodNotAllowed(res, ['POST'])
    }

    // Every registration attempt counts: unlike login, high-volume successful
    // registration from one IP is itself the abuse signal.
    const clientIp = readClientIp(req)

    if (authRateLimiter.isLimited(clientIp)) {
      return json(res, 429, { error: '尝试过于频繁，请稍后再试' })
    }

    authRateLimiter.recordFailure(clientIp)

    const db = getDb()

    const parsedBody = registerSchema.safeParse(readJsonBody(req))

    if (!parsedBody.success) {
      clearSessionCookie(res)
      return json(res, 400, { error: '用户名或密码格式不正确' })
    }

    const username = parsedBody.data.username.toLowerCase()
    const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1)

    if (existingUser.length > 0) {
      return json(res, 409, { error: '用户名已存在' })
    }

    const passwordHash = await hashPassword(parsedBody.data.password)
    const [user] = await db
      .insert(users)
      .values({
        username,
        passwordHash,
        updatedAt: new Date(),
      })
      .returning({
        id: users.id,
        username: users.username,
      })

    const token = await createSessionToken({ userId: user.id, username: user.username })
    setSessionCookie(res, token)

    return json(res, 201, { user })
  } catch (error) {
    return handleApiError(res, error)
  }
}
