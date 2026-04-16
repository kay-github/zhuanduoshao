import type { VercelRequest, VercelResponse } from '@vercel/node'

export function json(res: VercelResponse, status: number, body: unknown) {
  return res.status(status).json(body)
}

export function methodNotAllowed(res: VercelResponse, allowedMethods: string[]) {
  res.setHeader('Allow', allowedMethods.join(', '))
  return json(res, 405, { error: 'Method not allowed' })
}

export function readJsonBody<T>(req: VercelRequest) {
  if (req.body == null) {
    return null as T | null
  }

  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body) as T
    } catch {
      return null as T | null
    }
  }

  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString('utf8')) as T
    } catch {
      return null as T | null
    }
  }

  return req.body as T
}

export function parseCookies(req: VercelRequest) {
  const cookieHeader = req.headers.cookie

  if (!cookieHeader) {
    return {} as Record<string, string>
  }

  return cookieHeader.split(';').reduce<Record<string, string>>((all, item) => {
    const [rawKey, ...rawValue] = item.trim().split('=')

    if (!rawKey) {
      return all
    }

    all[rawKey] = decodeURIComponent(rawValue.join('='))
    return all
  }, {})
}
