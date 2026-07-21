import type { VercelRequest, VercelResponse } from '@vercel/node'

import { clearSessionCookie } from '../../lib/server/auth.js'
import { json, methodNotAllowed, handleApiError, hasJsonContentType, setNoStore } from '../../lib/server/http.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  setNoStore(res)

  try {
    if (req.method !== 'POST') {
      return methodNotAllowed(res, ['POST'])
    }

    if (!hasJsonContentType(req)) {
      return json(res, 415, { error: '请求必须使用 application/json' })
    }

    clearSessionCookie(res)
    return json(res, 200, { ok: true })
  } catch (error) {
    return handleApiError(res, error)
  }
}
