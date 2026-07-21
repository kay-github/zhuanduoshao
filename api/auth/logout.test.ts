import type { VercelRequest, VercelResponse } from '@vercel/node'
import { describe, expect, it } from 'vitest'

import handler from './logout.js'

function createResponse() {
  const headers = new Map<string, string | number | readonly string[]>()
  let responseBody = ''
  const response = {
    statusCode: 200,
    setHeader(name: string, value: string | number | readonly string[]) {
      headers.set(name, value)
      return response
    },
    end(body?: string) {
      responseBody = body ?? ''
      return response
    },
  } as unknown as VercelResponse

  return {
    response,
    headers,
    readBody: () => JSON.parse(responseBody) as unknown,
  }
}

describe('logout handler request validation', () => {
  it('rejects form-compatible requests without clearing the session cookie', async () => {
    const request = {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    } as unknown as VercelRequest
    const { response, headers, readBody } = createResponse()

    await handler(request, response)

    expect(response.statusCode).toBe(415)
    expect(readBody()).toEqual({ error: '请求必须使用 application/json' })
    expect(headers.has('Set-Cookie')).toBe(false)
  })

  it('clears the session for JSON requests', async () => {
    const request = {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: {},
    } as unknown as VercelRequest
    const { response, headers, readBody } = createResponse()

    await handler(request, response)

    expect(response.statusCode).toBe(200)
    expect(readBody()).toEqual({ ok: true })
    expect(headers.get('Set-Cookie')).toContain('Max-Age=0')
  })
})
