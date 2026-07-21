import type { VercelRequest, VercelResponse } from '@vercel/node'
import { describe, expect, it } from 'vitest'

import handler from '../../../api/auth/me.js'

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

describe('current-session handler', () => {
  it('does not clear cookies when a no-session request returns after a newer login', async () => {
    const request = {
      method: 'GET',
      headers: {},
    } as unknown as VercelRequest
    const { response, headers, readBody } = createResponse()

    await handler(request, response)

    expect(response.statusCode).toBe(401)
    expect(readBody()).toEqual({ error: '未登录' })
    expect(headers.has('Set-Cookie')).toBe(false)
  })
})
