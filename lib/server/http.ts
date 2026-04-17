import type { VercelRequest, VercelResponse } from '@vercel/node'

import { isConfigurationError } from './errors.js'

export function json(res: VercelResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  return res.end(JSON.stringify(body))
}

export function methodNotAllowed(res: VercelResponse, allowedMethods: string[]) {
  res.setHeader('Allow', allowedMethods.join(', '))
  return json(res, 405, { error: '请求方法不支持' })
}

export function handleApiError(res: VercelResponse, error: unknown) {
  if (isConfigurationError(error)) {
    return json(res, 503, { error: error.message })
  }

  console.error(error)
  return json(res, 500, { error: '服务暂时不可用' })
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
