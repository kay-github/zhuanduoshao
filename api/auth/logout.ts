import type { VercelRequest, VercelResponse } from '@vercel/node'

import { clearSessionCookie } from '../../lib/server/auth'
import { json, methodNotAllowed } from '../../lib/server/http'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return methodNotAllowed(res, ['POST'])
  }

  clearSessionCookie(res)
  return json(res, 200, { ok: true })
}
