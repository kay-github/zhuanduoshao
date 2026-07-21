import type { VercelRequest, VercelResponse } from '@vercel/node'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getDbMock, readSessionMock } = vi.hoisted(() => ({
  getDbMock: vi.fn(),
  readSessionMock: vi.fn(),
}))

vi.mock('../lib/server/auth.js', () => ({
  readSession: readSessionMock,
}))

vi.mock('../lib/server/db.js', () => ({
  getDb: getDbMock,
}))

import handler from './positions.js'

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

describe('positions account context', () => {
  beforeEach(() => {
    getDbMock.mockReset()
    readSessionMock.mockReset()
  })

  it('rejects a stale tab before accessing the current session account', async () => {
    readSessionMock.mockResolvedValue({ userId: 'user-b', username: 'account_b' })
    const request = {
      method: 'GET',
      headers: { 'x-expected-user-id': 'user-a' },
    } as unknown as VercelRequest
    const { response, readBody } = createResponse()

    await handler(request, response)

    expect(response.statusCode).toBe(409)
    expect(readBody()).toEqual({ error: '登录账号已在其他页面变更，请刷新后重试' })
    expect(getDbMock).not.toHaveBeenCalled()
  })

  it('requires an explicit account context even when the session is valid', async () => {
    readSessionMock.mockResolvedValue({ userId: 'user-a', username: 'account_a' })
    const request = {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: {
        stockCode: '300502',
        quantity: 100,
        costPrice: 80,
        basisDate: '2026-07-21',
      },
    } as unknown as VercelRequest
    const { response } = createResponse()

    await handler(request, response)

    expect(response.statusCode).toBe(409)
    expect(getDbMock).not.toHaveBeenCalled()
  })
})
