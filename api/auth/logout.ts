import type { VercelRequest, VercelResponse } from '@vercel/node'

import { clearSessionCookie } from '../../lib/server/auth.js'
import { json, methodNotAllowed, handleApiError } from '../../lib/server/http.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') {
      return methodNotAllowed(res, ['POST'])
    }

    clearSessionCookie(res)
    return json(res, 200, { ok: true })
  } catch (error) {
    return handleApiError(res, error)
  }
}
