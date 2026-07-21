import type { VercelRequest, VercelResponse } from '@vercel/node'
import { eq } from 'drizzle-orm'

import { createSessionToken, setSessionCookie, verifyPassword } from '../../lib/server/auth.js'
import { loginInputSchema } from '../../lib/server/auth-input.js'
import { getDb } from '../../lib/server/db.js'
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

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setNoStore(res)

  try {
    if (req.method !== 'POST') {
      return methodNotAllowed(res, ['POST'])
    }

    if (!hasJsonContentType(req)) {
      return json(res, 415, { error: '请求必须使用 application/json' })
    }

    // Only failed logins count toward the limit, so shared-exit IPs are not
    // starved by legitimate successful traffic.
    const clientIpKey = buildAuthRateLimitKey(AUTH_RATE_LIMIT_NAMESPACES.loginIp, readClientIp(req))

    if (authRateLimiter.isLimited(clientIpKey)) {
      return json(res, 429, { error: '尝试过于频繁，请稍后再试' })
    }

    const db = getDb()

    const parsedBody = loginInputSchema.safeParse(readJsonBody(req))

    if (!parsedBody.success) {
      authRateLimiter.recordFailure(clientIpKey)
      return json(res, 400, { error: '用户名或密码格式不正确' })
    }

    const username = parsedBody.data.username.toLowerCase()
    const usernameKey = buildAuthRateLimitKey(AUTH_RATE_LIMIT_NAMESPACES.loginUsername, username)

    if (authRateLimiter.isLimited(usernameKey)) {
      authRateLimiter.recordFailure(clientIpKey)
      return json(res, 429, { error: '尝试过于频繁，请稍后再试' })
    }

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
      authRateLimiter.recordFailure(clientIpKey)
      authRateLimiter.recordFailure(usernameKey)
      return json(res, 401, { error: '用户名或密码错误' })
    }

    const passwordMatched = await verifyPassword(parsedBody.data.password, user.passwordHash)

    if (!passwordMatched) {
      authRateLimiter.recordFailure(clientIpKey)
      authRateLimiter.recordFailure(usernameKey)
      return json(res, 401, { error: '用户名或密码错误' })
    }

    // A valid account may clear its own budget, but must never erase the
    // shared IP history because that would let an attacker reset it at will.
    authRateLimiter.reset(usernameKey)

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
