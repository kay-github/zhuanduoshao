import type { VercelRequest, VercelResponse } from '@vercel/node'

import { getDividend, listDividends } from '../lib/server/dividend-service.js'
import { handleApiError, json, methodNotAllowed } from '../lib/server/http.js'
import { isStockCode } from '../shared/stocks.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'GET') {
      return methodNotAllowed(res, ['GET'])
    }

    const code = req.query.code

    if (typeof code === 'string') {
      if (!isStockCode(code)) {
        return json(res, 400, { error: '不支持的股票代码' })
      }

      const dividendResult = await getDividend(code)

      return json(res, 200, {
        dividend: dividendResult.dividend,
        freshness: dividendResult.freshness,
        source: dividendResult.source,
      })
    }

    const dividendFeed = await listDividends()

    return json(res, 200, {
      dividends: dividendFeed.dividends,
      freshness: dividendFeed.freshness,
      source: dividendFeed.source,
    })
  } catch (error) {
    return handleApiError(res, error)
  }
}
