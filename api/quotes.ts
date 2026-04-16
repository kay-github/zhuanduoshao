import type { VercelRequest, VercelResponse } from '@vercel/node'

import { getQuote, listQuotes } from '../lib/server/quote-service'
import { json, methodNotAllowed } from '../lib/server/http'
import { isStockCode } from '../shared/stocks'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET'])
  }

  const code = req.query.code

  if (typeof code === 'string') {
    if (!isStockCode(code)) {
      return json(res, 400, { error: '不支持的股票代码' })
    }

    return json(res, 200, {
      quote: await getQuote(code),
    })
  }

  return json(res, 200, {
    quotes: await listQuotes(),
  })
}
