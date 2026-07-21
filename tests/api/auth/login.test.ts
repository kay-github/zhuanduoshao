import type { VercelRequest, VercelResponse } from '@vercel/node'
import { describe, expect, it, vi } from 'vitest'

const { getDbMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
}))

vi.mock('../../../lib/server/db.js', () => ({
  getDb: getDbMock,
}))

import handler from '../../../api/auth/login.js'

function createResponse() {
  let responseBody = ''
  const response = {
    statusCode: 200,
    setHeader() {
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

describe('login handler request validation', () => {
  it('rejects form-compatible content types before opening the database', async () => {
    getDbMock.mockClear()
    const request = {
      method: 'POST',
      headers: {
        'content-type': 'text/plain',
        'x-forwarded-for': 'login-content-type-test',
      },
      body: '{"username":"existing_user","password":"secret1"}',
    } as unknown as VercelRequest
    const { response, readBody } = createResponse()

    await handler(request, response)

    expect(response.statusCode).toBe(415)
    expect(readBody()).toEqual({ error: '请求必须使用 application/json' })
    expect(getDbMock).not.toHaveBeenCalled()
  })
})
