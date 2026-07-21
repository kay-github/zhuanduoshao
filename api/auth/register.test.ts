import type { VercelRequest, VercelResponse } from '@vercel/node'
import { describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('../../lib/server/db.js', () => ({
  getDb: getDbMock,
}))

import handler from './register.js'

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
    readBody: () => JSON.parse(responseBody) as unknown,
  }
}

describe('register handler configuration ordering', () => {
  it('rejects an invalid AUTH_SECRET before opening the database', async () => {
    const previousAuthSecret = process.env.AUTH_SECRET
    process.env.AUTH_SECRET = 'replace-with-a-long-random-secret'
    getDbMock.mockClear()

    try {
      const request = {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-forwarded-for': 'register-config-test',
        },
        body: { username: 'new_user', password: 'secret1' },
      } as unknown as VercelRequest
      const { response, readBody } = createResponse()

      await handler(request, response)

      expect(response.statusCode).toBe(503)
      expect(readBody()).toEqual({ error: 'AUTH_SECRET 不能使用示例值或占位值' })
      expect(getDbMock).not.toHaveBeenCalled()
    } finally {
      if (previousAuthSecret === undefined) {
        delete process.env.AUTH_SECRET
      } else {
        process.env.AUTH_SECRET = previousAuthSecret
      }
    }
  })

  it('rejects form-compatible content types before opening the database', async () => {
    getDbMock.mockClear()
    const request = {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'x-forwarded-for': 'register-content-type-test',
      },
      body: '{"username":"new_user","password":"secret1"}',
    } as unknown as VercelRequest
    const { response, readBody } = createResponse()

    await handler(request, response)

    expect(response.statusCode).toBe(415)
    expect(readBody()).toEqual({ error: '请求必须使用 application/json' })
    expect(getDbMock).not.toHaveBeenCalled()
  })
})
