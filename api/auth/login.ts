import type { VercelRequest, VercelResponse } from '@vercel/node'
import { eq } from 'drizzle-orm'
import { z } from 'zod'

import { createSessionToken, setSessionCookie, verifyPassword } from '../../lib/server/auth'
import { db } from '../../lib/server/db'
import { json, methodNotAllowed, readJsonBody } from '../../lib/server/http'
import { users } from '../../lib/server/schema'

const loginSchema = z.object({
  username: z.string().trim().min(3).max(24),
  password: z.string().min(6).max(72),
})

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST'])
  }

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
}
