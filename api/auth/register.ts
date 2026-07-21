import type { VercelRequest, VercelResponse } from '@vercel/node'
import { eq } from 'drizzle-orm'

import {
  createSessionToken,
  hashPassword,
  setSessionCookie,
  validateAuthSecret,
} from '../../lib/server/auth.js'
import { registerInputSchema } from '../../lib/server/auth-input.js'
import { getDb } from '../../lib/server/db.js'
import { isPostgresUniqueViolation } from '../../lib/server/errors.js'
import {
  json,
  methodNotAllowed,
  readJsonBody,
  handleApiError,
  hasJsonContentType,
  setNoStore,
} from '../../lib/server/http.js'
import {
  AUTH_RATE_LIMIT_NAMESPACES,
  authRateLimiter,
  buildAuthRateLimitKey,
  readClientIp,
} from '../../lib/server/rate-limit.js'
import { users } from '../../lib/server/schema.js'
import { resolveWrittenRow } from '../../lib/server/write-result.js'

interface RegisteredUser {
  id: string
  username: string
}

function parseRegisteredUser(value: unknown, expectedUsername: string): RegisteredUser | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const candidate = value as Record<string, unknown>

  if (typeof candidate.id !== 'string' || !candidate.id || candidate.username !== expectedUsername) {
    return null
  }

  return {
    id: candidate.id,
    username: expectedUsername,
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setNoStore(res)

  try {
    if (req.method !== 'POST') {
      return methodNotAllowed(res, ['POST'])
    }

    if (!hasJsonContentType(req)) {
      return json(res, 415, { error: '请求必须使用 application/json' })
    }

    // Every registration attempt counts: unlike login, high-volume successful
    // registration from one IP is itself the abuse signal.
    const clientIpKey = buildAuthRateLimitKey(AUTH_RATE_LIMIT_NAMESPACES.registerIp, readClientIp(req))

    if (authRateLimiter.isLimited(clientIpKey)) {
      return json(res, 429, { error: '尝试过于频繁，请稍后再试' })
    }

    authRateLimiter.recordFailure(clientIpKey)

    const parsedBody = registerInputSchema.safeParse(readJsonBody(req))

    if (!parsedBody.success) {
      return json(res, 400, { error: '用户名或密码格式不正确' })
    }

    // Validate signing configuration before creating an account. Otherwise a
    // successful insert can be followed by a 503 while issuing its session.
    validateAuthSecret(process.env.AUTH_SECRET)

    const db = getDb()
    const username = parsedBody.data.username.toLowerCase()
    const existingUser = await db.select({ id: users.id }).from(users).where(eq(users.username, username)).limit(1)

    if (existingUser.length > 0) {
      return json(res, 409, { error: '用户名已存在' })
    }

    const passwordHash = await hashPassword(parsedBody.data.password)
    let insertedUsers: unknown

    try {
      insertedUsers = await db
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
    } catch (error) {
      if (isPostgresUniqueViolation(error)) {
        return json(res, 409, { error: '用户名已存在' })
      }

      throw error
    }

    const user = await resolveWrittenRow(
      insertedUsers,
      (candidate) => parseRegisteredUser(candidate, username),
      () =>
        db
          .select({
            id: users.id,
            username: users.username,
          })
          .from(users)
          .where(eq(users.username, username))
          .limit(1),
    )

    if (!user) {
      return json(res, 500, { error: '注册已提交，但服务暂时无法确认账号结果' })
    }

    const token = await createSessionToken({ userId: user.id, username: user.username })
    setSessionCookie(res, token)

    return json(res, 201, { user })
  } catch (error) {
    return handleApiError(res, error)
  }
}
